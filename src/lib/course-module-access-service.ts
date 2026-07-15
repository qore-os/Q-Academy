import "server-only";

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  courseModuleAccessOverrides,
  courseModuleAccessRequests,
  courses,
  courseModules,
  courseVersions,
  enrollments,
  modules,
  notifications,
  organizations,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  canCreateModuleAccessRequest,
  canDecideModuleAccessRequest,
  isFutureWorkflowExpiry,
  isRepublishedAccessRequest,
  type ModuleAccessWorkflowTarget,
} from "@/lib/course-module-access-workflow-policy";
import { getCourseModuleAccessNotificationCopy } from "@/lib/i18n/course-module-access-notifications";
import { effectiveLocale } from "@/lib/i18n/model";
import { resolveRecipientLocale } from "@/lib/i18n/server";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import { isValidPublishedCourseSnapshot } from "@/lib/published-course";

export type CourseModuleAccessTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type WorkflowTargetContext = {
  member: {
    id: string;
    firstName: string;
    lastName: string;
  };
  course: {
    id: string;
    title: string;
    slug: string;
    publishedVersionId: string;
  };
  learningModule: {
    id: string;
    title: string;
    requestAccessEnabled: boolean;
  };
  publishedAt: Date;
  access: ModuleAccessWorkflowTarget;
};

type WorkflowTargetResult =
  | { ok: true; value: WorkflowTargetContext }
  | { ok: false; reason: string };

type WorkflowLearningAccess = {
  modules: Array<{
    module: { id: string; title: string };
    access: ModuleAccessWorkflowTarget;
  }>;
};

const workflowStates = ["available", "read_only", "locked", "hidden"] as const;
export type CourseModuleOverrideState = (typeof workflowStates)[number];

function workflowLockKey(input: {
  organizationId: string;
  userId: string;
  courseId: string;
  moduleId: string;
}) {
  return `module-access:${input.organizationId}:${input.userId}:${input.courseId}:${input.moduleId}`;
}

async function lockWorkflowTarget(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    moduleId: string;
  },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${workflowLockKey(input)}, 0))`,
  );
}

async function requireActiveAdminActor(
  tx: CourseModuleAccessTransaction,
  organizationId: string,
  actorId: string,
) {
  const [actor] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actorId),
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur aktive Owner und Administratoren duerfen Modulzugriffe entscheiden.",
    );
  }
  return actor;
}

async function loadCurrentWorkflowTarget(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    moduleId: string;
    now: Date;
    allowUnresolvedAccess?: boolean;
  },
): Promise<WorkflowTargetResult> {
  const [member] = await tx
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("update");
  if (!member) {
    return { ok: false, reason: "Das Mitglied ist nicht mehr aktiv." };
  }

  const [course] = await tx
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      publishedVersionId: courses.publishedVersionId,
    })
    .from(courses)
    .where(
      and(
        eq(courses.id, input.courseId),
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, "published"),
      ),
    )
    .limit(1)
    .for("share");
  if (!course?.publishedVersionId) {
    return { ok: false, reason: "Der Kurs ist nicht aktuell veroeffentlicht." };
  }

  const [enrollment] = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, input.userId),
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.accessActive, true),
      ),
    )
    .limit(1)
    .for("update");
  if (!enrollment) {
    return { ok: false, reason: "Die aktive Kurseinschreibung fehlt." };
  }

  const [published] = await tx
    .select({
      id: courseVersions.id,
      publishedAt: courseVersions.publishedAt,
      snapshot: courseVersions.snapshot,
    })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.id, course.publishedVersionId),
        eq(courseVersions.organizationId, input.organizationId),
        eq(courseVersions.courseId, input.courseId),
      ),
    )
    .limit(1)
    .for("share");
  if (
    !published?.publishedAt ||
    !isValidPublishedCourseSnapshot(
      published.snapshot,
      input.courseId,
      input.organizationId,
    )
  ) {
    return {
      ok: false,
      reason: "Die veroeffentlichte Kursversion ist nicht konsistent.",
    };
  }

  const snapshotModule = published.snapshot.modules.find(
    (entry) => entry.id === input.moduleId,
  );
  if (!snapshotModule) {
    return {
      ok: false,
      reason: "Das Modul gehoert nicht mehr zur veroeffentlichten Kursversion.",
    };
  }

  const [assignment] = await tx
    .select({ id: courseModules.moduleId })
    .from(courseModules)
    .where(
      and(
        eq(courseModules.organizationId, input.organizationId),
        eq(courseModules.courseId, input.courseId),
        eq(courseModules.moduleId, input.moduleId),
      ),
    )
    .limit(1)
    .for("share");
  if (!assignment) {
    return {
      ok: false,
      reason: "Die Modulzuordnung existiert nicht mehr.",
    };
  }

  const learningAccess = (await getCourseLearningAccess(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    courseId: input.courseId,
    now: input.now,
  })) as unknown as WorkflowLearningAccess | null;
  const resolvedModule = learningAccess?.modules.find(
    (entry) => entry.module.id === input.moduleId,
  );
  if (!resolvedModule && !input.allowUnresolvedAccess) {
    return {
      ok: false,
      reason: "Der aktuelle Lernzugriff konnte nicht bestaetigt werden.",
    };
  }

  return {
    ok: true,
    value: {
      member,
      course: {
        ...course,
        publishedVersionId: course.publishedVersionId,
      },
      learningModule: {
        id: snapshotModule.id,
        title: snapshotModule.title,
        requestAccessEnabled: snapshotModule.requestAccessEnabled === true,
      },
      publishedAt: published.publishedAt,
      access: resolvedModule?.access ?? {
        state: "hidden",
        listed: false,
        requestable: false,
        requestStatus: null,
      },
    },
  };
}

function unavailableTarget(reason: string) {
  return new ApiError(409, "conflict", reason);
}

async function notifyOrganizationAdmins(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    requesterName: string;
    courseId: string;
    courseTitle: string;
    moduleTitle: string;
  },
) {
  const recipients = await tx
    .select({
      id: users.id,
      preferredLocale: users.preferredLocale,
      defaultLocale: organizations.defaultLocale,
    })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
      ),
    );
  if (!recipients.length) return;
  await tx.insert(notifications).values(
    recipients.map((recipient) => {
      const copy = getCourseModuleAccessNotificationCopy(
        effectiveLocale(recipient),
      );
      return {
        userId: recipient.id,
        title: copy.adminRequestTitle,
        body: copy.adminRequestBody(
          input.requesterName,
          input.moduleTitle,
          input.courseTitle,
        ),
        type: "course_access",
        category: "learning" as const,
        href: `/admin/courses/${input.courseId}`,
      };
    }),
  );
}

async function notifyMember(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    userId: string;
    kind:
      | "approved"
      | "rejected"
      | "stale"
      | "override_updated"
      | "override_removed";
    moduleTitle: string | null;
    state?: CourseModuleOverrideState;
    courseSlug: string;
  },
) {
  const locale = await resolveRecipientLocale(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
  const copy = getCourseModuleAccessNotificationCopy(locale);
  const moduleTitle = input.moduleTitle ?? copy.moduleFallback;
  if (input.kind === "override_updated" && !input.state) {
    throw new Error("Updated module access notification requires a state.");
  }
  const title =
    input.kind === "approved"
      ? copy.approvedTitle
      : input.kind === "override_updated"
        ? copy.overrideUpdatedTitle
        : input.kind === "override_removed"
          ? copy.overrideRemovedTitle
          : copy.rejectedTitle;
  const body =
    input.kind === "approved"
      ? copy.approvedBody(moduleTitle)
      : input.kind === "stale"
        ? copy.staleBody(moduleTitle)
        : input.kind === "override_updated"
          ? copy.overrideUpdatedBody(moduleTitle, copy.states[input.state!])
          : input.kind === "override_removed"
            ? copy.overrideRemovedBody(moduleTitle)
            : copy.rejectedBody(moduleTitle);
  await tx.insert(notifications).values({
    userId: input.userId,
    title,
    body,
    type: "course_access",
    category: "learning",
    href: `/academy/courses/${input.courseSlug}`,
  });
}

export async function createCourseModuleAccessRequestInTransaction(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    moduleId: string;
    message?: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await lockWorkflowTarget(tx, input);

  const [pending] = await tx
    .select({ id: courseModuleAccessRequests.id })
    .from(courseModuleAccessRequests)
    .where(
      and(
        eq(courseModuleAccessRequests.organizationId, input.organizationId),
        eq(courseModuleAccessRequests.userId, input.userId),
        eq(courseModuleAccessRequests.courseId, input.courseId),
        eq(courseModuleAccessRequests.moduleId, input.moduleId),
        eq(courseModuleAccessRequests.status, "pending"),
      ),
    )
    .limit(1)
    .for("update");
  if (pending) {
    throw new ApiError(
      409,
      "conflict",
      "Fuer dieses Modul liegt bereits eine offene Anfrage vor.",
    );
  }

  const target = await loadCurrentWorkflowTarget(tx, { ...input, now });
  if (!target.ok) throw unavailableTarget(target.reason);
  if (!canCreateModuleAccessRequest(target.value.access)) {
    throw unavailableTarget(
      "Dieses Modul kann aktuell nicht angefragt werden.",
    );
  }

  const [created] = await tx
    .insert(courseModuleAccessRequests)
    .values({
      organizationId: input.organizationId,
      courseId: input.courseId,
      moduleId: input.moduleId,
      userId: input.userId,
      message: input.message?.trim() || null,
      requestedAt: now,
    })
    .returning();

  await notifyOrganizationAdmins(tx, {
    organizationId: input.organizationId,
    requesterName:
      `${target.value.member.firstName} ${target.value.member.lastName}`.trim(),
    courseId: input.courseId,
    courseTitle: target.value.course.title,
    moduleTitle: target.value.learningModule.title,
  });

  return { request: created, target: target.value };
}

export async function cancelCourseModuleAccessRequestInTransaction(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    userId: string;
    requestId: string;
    courseId?: string;
    moduleId?: string;
    now?: Date;
  },
) {
  const candidateConditions: SQL[] = [
    eq(courseModuleAccessRequests.id, input.requestId),
    eq(courseModuleAccessRequests.organizationId, input.organizationId),
    eq(courseModuleAccessRequests.userId, input.userId),
  ];
  if (input.courseId) {
    candidateConditions.push(eq(courseModuleAccessRequests.courseId, input.courseId));
  }
  if (input.moduleId) {
    candidateConditions.push(eq(courseModuleAccessRequests.moduleId, input.moduleId));
  }
  const [candidate] = await tx
    .select({
      id: courseModuleAccessRequests.id,
      courseId: courseModuleAccessRequests.courseId,
      moduleId: courseModuleAccessRequests.moduleId,
      userId: courseModuleAccessRequests.userId,
    })
    .from(courseModuleAccessRequests)
    .where(and(...candidateConditions))
    .limit(1);
  if (!candidate) {
    throw new ApiError(404, "not_found", "Zugriffsanfrage nicht gefunden.");
  }

  await lockWorkflowTarget(tx, {
    organizationId: input.organizationId,
    userId: candidate.userId,
    courseId: candidate.courseId,
    moduleId: candidate.moduleId,
  });
  const [current] = await tx
    .select({ id: courseModuleAccessRequests.id })
    .from(courseModuleAccessRequests)
    .where(
      and(
        eq(courseModuleAccessRequests.id, candidate.id),
        eq(courseModuleAccessRequests.organizationId, input.organizationId),
        eq(courseModuleAccessRequests.userId, input.userId),
        eq(courseModuleAccessRequests.status, "pending"),
      ),
    )
    .limit(1)
    .for("update");
  if (!current) {
    throw new ApiError(
      409,
      "conflict",
      "Nur eine eigene offene Anfrage kann zurueckgezogen werden.",
    );
  }
  const [cancelled] = await tx
    .update(courseModuleAccessRequests)
    .set({
      status: "cancelled",
      decidedAt: input.now ?? new Date(),
      decidedById: null,
      decisionNote: null,
    })
    .where(
      and(
        eq(courseModuleAccessRequests.id, current.id),
        eq(courseModuleAccessRequests.organizationId, input.organizationId),
        eq(courseModuleAccessRequests.userId, input.userId),
        eq(courseModuleAccessRequests.status, "pending"),
      ),
    )
    .returning();
  if (!cancelled) {
    throw new ApiError(
      409,
      "conflict",
      "Nur eine eigene offene Anfrage kann zurueckgezogen werden.",
    );
  }
  return cancelled;
}

async function rejectStaleRequest(
  tx: CourseModuleAccessTransaction,
  input: {
    requestId: string;
    organizationId: string;
    actorId: string;
    reason: string;
    now: Date;
    userId: string;
    courseSlug: string | null;
    moduleTitle: string | null;
  },
) {
  const [request] = await tx
    .update(courseModuleAccessRequests)
    .set({
      status: "rejected",
      decisionNote: input.reason,
      decidedAt: input.now,
      decidedById: input.actorId,
    })
    .where(
      and(
        eq(courseModuleAccessRequests.id, input.requestId),
        eq(courseModuleAccessRequests.organizationId, input.organizationId),
        eq(courseModuleAccessRequests.status, "pending"),
      ),
    )
    .returning();
  if (!request) {
    throw new ApiError(409, "conflict", "Die Anfrage wurde bereits bearbeitet.");
  }
  if (input.courseSlug) {
    await notifyMember(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      kind: "stale",
      moduleTitle: input.moduleTitle,
      courseSlug: input.courseSlug,
    });
  }
  return { request, override: null, stale: true as const };
}

export async function decideCourseModuleAccessRequestInTransaction(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    requestId: string;
    actorId: string;
    decision: "approved" | "rejected";
    decisionNote?: string | null;
    expiresAt?: Date | null;
    expectedCourseId?: string;
    expectedModuleId?: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (!isFutureWorkflowExpiry(input.expiresAt, now)) {
    throw new ApiError(
      422,
      "validation_error",
      "Das Ablaufdatum muss in der Zukunft liegen.",
    );
  }
  await requireActiveAdminActor(tx, input.organizationId, input.actorId);

  const requestConditions: SQL[] = [
    eq(courseModuleAccessRequests.id, input.requestId),
    eq(courseModuleAccessRequests.organizationId, input.organizationId),
  ];
  if (input.expectedCourseId) {
    requestConditions.push(
      eq(courseModuleAccessRequests.courseId, input.expectedCourseId),
    );
  }
  if (input.expectedModuleId) {
    requestConditions.push(
      eq(courseModuleAccessRequests.moduleId, input.expectedModuleId),
    );
  }
  const [candidate] = await tx
    .select()
    .from(courseModuleAccessRequests)
    .where(and(...requestConditions))
    .limit(1);
  if (!candidate) {
    throw new ApiError(404, "not_found", "Zugriffsanfrage nicht gefunden.");
  }

  await lockWorkflowTarget(tx, {
    organizationId: input.organizationId,
    userId: candidate.userId,
    courseId: candidate.courseId,
    moduleId: candidate.moduleId,
  });
  await lockMemberCourseProgress(tx, {
    organizationId: input.organizationId,
    userId: candidate.userId,
    courseId: candidate.courseId,
  });
  const [request] = await tx
    .select()
    .from(courseModuleAccessRequests)
    .where(
      and(
        eq(courseModuleAccessRequests.id, candidate.id),
        eq(courseModuleAccessRequests.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!request || request.status !== "pending") {
    throw new ApiError(409, "conflict", "Die Anfrage wurde bereits bearbeitet.");
  }

  const target = await loadCurrentWorkflowTarget(tx, {
    organizationId: input.organizationId,
    userId: request.userId,
    courseId: request.courseId,
    moduleId: request.moduleId,
    now,
  });
  const fallbackCourse = await tx
    .select({ slug: courses.slug })
    .from(courses)
    .where(
      and(
        eq(courses.id, request.courseId),
        eq(courses.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const fallbackModule = await tx
    .select({ title: modules.title })
    .from(modules)
    .where(
      and(
        eq(modules.id, request.moduleId),
        eq(modules.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  const staleReason = !target.ok
    ? target.reason
    : isRepublishedAccessRequest({
          requestedAt: request.requestedAt,
          publishedAt: target.value.publishedAt,
        })
      ? "Der Kurs wurde seit der Anfrage neu veroeffentlicht. Bitte stelle eine neue Anfrage."
      : !canDecideModuleAccessRequest(
            target.value.access,
            target.value.learningModule.requestAccessEnabled,
          )
        ? "Der angefragte Modulzugriff ist nicht mehr gesperrt oder nicht mehr anfragbar."
        : null;
  if (staleReason) {
    return rejectStaleRequest(tx, {
      requestId: request.id,
      organizationId: input.organizationId,
      actorId: input.actorId,
      reason: staleReason,
      now,
      userId: request.userId,
      courseSlug: target.ok
        ? target.value.course.slug
        : (fallbackCourse[0]?.slug ?? null),
      moduleTitle: target.ok
        ? target.value.learningModule.title
        : (fallbackModule[0]?.title ?? null),
    });
  }
  if (!target.ok) throw unavailableTarget(target.reason);

  let override: typeof courseModuleAccessOverrides.$inferSelect | null = null;
  if (input.decision === "approved") {
    [override] = await tx
      .insert(courseModuleAccessOverrides)
      .values({
        organizationId: input.organizationId,
        courseId: request.courseId,
        moduleId: request.moduleId,
        userId: request.userId,
        state: "available",
        reason: input.decisionNote?.trim() || "Zugriffsanfrage genehmigt",
        expiresAt: input.expiresAt ?? null,
        createdById: input.actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          courseModuleAccessOverrides.organizationId,
          courseModuleAccessOverrides.userId,
          courseModuleAccessOverrides.courseId,
          courseModuleAccessOverrides.moduleId,
        ],
        set: {
          state: "available",
          reason: input.decisionNote?.trim() || "Zugriffsanfrage genehmigt",
          expiresAt: input.expiresAt ?? null,
          createdById: input.actorId,
          updatedAt: now,
        },
      })
      .returning();
  }

  const [decided] = await tx
    .update(courseModuleAccessRequests)
    .set({
      status: input.decision,
      decisionNote: input.decisionNote?.trim() || null,
      decidedAt: now,
      decidedById: input.actorId,
    })
    .where(
      and(
        eq(courseModuleAccessRequests.id, request.id),
        eq(courseModuleAccessRequests.organizationId, input.organizationId),
        eq(courseModuleAccessRequests.status, "pending"),
      ),
    )
    .returning();
  if (!decided) {
    throw new ApiError(409, "conflict", "Die Anfrage wurde bereits bearbeitet.");
  }

  await notifyMember(tx, {
    organizationId: input.organizationId,
    userId: request.userId,
    kind: input.decision,
    moduleTitle: target.value.learningModule.title,
    courseSlug: target.value.course.slug,
  });

  return { request: decided, override, stale: false as const };
}

export async function upsertCourseModuleAccessOverrideInTransaction(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    actorId: string;
    userId: string;
    courseId: string;
    moduleId: string;
    state: CourseModuleOverrideState;
    reason?: string | null;
    expiresAt?: Date | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (!workflowStates.includes(input.state)) {
    throw new ApiError(422, "validation_error", "Der Zugriffsstatus ist ungueltig.");
  }
  if (!isFutureWorkflowExpiry(input.expiresAt, now)) {
    throw new ApiError(
      422,
      "validation_error",
      "Das Ablaufdatum muss in der Zukunft liegen.",
    );
  }
  await requireActiveAdminActor(tx, input.organizationId, input.actorId);
  await lockWorkflowTarget(tx, input);
  await lockMemberCourseProgress(tx, input);
  const target = await loadCurrentWorkflowTarget(tx, {
    ...input,
    now,
    allowUnresolvedAccess: true,
  });
  if (!target.ok) throw unavailableTarget(target.reason);

  const [override] = await tx
    .insert(courseModuleAccessOverrides)
    .values({
      organizationId: input.organizationId,
      courseId: input.courseId,
      moduleId: input.moduleId,
      userId: input.userId,
      state: input.state,
      reason: input.reason?.trim() || null,
      expiresAt: input.expiresAt ?? null,
      createdById: input.actorId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        courseModuleAccessOverrides.organizationId,
        courseModuleAccessOverrides.userId,
        courseModuleAccessOverrides.courseId,
        courseModuleAccessOverrides.moduleId,
      ],
      set: {
        state: input.state,
        reason: input.reason?.trim() || null,
        expiresAt: input.expiresAt ?? null,
        createdById: input.actorId,
        updatedAt: now,
      },
    })
    .returning();

  await notifyMember(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    kind: "override_updated",
    moduleTitle: target.value.learningModule.title,
    state: input.state,
    courseSlug: target.value.course.slug,
  });
  return { override, target: target.value };
}

export async function deleteCourseModuleAccessOverrideInTransaction(
  tx: CourseModuleAccessTransaction,
  input: {
    organizationId: string;
    actorId: string;
    userId: string;
    courseId: string;
    moduleId: string;
  },
) {
  await requireActiveAdminActor(tx, input.organizationId, input.actorId);
  await lockWorkflowTarget(tx, input);
  await lockMemberCourseProgress(tx, input);
  const [current] = await tx
    .select({
      override: courseModuleAccessOverrides,
      courseSlug: courses.slug,
      moduleTitle: modules.title,
    })
    .from(courseModuleAccessOverrides)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModuleAccessOverrides.courseId),
        eq(courses.organizationId, courseModuleAccessOverrides.organizationId),
      ),
    )
    .innerJoin(
      modules,
      and(
        eq(modules.id, courseModuleAccessOverrides.moduleId),
        eq(modules.organizationId, courseModuleAccessOverrides.organizationId),
      ),
    )
    .where(
      and(
        eq(courseModuleAccessOverrides.organizationId, input.organizationId),
        eq(courseModuleAccessOverrides.userId, input.userId),
        eq(courseModuleAccessOverrides.courseId, input.courseId),
        eq(courseModuleAccessOverrides.moduleId, input.moduleId),
      ),
    )
    .limit(1)
    .for("update");
  if (!current) {
    throw new ApiError(404, "not_found", "Modul-Override nicht gefunden.");
  }

  const [deleted] = await tx
    .delete(courseModuleAccessOverrides)
    .where(
      and(
        eq(courseModuleAccessOverrides.id, current.override.id),
        eq(courseModuleAccessOverrides.organizationId, input.organizationId),
        eq(courseModuleAccessOverrides.userId, input.userId),
      ),
    )
    .returning();
  if (!deleted) {
    throw new ApiError(409, "conflict", "Der Modul-Override wurde bereits entfernt.");
  }
  await notifyMember(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    kind: "override_removed",
    moduleTitle: current.moduleTitle,
    courseSlug: current.courseSlug,
  });
  return deleted;
}

export async function listCourseModuleAccessRequests(input: {
  organizationId: string;
  courseId?: string;
  moduleId?: string;
  userId?: string;
  status?: "pending" | "approved" | "rejected" | "cancelled";
}) {
  const conditions: SQL[] = [
    eq(courseModuleAccessRequests.organizationId, input.organizationId),
  ];
  if (input.courseId) conditions.push(eq(courseModuleAccessRequests.courseId, input.courseId));
  if (input.moduleId) conditions.push(eq(courseModuleAccessRequests.moduleId, input.moduleId));
  if (input.userId) conditions.push(eq(courseModuleAccessRequests.userId, input.userId));
  if (input.status) conditions.push(eq(courseModuleAccessRequests.status, input.status));
  return db
    .select({
      id: courseModuleAccessRequests.id,
      organizationId: courseModuleAccessRequests.organizationId,
      courseId: courseModuleAccessRequests.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      moduleId: courseModuleAccessRequests.moduleId,
      moduleTitle: modules.title,
      userId: courseModuleAccessRequests.userId,
      memberFirstName: users.firstName,
      memberLastName: users.lastName,
      memberEmail: users.email,
      status: courseModuleAccessRequests.status,
      message: courseModuleAccessRequests.message,
      decisionNote: courseModuleAccessRequests.decisionNote,
      decidedById: courseModuleAccessRequests.decidedById,
      requestedAt: courseModuleAccessRequests.requestedAt,
      decidedAt: courseModuleAccessRequests.decidedAt,
    })
    .from(courseModuleAccessRequests)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModuleAccessRequests.courseId),
        eq(courses.organizationId, courseModuleAccessRequests.organizationId),
      ),
    )
    .innerJoin(
      modules,
      and(
        eq(modules.id, courseModuleAccessRequests.moduleId),
        eq(modules.organizationId, courseModuleAccessRequests.organizationId),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, courseModuleAccessRequests.userId),
        eq(users.organizationId, courseModuleAccessRequests.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(courseModuleAccessRequests.requestedAt), asc(courseModuleAccessRequests.id));
}

export type CourseModuleAccessRequestView = Awaited<
  ReturnType<typeof listCourseModuleAccessRequests>
>[number];

export async function listCourseModuleAccessOverrides(input: {
  organizationId: string;
  courseId?: string;
  moduleId?: string;
  userId?: string;
}) {
  const conditions: SQL[] = [
    eq(courseModuleAccessOverrides.organizationId, input.organizationId),
  ];
  if (input.courseId) conditions.push(eq(courseModuleAccessOverrides.courseId, input.courseId));
  if (input.moduleId) conditions.push(eq(courseModuleAccessOverrides.moduleId, input.moduleId));
  if (input.userId) conditions.push(eq(courseModuleAccessOverrides.userId, input.userId));
  return db
    .select({
      id: courseModuleAccessOverrides.id,
      organizationId: courseModuleAccessOverrides.organizationId,
      courseId: courseModuleAccessOverrides.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      moduleId: courseModuleAccessOverrides.moduleId,
      moduleTitle: modules.title,
      userId: courseModuleAccessOverrides.userId,
      memberFirstName: users.firstName,
      memberLastName: users.lastName,
      memberEmail: users.email,
      state: courseModuleAccessOverrides.state,
      reason: courseModuleAccessOverrides.reason,
      expiresAt: courseModuleAccessOverrides.expiresAt,
      createdById: courseModuleAccessOverrides.createdById,
      createdAt: courseModuleAccessOverrides.createdAt,
      updatedAt: courseModuleAccessOverrides.updatedAt,
    })
    .from(courseModuleAccessOverrides)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModuleAccessOverrides.courseId),
        eq(courses.organizationId, courseModuleAccessOverrides.organizationId),
      ),
    )
    .innerJoin(
      modules,
      and(
        eq(modules.id, courseModuleAccessOverrides.moduleId),
        eq(modules.organizationId, courseModuleAccessOverrides.organizationId),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, courseModuleAccessOverrides.userId),
        eq(users.organizationId, courseModuleAccessOverrides.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(courseModuleAccessOverrides.updatedAt), asc(courseModuleAccessOverrides.id));
}

export type CourseModuleAccessOverrideView = Awaited<
  ReturnType<typeof listCourseModuleAccessOverrides>
>[number];
