import "server-only";

import { and, eq, gt, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  courseModules,
  courses,
  editorPresences,
  lessonPages,
  lessons,
  modules,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  requireCoursePermissionInTransaction,
  coursePermissionForUser,
  coursePermissionAllows,
} from "@/lib/course-permissions";
import {
  collapseEditorPresences,
  presenceExpiry,
  type EditorPresenceHeartbeat,
} from "@/lib/editor-presence-model";
import { safeAvatarSource } from "@/lib/avatar-policy";

type PresenceActor = Pick<User, "id" | "organizationId" | "role">;

async function assertEditorScope(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    organizationId: string;
    courseId: string;
    lessonId: string | null;
    pageId: string | null;
  },
) {
  if (!input.lessonId) return;
  const [scope] = await tx
    .select({ lessonId: lessons.id, pageId: lessonPages.id })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, input.organizationId),
      ),
    )
    .innerJoin(
      courseModules,
      and(
        eq(courseModules.moduleId, modules.id),
        eq(courseModules.courseId, input.courseId),
      ),
    )
    .leftJoin(
      lessonPages,
      and(
        eq(lessonPages.lessonId, lessons.id),
        ...(input.pageId ? [eq(lessonPages.id, input.pageId)] : []),
      ),
    )
    .where(eq(lessons.id, input.lessonId))
    .limit(1);
  if (!scope || (input.pageId && scope.pageId !== input.pageId)) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Editorposition gehoert nicht zu diesem Kurs.",
    );
  }
}

async function activePresences(
  organizationId: string,
  courseId: string,
  now: Date,
) {
  const rows = await db
    .select({
      userId: editorPresences.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarUrl: users.avatarUrl,
      lessonId: editorPresences.lessonId,
      pageId: editorPresences.pageId,
      expiresAt: editorPresences.expiresAt,
    })
    .from(editorPresences)
    .innerJoin(
      users,
      and(
        eq(users.id, editorPresences.userId),
        eq(users.organizationId, editorPresences.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(editorPresences.organizationId, organizationId),
        eq(editorPresences.courseId, courseId),
        gt(editorPresences.expiresAt, now),
      ),
    );
  return collapseEditorPresences(
    rows.map((row) => ({
      userId: row.userId,
      displayName: `${row.firstName} ${row.lastName}`.trim(),
      avatarUrl: safeAvatarSource(row.avatarUrl),
      lessonId: row.lessonId,
      pageId: row.pageId,
      expiresAt: row.expiresAt.toISOString(),
    })),
  );
}

export async function listEditorPresencesForSession(
  actor: PresenceActor,
  courseId: string,
) {
  const permission = await coursePermissionForUser(actor, courseId);
  if (!coursePermissionAllows(permission, "edit")) {
    throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  }
  return activePresences(actor.organizationId, courseId, new Date());
}

export async function listEditorPresencesForApi(
  organizationId: string,
  courseId: string,
) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  return activePresences(organizationId, courseId, new Date());
}

export async function heartbeatEditorPresence(
  actor: PresenceActor,
  courseId: string,
  heartbeat: EditorPresenceHeartbeat,
) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await requireCoursePermissionInTransaction(tx, actor, courseId, "edit");
    const [existing] = await tx
      .select({
        id: editorPresences.id,
        organizationId: editorPresences.organizationId,
        courseId: editorPresences.courseId,
        userId: editorPresences.userId,
      })
      .from(editorPresences)
      .where(eq(editorPresences.id, heartbeat.clientId))
      .limit(1)
      .for("update");
    if (
      existing &&
      (existing.organizationId !== actor.organizationId ||
        existing.courseId !== courseId ||
        existing.userId !== actor.id)
    ) {
      throw new ApiError(409, "conflict", "Die Editor-Sitzung ist bereits vergeben.");
    }
    if (heartbeat.leave) {
      if (existing) await tx.delete(editorPresences).where(eq(editorPresences.id, existing.id));
      return;
    }
    await assertEditorScope(tx, {
      organizationId: actor.organizationId,
      courseId,
      lessonId: heartbeat.lessonId,
      pageId: heartbeat.pageId,
    });
    const expiresAt = presenceExpiry(now);
    if (existing) {
      await tx
        .update(editorPresences)
        .set({
          lessonId: heartbeat.lessonId,
          pageId: heartbeat.pageId,
          lastSeenAt: now,
          expiresAt,
        })
        .where(eq(editorPresences.id, existing.id));
    } else {
      await tx.insert(editorPresences).values({
        id: heartbeat.clientId,
        organizationId: actor.organizationId,
        courseId,
        userId: actor.id,
        lessonId: heartbeat.lessonId,
        pageId: heartbeat.pageId,
        lastSeenAt: now,
        expiresAt,
        createdAt: now,
      });
    }
    await tx
      .delete(editorPresences)
      .where(
        and(
          lte(editorPresences.expiresAt, now),
          eq(editorPresences.organizationId, actor.organizationId),
          eq(editorPresences.courseId, courseId),
        ),
      );
  });
  return activePresences(actor.organizationId, courseId, now);
}
