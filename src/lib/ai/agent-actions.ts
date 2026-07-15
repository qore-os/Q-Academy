import "server-only";

import { createHash } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  aiAgentMembershipProvenance,
  aiAgentActionEvents,
  aiAgentActionRequests,
  aiAgents,
  aiAgentVersionActions,
  aiAgentVersions,
  aiConversations,
  bundles,
  courseAccessGrants,
  courses,
  enrollments,
  groupMembers,
  groups,
  memberBundles,
  users,
  type AiAgentActionRequest,
} from "@/db/schema";
import {
  addMemberToGroupInTransaction,
  assignBundleToMemberInTransaction,
  removeMemberFromGroupInTransaction,
  unassignBundleFromMemberInTransaction,
} from "@/lib/access";
import { requireAccessiblePublishedAiAgent } from "@/lib/ai/agent-studio";
import {
  canRemoveAiMembership,
  type AiMembershipProvenanceSnapshot,
} from "@/lib/ai/agent-action-provenance";
import { requireAiAgentPolicyEnabledInTransaction } from "@/lib/ai/agent-policy";
import {
  aiAgentActionCancelSchema,
  aiAgentActionDecisionSchema,
  aiAgentActionRequestCreateSchema,
} from "@/lib/ai/agent-actions-model";
import { ApiError } from "@/lib/api/errors";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { privacyActorReference } from "@/lib/privacy/subject-reference";

type ActionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AiAgentActionActor = Readonly<{
  kind: "user" | "api_key" | "system";
  id: string;
  userId?: string | null;
}>;

export {
  aiAgentActionCancelSchema,
  aiAgentActionDecisionSchema,
  aiAgentActionRequestCreateSchema,
} from "@/lib/ai/agent-actions-model";

function requestPayloadDigest(input: {
  organizationId: string;
  agentId: string;
  agentVersionId: string;
  actionConfigurationId: string;
  requestedById: string;
  actionType: AiAgentActionRequest["actionType"];
  targetType: AiAgentActionRequest["targetType"];
  targetCourseId: string | null;
  targetGroupId: string | null;
  targetBundleId: string | null;
  labelSnapshot: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 2,
        organizationId: input.organizationId,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        actionConfigurationId: input.actionConfigurationId,
        requestedById: input.requestedById,
        actionType: input.actionType,
        targetType: input.targetType,
        targetCourseId: input.targetCourseId,
        targetGroupId: input.targetGroupId,
        targetBundleId: input.targetBundleId,
        labelSnapshot: input.labelSnapshot,
      }),
    )
    .digest("hex");
}

function digestForRequest(request: AiAgentActionRequest) {
  return requestPayloadDigest({
    organizationId: request.organizationId,
    agentId: request.agentId,
    agentVersionId: request.agentVersionId,
    actionConfigurationId: request.actionConfigurationId,
    requestedById: request.requestedById,
    actionType: request.actionType,
    targetType: request.targetType,
    targetCourseId: request.targetCourseId,
    targetGroupId: request.targetGroupId,
    targetBundleId: request.targetBundleId,
    labelSnapshot: request.labelSnapshot,
  });
}

function legacyCourseRequestPayloadDigest(request: AiAgentActionRequest) {
  if (request.targetType !== "course" || !request.targetCourseId) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        organizationId: request.organizationId,
        agentId: request.agentId,
        agentVersionId: request.agentVersionId,
        actionConfigurationId: request.actionConfigurationId,
        requestedById: request.requestedById,
        actionType: request.actionType,
        targetCourseId: request.targetCourseId,
        labelSnapshot: request.labelSnapshot,
      }),
    )
    .digest("hex");
}

function assertRequestPayload(request: AiAgentActionRequest) {
  if (
    digestForRequest(request) !== request.payloadDigest &&
    legacyCourseRequestPayloadDigest(request) !== request.payloadDigest
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Aktionsanfrage hat ihre Integritaetspruefung nicht bestanden.",
    );
  }
}

type AiAgentActionTarget =
  | Readonly<{ type: "course"; id: string }>
  | Readonly<{ type: "group"; id: string }>
  | Readonly<{ type: "bundle"; id: string }>;

function actionTarget(input: {
  targetType: "course" | "group" | "bundle";
  courseId: string | null;
  groupId: string | null;
  bundleId: string | null;
}): AiAgentActionTarget {
  if (input.targetType === "course" && input.courseId) {
    return { type: "course", id: input.courseId };
  }
  if (input.targetType === "group" && input.groupId) {
    return { type: "group", id: input.groupId };
  }
  if (input.targetType === "bundle" && input.bundleId) {
    return { type: "bundle", id: input.bundleId };
  }
  {
    throw new ApiError(
      409,
      "conflict",
      "Das typisierte Aktionsziel ist unvollstaendig.",
    );
  }
}

function requestActionTarget(request: AiAgentActionRequest) {
  return actionTarget({
    targetType: request.targetType,
    courseId: request.targetCourseId,
    groupId: request.targetGroupId,
    bundleId: request.targetBundleId,
  });
}

function isAssignmentAction(actionType: AiAgentActionRequest["actionType"]) {
  return [
    "course_enrollment",
    "group_membership_add",
    "bundle_assignment_add",
  ].includes(actionType);
}

async function appendActionEvent(
  tx: ActionTransaction,
  input: {
    organizationId: string;
    requestId: string;
    actor: AiAgentActionActor;
    event: string;
    fromStatus: AiAgentActionRequest["status"] | null;
    toStatus: AiAgentActionRequest["status"];
    revision: number;
    payloadDigest: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(aiAgentActionEvents).values({
    organizationId: input.organizationId,
    requestId: input.requestId,
    actorReference: privacyActorReference(
      input.organizationId,
      input.actor.kind,
      input.actor.id,
    ),
    event: input.event,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    revision: input.revision,
    payloadDigest: input.payloadDigest,
    metadata: input.metadata ?? {},
  });
}

async function appendActivity(
  tx: ActionTransaction,
  input: {
    organizationId: string;
    requestId: string;
    actor: AiAgentActionActor;
    type: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actor.userId ?? null,
    type: input.type,
    entityType: "ai_agent_action_request",
    entityId: input.requestId,
    metadata: input.metadata ?? {},
  });
}

async function requireActiveMember(
  tx: ActionTransaction,
  organizationId: string,
  memberId: string,
) {
  const [member] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, memberId),
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new ApiError(404, "not_found", "Aktives Mitglied nicht gefunden.");
  }
  return member;
}

async function requireActiveAdmin(
  tx: ActionTransaction,
  organizationId: string,
  actorId: string,
) {
  const actor = await requireActiveMember(tx, organizationId, actorId);
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Owner und Administratoren duerfen Agentenaktionen entscheiden.",
    );
  }
  return actor;
}

function revocableDirectAccessCondition(input: {
  organizationId: string;
  memberId: string;
  courseId: string;
}) {
  return and(
    eq(courseAccessGrants.organizationId, input.organizationId),
    eq(courseAccessGrants.userId, input.memberId),
    eq(courseAccessGrants.courseId, input.courseId),
    or(
      like(courseAccessGrants.source, "direct:%"),
      like(courseAccessGrants.source, "ai_action:%"),
    ),
  );
}

async function hasRevocableDirectCourseAccess(
  tx: ActionTransaction,
  input: {
    organizationId: string;
    memberId: string;
    courseId: string;
  },
) {
  const [grant] = await tx
    .select({ id: courseAccessGrants.id })
    .from(courseAccessGrants)
    .where(revocableDirectAccessCondition(input))
    .limit(1);
  return Boolean(grant);
}

async function revokeDirectCourseAccessInTransaction(
  tx: ActionTransaction,
  input: {
    organizationId: string;
    memberId: string;
    courseId: string;
  },
) {
  const [enrollment] = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, input.memberId),
        eq(enrollments.courseId, input.courseId),
      ),
    )
    .for("update")
    .limit(1);
  if (!enrollment) {
    throw new ApiError(
      409,
      "conflict",
      "Der direkte Kurszugriff ist nicht mehr vorhanden. Die Anfrage kann nur abgelehnt werden.",
    );
  }

  const revoked = await tx
    .delete(courseAccessGrants)
    .where(revocableDirectAccessCondition(input))
    .returning({ id: courseAccessGrants.id });
  if (!revoked.length) {
    throw new ApiError(
      409,
      "conflict",
      "Der direkte Kurszugriff ist nicht mehr vorhanden. Die Anfrage kann nur abgelehnt werden.",
    );
  }

  const [remaining] = await tx
    .select({ value: count() })
    .from(courseAccessGrants)
    .where(
      and(
        eq(courseAccessGrants.organizationId, input.organizationId),
        eq(courseAccessGrants.userId, input.memberId),
        eq(courseAccessGrants.courseId, input.courseId),
      ),
    );
  const accessActive = Number(remaining?.value ?? 0) > 0;
  await tx
    .update(enrollments)
    .set({ accessActive })
    .where(
      and(
        eq(enrollments.userId, input.memberId),
        eq(enrollments.courseId, input.courseId),
      ),
    );
  return { revokedGrantCount: revoked.length, accessActive };
}

type ActionConfigurationTarget = Readonly<{
  actionType: AiAgentActionRequest["actionType"];
  targetType: "course" | "group" | "bundle";
  courseId: string | null;
  groupId: string | null;
  bundleId: string | null;
}>;

async function requireAvailableActionTarget(
  tx: ActionTransaction,
  organizationId: string,
  configuration: ActionConfigurationTarget,
) {
  const target = actionTarget(configuration);
  if (target.type === "course") {
    const [row] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.id, target.id),
          eq(courses.organizationId, organizationId),
          eq(courses.status, "published"),
          sql`${courses.publishedVersionId} is not null`,
        ),
      )
      .limit(1);
    if (row) return target;
  } else if (target.type === "group") {
    const [row] = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.id, target.id),
          eq(groups.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (row) return target;
  } else {
    const [row] = await tx
      .select({ id: bundles.id })
      .from(bundles)
      .where(
        and(
          eq(bundles.id, target.id),
          eq(bundles.organizationId, organizationId),
          eq(bundles.active, true),
        ),
      )
      .limit(1);
    if (row) return target;
  }
  throw new ApiError(
    409,
    "conflict",
    "Das Aktionsziel ist nicht mehr aktiv oder mandantenfremd.",
  );
}

async function findActiveAiMembershipProvenance(
  tx: ActionTransaction,
  input: {
    organizationId: string;
    memberId: string;
    target: AiAgentActionTarget;
    lock?: boolean;
  },
) {
  if (input.target.type === "course") return null;
  const query = tx
    .select()
    .from(aiAgentMembershipProvenance)
    .where(
      and(
        eq(
          aiAgentMembershipProvenance.organizationId,
          input.organizationId,
        ),
        eq(aiAgentMembershipProvenance.memberId, input.memberId),
        eq(aiAgentMembershipProvenance.targetType, input.target.type),
        input.target.type === "group"
          ? eq(aiAgentMembershipProvenance.targetGroupId, input.target.id)
          : eq(aiAgentMembershipProvenance.targetBundleId, input.target.id),
        isNull(aiAgentMembershipProvenance.revokedAt),
      ),
    )
    .limit(1);
  const rows = input.lock ? await query.for("update") : await query;
  return rows[0] ?? null;
}

function provenanceSnapshot(
  provenance: Awaited<ReturnType<typeof findActiveAiMembershipProvenance>>,
): AiMembershipProvenanceSnapshot | null {
  if (!provenance || provenance.targetType === "course") return null;
  return {
    organizationId: provenance.organizationId,
    agentId: provenance.agentId,
    memberId: provenance.memberId,
    targetType: provenance.targetType,
    targetGroupId: provenance.targetGroupId,
    targetBundleId: provenance.targetBundleId,
    revokedAt: provenance.revokedAt,
  };
}

async function membershipExists(
  tx: ActionTransaction,
  memberId: string,
  target: AiAgentActionTarget,
  lock = false,
) {
  if (target.type === "course") return false;
  const query =
    target.type === "group"
      ? tx
          .select({ id: groupMembers.groupId })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, target.id),
              eq(groupMembers.userId, memberId),
            ),
          )
          .limit(1)
      : tx
          .select({ id: memberBundles.bundleId })
          .from(memberBundles)
          .where(
            and(
              eq(memberBundles.bundleId, target.id),
              eq(memberBundles.userId, memberId),
            ),
          )
          .limit(1);
  const rows = lock ? await query.for("update") : await query;
  return Boolean(rows[0]);
}

async function assertRequestCanExecute(
  tx: ActionTransaction,
  input: {
    organizationId: string;
    agentId: string;
    memberId: string;
    configuration: ActionConfigurationTarget;
  },
) {
  const target = await requireAvailableActionTarget(
    tx,
    input.organizationId,
    input.configuration,
  );
  if (target.type === "course") {
    const [activeEnrollment] = await tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, input.memberId),
          eq(enrollments.courseId, target.id),
          eq(enrollments.accessActive, true),
        ),
      )
      .limit(1);
    if (input.configuration.actionType === "course_enrollment") {
      if (activeEnrollment) {
        throw new ApiError(
          409,
          "conflict",
          "Das Mitglied besitzt bereits Zugriff auf diesen Kurs.",
        );
      }
    } else {
      const canRevoke = await hasRevocableDirectCourseAccess(tx, {
        organizationId: input.organizationId,
        memberId: input.memberId,
        courseId: target.id,
      });
      if (!activeEnrollment || !canRevoke) {
        throw new ApiError(
          409,
          "conflict",
          "Das Mitglied besitzt keinen direkt entziehbaren Zugriff auf diesen Kurs.",
        );
      }
    }
    return target;
  }

  const assigned = await membershipExists(tx, input.memberId, target);
  if (isAssignmentAction(input.configuration.actionType)) {
    if (assigned) {
      throw new ApiError(
        409,
        "conflict",
        target.type === "group"
          ? "Das Mitglied gehoert bereits zu dieser Gruppe."
          : "Das Bundle ist dem Mitglied bereits zugewiesen.",
      );
    }
    return target;
  }
  const provenance = await findActiveAiMembershipProvenance(tx, {
    organizationId: input.organizationId,
    memberId: input.memberId,
    target,
  });
  if (
    !canRemoveAiMembership({
      organizationId: input.organizationId,
      agentId: input.agentId,
      memberId: input.memberId,
      target,
      assignmentExists: assigned,
      provenance: provenanceSnapshot(provenance),
    })
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Nur eine aktive, durch denselben KI-Agenten erzeugte Zuweisung darf entfernt werden.",
    );
  }
  return target;
}

async function executeApprovedAction(
  tx: ActionTransaction,
  organizationId: string,
  request: AiAgentActionRequest,
  now: Date,
) {
  const target = await requireAvailableActionTarget(tx, organizationId, {
    actionType: request.actionType,
    targetType: request.targetType,
    courseId: request.targetCourseId,
    groupId: request.targetGroupId,
    bundleId: request.targetBundleId,
  });
  if (target.type === "course") {
    if (request.actionType === "course_enrollment") {
      await tx
        .insert(enrollments)
        .values({
          userId: request.requestedById,
          courseId: target.id,
          accessActive: true,
        })
        .onConflictDoUpdate({
          target: [enrollments.userId, enrollments.courseId],
          set: { accessActive: true },
        });
      await tx
        .insert(courseAccessGrants)
        .values({
          organizationId,
          userId: request.requestedById,
          courseId: target.id,
          source: `ai_action:${request.id}`,
        })
        .onConflictDoNothing();
      return { targetType: target.type, accessActive: true };
    }
    return {
      targetType: target.type,
      ...(await revokeDirectCourseAccessInTransaction(tx, {
        organizationId,
        memberId: request.requestedById,
        courseId: target.id,
      })),
    };
  }

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`ai-membership:${organizationId}:${request.requestedById}:${target.type}:${target.id}`}))`,
  );
  await tx.execute(
    sql`select set_config('q_academy.ai_membership_origin', 'ai_action', true)`,
  );
  const assigned = await membershipExists(
    tx,
    request.requestedById,
    target,
    true,
  );
  if (isAssignmentAction(request.actionType)) {
    if (assigned) {
      throw new ApiError(
        409,
        "conflict",
        "Die Zuweisung wurde zwischenzeitlich anderweitig erstellt. Die Anfrage kann nur abgelehnt werden.",
      );
    }
    const execution =
      target.type === "group"
        ? await addMemberToGroupInTransaction(
            tx,
            organizationId,
            target.id,
            request.requestedById,
            "ai_action",
          )
        : await assignBundleToMemberInTransaction(
            tx,
            organizationId,
            request.requestedById,
            target.id,
            "ai_action",
          );
    const created =
      "membershipCreated" in execution
        ? execution.membershipCreated
        : execution.assignmentCreated;
    if (!created) {
      throw new ApiError(
        409,
        "conflict",
        "Die Zuweisung wurde parallel erstellt. Die Anfrage kann nur abgelehnt werden.",
      );
    }
    await tx.insert(aiAgentMembershipProvenance).values({
      organizationId,
      agentId: request.agentId,
      memberId: request.requestedById,
      targetType: target.type,
      targetGroupId: target.type === "group" ? target.id : null,
      targetBundleId: target.type === "bundle" ? target.id : null,
      grantRequestId: request.id,
      grantedAt: now,
    });
    return {
      targetType: target.type,
      assignmentCreated: true,
      affectedCourseGrants:
        "grantsCreated" in execution
          ? execution.grantsCreated
          : execution.courses,
    };
  }

  const provenance = await findActiveAiMembershipProvenance(tx, {
    organizationId,
    memberId: request.requestedById,
    target,
    lock: true,
  });
  if (
    !canRemoveAiMembership({
      organizationId,
      agentId: request.agentId,
      memberId: request.requestedById,
      target,
      assignmentExists: assigned,
      provenance: provenanceSnapshot(provenance),
    })
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Nur eine aktive, durch denselben KI-Agenten erzeugte Zuweisung darf entfernt werden.",
    );
  }
  if (!provenance) {
    throw new ApiError(
      409,
      "conflict",
      "Die Zuweisungsherkunft ist nicht mehr vorhanden.",
    );
  }
  const execution =
    target.type === "group"
      ? await removeMemberFromGroupInTransaction(
          tx,
          organizationId,
          target.id,
          request.requestedById,
          "ai_action",
        )
      : await unassignBundleFromMemberInTransaction(
          tx,
          organizationId,
          request.requestedById,
          target.id,
          "ai_action",
        );
  const removed =
    "membership" in execution
      ? Boolean(execution.membership)
      : Boolean(execution.assignment);
  if (!removed) {
    throw new ApiError(
      409,
      "conflict",
      "Die AI-erzeugte Zuweisung ist nicht mehr vorhanden.",
    );
  }
  const [revoked] = await tx
    .update(aiAgentMembershipProvenance)
    .set({
      revokedByRequestId: request.id,
      revocationReason: "ai_action",
      revokedAt: now,
    })
    .where(
      and(
        eq(aiAgentMembershipProvenance.id, provenance.id),
        isNull(aiAgentMembershipProvenance.revokedAt),
      ),
    )
    .returning({ id: aiAgentMembershipProvenance.id });
  if (!revoked) {
    throw new ApiError(
      409,
      "conflict",
      "Die Zuweisungsherkunft wurde parallel geaendert.",
    );
  }
  return {
    targetType: target.type,
    assignmentRemoved: true,
    affectedCourseGrants:
      "grantsRevoked" in execution
        ? execution.grantsRevoked
        : execution.affectedEnrollments,
  };
}

async function lockRequest(
  tx: ActionTransaction,
  organizationId: string,
  requestId: string,
) {
  const [request] = await tx
    .select()
    .from(aiAgentActionRequests)
    .where(
      and(
        eq(aiAgentActionRequests.id, requestId),
        eq(aiAgentActionRequests.organizationId, organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!request) {
    throw new ApiError(404, "not_found", "Aktionsanfrage nicht gefunden.");
  }
  assertRequestPayload(request);
  return request;
}

export function presentAiAgentActionRequest(request: AiAgentActionRequest) {
  const target = requestActionTarget(request);
  return {
    id: request.id,
    agentId: request.agentId,
    agentVersionId: request.agentVersionId,
    actionConfigurationId: request.actionConfigurationId,
    conversationId: request.conversationId,
    memberId: request.requestedById,
    actionType: request.actionType,
    target,
    targetType: target.type,
    targetCourseId: request.targetCourseId,
    targetGroupId: request.targetGroupId,
    targetBundleId: request.targetBundleId,
    label: request.labelSnapshot,
    status: request.status,
    revision: request.revision,
    decisionNote: request.decisionNote,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    decidedAt: request.decidedAt,
    executedAt: request.executedAt,
    updatedAt: request.updatedAt,
  };
}

function presentAiAgentActionWebhook(request: AiAgentActionRequest) {
  const target = requestActionTarget(request);
  return {
    id: request.id,
    agentId: request.agentId,
    agentVersionId: request.agentVersionId,
    memberId: request.requestedById,
    actionType: request.actionType,
    target,
    targetCourseId: request.targetCourseId,
    targetGroupId: request.targetGroupId,
    targetBundleId: request.targetBundleId,
    label: request.labelSnapshot,
    status: request.status,
    revision: request.revision,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    decidedAt: request.decidedAt,
    executedAt: request.executedAt,
  };
}

export async function createAiAgentActionRequest(input: {
  organizationId: string;
  actor: AiAgentActionActor;
  request: unknown;
}) {
  const requested = aiAgentActionRequestCreateSchema.parse(input.request);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-agent:${input.organizationId}:${requested.agentId}`}))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-action:${input.organizationId}:${requested.memberId}:${requested.actionConfigurationId}`}))`,
    );
    await requireActiveMember(tx, input.organizationId, requested.memberId);
    await requireAiAgentPolicyEnabledInTransaction(tx, input.organizationId);
    await requireAccessiblePublishedAiAgent({
      executor: tx,
      organizationId: input.organizationId,
      userId: requested.memberId,
      agentId: requested.agentId,
    });

    const [configuration] = await tx
      .select({
        id: aiAgentVersionActions.id,
        agentVersionId: aiAgentVersionActions.agentVersionId,
        actionType: aiAgentVersionActions.actionType,
        targetType: aiAgentVersionActions.targetType,
        courseId: aiAgentVersionActions.courseId,
        groupId: aiAgentVersionActions.groupId,
        bundleId: aiAgentVersionActions.bundleId,
        label: aiAgentVersionActions.label,
      })
      .from(aiAgentVersionActions)
      .innerJoin(
        aiAgents,
        and(
          eq(aiAgents.id, requested.agentId),
          eq(aiAgents.organizationId, aiAgentVersionActions.organizationId),
          eq(aiAgents.publishedVersionId, aiAgentVersionActions.agentVersionId),
          eq(aiAgents.active, true),
        ),
      )
      .innerJoin(
        aiAgentVersions,
        and(
          eq(aiAgentVersions.id, aiAgentVersionActions.agentVersionId),
          eq(aiAgentVersions.organizationId, aiAgentVersionActions.organizationId),
          eq(aiAgentVersions.agentId, aiAgents.id),
          eq(aiAgentVersions.state, "published"),
        ),
      )
      .where(
        and(
          eq(aiAgentVersionActions.id, requested.actionConfigurationId),
          eq(aiAgentVersionActions.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!configuration) {
      throw new ApiError(
        404,
        "not_found",
        "Die freigegebene Agentenaktion ist nicht mehr verfuegbar.",
      );
    }

    if (requested.conversationId) {
      const [conversation] = await tx
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, requested.conversationId),
            eq(aiConversations.organizationId, input.organizationId),
            eq(aiConversations.userId, requested.memberId),
            eq(aiConversations.agentId, requested.agentId),
            eq(aiConversations.agentVersionId, configuration.agentVersionId),
          ),
        )
        .limit(1);
      if (!conversation) {
        throw new ApiError(
          409,
          "conflict",
          "Die Konversation passt nicht zur freigegebenen Agentenaktion.",
        );
      }
    }

    const [existing] = await tx
      .select()
      .from(aiAgentActionRequests)
      .where(
        and(
          eq(aiAgentActionRequests.organizationId, input.organizationId),
          eq(aiAgentActionRequests.requestedById, requested.memberId),
          eq(
            aiAgentActionRequests.actionConfigurationId,
            requested.actionConfigurationId,
          ),
          eq(aiAgentActionRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) {
      assertRequestPayload(existing);
      return { request: existing, created: false };
    }

    await assertRequestCanExecute(tx, {
      organizationId: input.organizationId,
      agentId: requested.agentId,
      memberId: requested.memberId,
      configuration,
    });

    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + 7 * 86_400_000);
    const payloadDigest = requestPayloadDigest({
      organizationId: input.organizationId,
      agentId: requested.agentId,
      agentVersionId: configuration.agentVersionId,
      actionConfigurationId: configuration.id,
      requestedById: requested.memberId,
      actionType: configuration.actionType,
      targetType: configuration.targetType,
      targetCourseId: configuration.courseId,
      targetGroupId: configuration.groupId,
      targetBundleId: configuration.bundleId,
      labelSnapshot: configuration.label,
    });
    const [created] = await tx
      .insert(aiAgentActionRequests)
      .values({
        organizationId: input.organizationId,
        agentId: requested.agentId,
        agentVersionId: configuration.agentVersionId,
        actionConfigurationId: configuration.id,
        conversationId: requested.conversationId ?? null,
        requestedById: requested.memberId,
        actionType: configuration.actionType,
        targetType: configuration.targetType,
        targetCourseId: configuration.courseId,
        targetGroupId: configuration.groupId,
        targetBundleId: configuration.bundleId,
        labelSnapshot: configuration.label,
        payloadDigest,
        requestedAt,
        expiresAt,
      })
      .returning();
    if (!created) {
      throw new ApiError(
        500,
        "internal_error",
        "Die Aktionsanfrage konnte nicht erstellt werden.",
      );
    }
    await appendActionEvent(tx, {
      organizationId: input.organizationId,
      requestId: created.id,
      actor: input.actor,
      event: "requested",
      fromStatus: null,
      toStatus: "pending",
      revision: 1,
      payloadDigest,
      metadata: { actionType: created.actionType },
    });
    await appendActivity(tx, {
      organizationId: input.organizationId,
      requestId: created.id,
      actor: input.actor,
      type: "agent.action.requested",
      metadata: { actionType: created.actionType },
    });
    await enqueueWebhook(
      input.organizationId,
      "agent.action.requested",
      presentAiAgentActionWebhook(created),
      tx,
    );
    return { request: created, created: true };
  });
}

export async function cancelAiAgentActionRequest(input: {
  organizationId: string;
  memberId: string;
  actor: AiAgentActionActor;
  requestId: string;
  cancellation: unknown;
}) {
  const cancellation = aiAgentActionCancelSchema.parse(input.cancellation);
  return db.transaction(async (tx) => {
    const current = await lockRequest(tx, input.organizationId, input.requestId);
    if (current.requestedById !== input.memberId) {
      throw new ApiError(404, "not_found", "Aktionsanfrage nicht gefunden.");
    }
    if (current.status !== "pending") {
      throw new ApiError(409, "conflict", "Nur offene Anfragen koennen abgebrochen werden.");
    }
    if (current.revision !== cancellation.expectedRevision) {
      throw new ApiError(409, "conflict", "Die Aktionsanfrage wurde zwischenzeitlich geaendert.");
    }
    const now = new Date();
    const nextRevision = current.revision + 1;
    const [updated] = await tx
      .update(aiAgentActionRequests)
      .set({
        status: "cancelled",
        revision: nextRevision,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiAgentActionRequests.id, current.id),
          eq(aiAgentActionRequests.organizationId, input.organizationId),
          eq(aiAgentActionRequests.status, "pending"),
          eq(aiAgentActionRequests.revision, current.revision),
        ),
      )
      .returning();
    if (!updated) throw new ApiError(409, "conflict", "Die Anfrage wurde parallel geaendert.");
    await appendActionEvent(tx, {
      organizationId: input.organizationId,
      requestId: updated.id,
      actor: input.actor,
      event: "cancelled",
      fromStatus: "pending",
      toStatus: "cancelled",
      revision: nextRevision,
      payloadDigest: updated.payloadDigest,
    });
    await appendActivity(tx, {
      organizationId: input.organizationId,
      requestId: updated.id,
      actor: input.actor,
      type: "agent.action.cancelled",
      metadata: { actionType: updated.actionType },
    });
    await enqueueWebhook(
      input.organizationId,
      "agent.action.cancelled",
      presentAiAgentActionWebhook(updated),
      tx,
    );
    return updated;
  });
}

export async function decideAiAgentActionRequest(input: {
  organizationId: string;
  actorId: string;
  actor: AiAgentActionActor;
  requestId: string;
  decision: unknown;
}) {
  const decision = aiAgentActionDecisionSchema.parse(input.decision);
  const result = await db.transaction(async (tx) => {
    await requireActiveAdmin(tx, input.organizationId, input.actorId);
    const current = await lockRequest(tx, input.organizationId, input.requestId);
    if (current.status !== "pending") {
      throw new ApiError(409, "conflict", "Die Aktionsanfrage wurde bereits entschieden.");
    }
    if (current.revision !== decision.expectedRevision) {
      throw new ApiError(409, "conflict", "Die Aktionsanfrage wurde zwischenzeitlich geaendert.");
    }
    const now = new Date();
    const nextRevision = current.revision + 1;
    if (current.expiresAt <= now) {
      const [expired] = await tx
        .update(aiAgentActionRequests)
        .set({ status: "expired", revision: nextRevision, decidedAt: now, updatedAt: now })
        .where(
          and(
            eq(aiAgentActionRequests.id, current.id),
            eq(aiAgentActionRequests.status, "pending"),
            eq(aiAgentActionRequests.revision, current.revision),
          ),
        )
        .returning();
      if (!expired) throw new ApiError(409, "conflict", "Die Anfrage wurde parallel geaendert.");
      const systemActor: AiAgentActionActor = { kind: "system", id: "action-expiry" };
      await appendActionEvent(tx, {
        organizationId: input.organizationId,
        requestId: expired.id,
        actor: systemActor,
        event: "expired",
        fromStatus: "pending",
        toStatus: "expired",
        revision: nextRevision,
        payloadDigest: expired.payloadDigest,
      });
      await appendActivity(tx, {
        organizationId: input.organizationId,
        requestId: expired.id,
        actor: systemActor,
        type: "agent.action.expired",
        metadata: { actionType: expired.actionType },
      });
      await enqueueWebhook(
        input.organizationId,
        "agent.action.expired",
        presentAiAgentActionWebhook(expired),
        tx,
      );
      return { expired: true as const, request: expired };
    }

    const status = decision.decision === "approve" ? "approved" : "rejected";
    let executionMetadata: Record<string, unknown> = {};
    if (status === "approved") {
      await requireAiAgentPolicyEnabledInTransaction(tx, input.organizationId);
      await requireActiveMember(tx, input.organizationId, current.requestedById);
      executionMetadata = await executeApprovedAction(
        tx,
        input.organizationId,
        current,
        now,
      );
    }

    const [updated] = await tx
      .update(aiAgentActionRequests)
      .set({
        status,
        revision: nextRevision,
        decisionNote: decision.note ?? null,
        decidedById: input.actorId,
        decidedAt: now,
        executedAt: status === "approved" ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiAgentActionRequests.id, current.id),
          eq(aiAgentActionRequests.organizationId, input.organizationId),
          eq(aiAgentActionRequests.status, "pending"),
          eq(aiAgentActionRequests.revision, current.revision),
        ),
      )
      .returning();
    if (!updated) throw new ApiError(409, "conflict", "Die Anfrage wurde parallel geaendert.");

    await appendActionEvent(tx, {
      organizationId: input.organizationId,
      requestId: updated.id,
      actor: input.actor,
      event: status,
      fromStatus: "pending",
      toStatus: status,
      revision: nextRevision,
      payloadDigest: updated.payloadDigest,
      metadata: { actionType: updated.actionType, ...executionMetadata },
    });
    await appendActivity(tx, {
      organizationId: input.organizationId,
      requestId: updated.id,
      actor: input.actor,
      type: `agent.action.${status}`,
      metadata: { actionType: updated.actionType, ...executionMetadata },
    });
    await enqueueWebhook(
      input.organizationId,
      status === "approved" ? "agent.action.approved" : "agent.action.rejected",
      presentAiAgentActionWebhook(updated),
      tx,
    );
    return { expired: false as const, request: updated };
  });
  if (result.expired) {
    throw new ApiError(409, "conflict", "Die Aktionsanfrage ist abgelaufen.");
  }
  return result.request;
}

export async function expireDueAiAgentActionRequests(limit = 100) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const due = await tx
      .select()
      .from(aiAgentActionRequests)
      .where(
        and(
          eq(aiAgentActionRequests.status, "pending"),
          lte(aiAgentActionRequests.expiresAt, now),
        ),
      )
      .orderBy(asc(aiAgentActionRequests.expiresAt), asc(aiAgentActionRequests.id))
      .for("update", { skipLocked: true })
      .limit(Math.max(1, Math.min(limit, 500)));
    const systemActor: AiAgentActionActor = { kind: "system", id: "action-expiry" };
    for (const current of due) {
      assertRequestPayload(current);
      const revision = current.revision + 1;
      const [updated] = await tx
        .update(aiAgentActionRequests)
        .set({ status: "expired", revision, decidedAt: now, updatedAt: now })
        .where(
          and(
            eq(aiAgentActionRequests.id, current.id),
            eq(aiAgentActionRequests.status, "pending"),
            eq(aiAgentActionRequests.revision, current.revision),
          ),
        )
        .returning();
      if (!updated) continue;
      await appendActionEvent(tx, {
        organizationId: updated.organizationId,
        requestId: updated.id,
        actor: systemActor,
        event: "expired",
        fromStatus: "pending",
        toStatus: "expired",
        revision,
        payloadDigest: updated.payloadDigest,
      });
      await appendActivity(tx, {
        organizationId: updated.organizationId,
        requestId: updated.id,
        actor: systemActor,
        type: "agent.action.expired",
        metadata: { actionType: updated.actionType },
      });
      await enqueueWebhook(
        updated.organizationId,
        "agent.action.expired",
        presentAiAgentActionWebhook(updated),
        tx,
      );
    }
    return due.length;
  });
}

export async function listAiAgentActionRequests(input: {
  organizationId: string;
  status?: AiAgentActionRequest["status"];
  memberId?: string;
  agentId?: string;
  limit?: number;
}) {
  const conditions = [
    eq(aiAgentActionRequests.organizationId, input.organizationId),
  ];
  if (input.status) conditions.push(eq(aiAgentActionRequests.status, input.status));
  if (input.memberId) conditions.push(eq(aiAgentActionRequests.requestedById, input.memberId));
  if (input.agentId) conditions.push(eq(aiAgentActionRequests.agentId, input.agentId));
  return db
    .select({
      request: aiAgentActionRequests,
      memberFirstName: users.firstName,
      memberLastName: users.lastName,
      memberEmail: users.email,
      agentName: aiAgentVersions.name,
      agentVersion: aiAgentVersions.version,
      courseTitle: courses.title,
      groupName: groups.name,
      bundleName: bundles.name,
    })
    .from(aiAgentActionRequests)
    .innerJoin(
      users,
      and(
        eq(users.id, aiAgentActionRequests.requestedById),
        eq(users.organizationId, aiAgentActionRequests.organizationId),
      ),
    )
    .innerJoin(
      aiAgentVersions,
      and(
        eq(aiAgentVersions.id, aiAgentActionRequests.agentVersionId),
        eq(aiAgentVersions.organizationId, aiAgentActionRequests.organizationId),
      ),
    )
    .leftJoin(
      courses,
      and(
        eq(courses.id, aiAgentActionRequests.targetCourseId),
        eq(courses.organizationId, aiAgentActionRequests.organizationId),
      ),
    )
    .leftJoin(
      groups,
      and(
        eq(groups.id, aiAgentActionRequests.targetGroupId),
        eq(groups.organizationId, aiAgentActionRequests.organizationId),
      ),
    )
    .leftJoin(
      bundles,
      and(
        eq(bundles.id, aiAgentActionRequests.targetBundleId),
        eq(bundles.organizationId, aiAgentActionRequests.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(aiAgentActionRequests.requestedAt), desc(aiAgentActionRequests.id))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
}

export async function listAiAgentActionEvents(input: {
  organizationId: string;
  requestId: string;
}) {
  const [request] = await db
    .select()
    .from(aiAgentActionRequests)
    .where(
      and(
        eq(aiAgentActionRequests.id, input.requestId),
        eq(aiAgentActionRequests.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!request) {
    throw new ApiError(404, "not_found", "Aktionsanfrage nicht gefunden.");
  }
  assertRequestPayload(request);
  const events = await db
    .select({
      id: aiAgentActionEvents.id,
      event: aiAgentActionEvents.event,
      fromStatus: aiAgentActionEvents.fromStatus,
      toStatus: aiAgentActionEvents.toStatus,
      revision: aiAgentActionEvents.revision,
      payloadDigest: aiAgentActionEvents.payloadDigest,
      createdAt: aiAgentActionEvents.createdAt,
    })
    .from(aiAgentActionEvents)
    .where(
      and(
        eq(aiAgentActionEvents.organizationId, input.organizationId),
        eq(aiAgentActionEvents.requestId, input.requestId),
      ),
    )
    .orderBy(asc(aiAgentActionEvents.revision), asc(aiAgentActionEvents.id));
  if (events.some((event) => event.payloadDigest !== request.payloadDigest)) {
    throw new ApiError(
      409,
      "conflict",
      "Der Auditverlauf hat seine Integritaetspruefung nicht bestanden.",
    );
  }
  return events.map((event) => ({
    id: event.id,
    event: event.event,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    revision: event.revision,
    createdAt: event.createdAt,
  }));
}

export async function listAvailableAiAgentActionsForMember(input: {
  organizationId: string;
  memberId: string;
  agentId: string;
}) {
  const agent = await requireAccessiblePublishedAiAgent({
    organizationId: input.organizationId,
    userId: input.memberId,
    agentId: input.agentId,
  });
  const configuredActions = await db
    .select()
    .from(aiAgentVersionActions)
    .where(
      and(
        eq(aiAgentVersionActions.organizationId, input.organizationId),
        eq(aiAgentVersionActions.agentVersionId, agent.versionId),
      ),
    )
    .orderBy(asc(aiAgentVersionActions.sortOrder), asc(aiAgentVersionActions.id));
  if (!configuredActions.length) return [];
  const courseIds = configuredActions.flatMap((action) =>
    action.targetType === "course" && action.courseId ? [action.courseId] : [],
  );
  const groupIds = configuredActions.flatMap((action) =>
    action.targetType === "group" && action.groupId ? [action.groupId] : [],
  );
  const bundleIds = configuredActions.flatMap((action) =>
    action.targetType === "bundle" && action.bundleId ? [action.bundleId] : [],
  );
  const configurationIds = configuredActions.map((action) => action.id);
  const [
    courseRows,
    groupRows,
    bundleRows,
    activeEnrollments,
    revocableGrants,
    groupMemberships,
    bundleAssignments,
    provenanceRows,
    pendingRequests,
  ] = await Promise.all([
    courseIds.length
      ? db
          .select({ id: courses.id, label: courses.title })
          .from(courses)
          .where(
            and(
              eq(courses.organizationId, input.organizationId),
              eq(courses.status, "published"),
              sql`${courses.publishedVersionId} is not null`,
              inArray(courses.id, courseIds),
            ),
          )
      : Promise.resolve([]),
    groupIds.length
      ? db
          .select({ id: groups.id, label: groups.name })
          .from(groups)
          .where(
            and(
              eq(groups.organizationId, input.organizationId),
              inArray(groups.id, groupIds),
            ),
          )
      : Promise.resolve([]),
    bundleIds.length
      ? db
          .select({ id: bundles.id, label: bundles.name })
          .from(bundles)
          .where(
            and(
              eq(bundles.organizationId, input.organizationId),
              eq(bundles.active, true),
              inArray(bundles.id, bundleIds),
            ),
          )
      : Promise.resolve([]),
    courseIds.length
      ? db
          .select({ courseId: enrollments.courseId })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.userId, input.memberId),
              eq(enrollments.accessActive, true),
              inArray(enrollments.courseId, courseIds),
            ),
          )
      : Promise.resolve([]),
    courseIds.length
      ? db
          .select({ courseId: courseAccessGrants.courseId })
          .from(courseAccessGrants)
          .where(
            and(
              eq(courseAccessGrants.organizationId, input.organizationId),
              eq(courseAccessGrants.userId, input.memberId),
              inArray(courseAccessGrants.courseId, courseIds),
              or(
                like(courseAccessGrants.source, "direct:%"),
                like(courseAccessGrants.source, "ai_action:%"),
              ),
            ),
          )
      : Promise.resolve([]),
    groupIds.length
      ? db
          .select({ id: groupMembers.groupId })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.userId, input.memberId),
              inArray(groupMembers.groupId, groupIds),
            ),
          )
      : Promise.resolve([]),
    bundleIds.length
      ? db
          .select({ id: memberBundles.bundleId })
          .from(memberBundles)
          .where(
            and(
              eq(memberBundles.userId, input.memberId),
              inArray(memberBundles.bundleId, bundleIds),
            ),
          )
      : Promise.resolve([]),
    db
      .select({
        targetType: aiAgentMembershipProvenance.targetType,
        targetGroupId: aiAgentMembershipProvenance.targetGroupId,
        targetBundleId: aiAgentMembershipProvenance.targetBundleId,
      })
      .from(aiAgentMembershipProvenance)
      .where(
        and(
          eq(aiAgentMembershipProvenance.organizationId, input.organizationId),
          eq(aiAgentMembershipProvenance.agentId, input.agentId),
          eq(aiAgentMembershipProvenance.memberId, input.memberId),
          isNull(aiAgentMembershipProvenance.revokedAt),
        ),
      ),
    db
      .select()
      .from(aiAgentActionRequests)
      .where(
        and(
          eq(aiAgentActionRequests.organizationId, input.organizationId),
          eq(aiAgentActionRequests.requestedById, input.memberId),
          eq(aiAgentActionRequests.status, "pending"),
          inArray(aiAgentActionRequests.actionConfigurationId, configurationIds),
        ),
      ),
  ]);
  const labelsByTarget = new Map(
    [...courseRows, ...groupRows, ...bundleRows].map((row) => [row.id, row.label]),
  );
  const grantedCourseIds = new Set(activeEnrollments.map((row) => row.courseId));
  const revocableCourseIds = new Set(revocableGrants.map((row) => row.courseId));
  const assignedGroupIds = new Set(groupMemberships.map((row) => row.id));
  const assignedBundleIds = new Set(bundleAssignments.map((row) => row.id));
  const removableGroupIds = new Set(
    provenanceRows.flatMap((row) =>
      row.targetType === "group" && row.targetGroupId
        ? [row.targetGroupId]
        : [],
    ),
  );
  const removableBundleIds = new Set(
    provenanceRows.flatMap((row) =>
      row.targetType === "bundle" && row.targetBundleId
        ? [row.targetBundleId]
        : [],
    ),
  );
  const pendingByConfiguration = new Map(
    pendingRequests.map((request) => [request.actionConfigurationId, request]),
  );
  return configuredActions.flatMap((action) => {
    const target = actionTarget(action);
    const targetLabel = labelsByTarget.get(target.id);
    if (!targetLabel) return [];
    const pending = pendingByConfiguration.get(action.id);
    const assigned =
      target.type === "course"
        ? grantedCourseIds.has(target.id)
        : target.type === "group"
          ? assignedGroupIds.has(target.id)
          : assignedBundleIds.has(target.id);
    const removable =
      target.type === "course"
        ? revocableCourseIds.has(target.id)
        : target.type === "group"
          ? removableGroupIds.has(target.id) && assigned
          : removableBundleIds.has(target.id) && assigned;
    const state = pending
      ? ("pending" as const)
      : isAssignmentAction(action.actionType)
        ? assigned
          ? ("granted" as const)
          : ("available" as const)
        : removable
          ? ("available" as const)
          : ("completed" as const);
    return [{
      id: action.id,
      agentVersionId: agent.versionId,
      actionType: action.actionType,
      target,
      targetType: target.type,
      targetId: target.id,
      targetLabel,
      courseId: target.type === "course" ? target.id : null,
      courseTitle: target.type === "course" ? targetLabel : null,
      label: action.label,
      description: action.description,
      state,
      request: pending ? presentAiAgentActionRequest(pending) : null,
    }];
  });
}
