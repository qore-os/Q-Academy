import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  enrollments,
  lessonLearningTimeSessions,
  users,
} from "@/db/schema";
import { getCourseLearningAccess } from "@/lib/learning-access";
import {
  LEARNING_TIME_MAX_INTERVAL_MS,
  calculateLearningTimeCredit,
  classifyLearningTimeSequence,
  type LearningTimeHeartbeatInput,
} from "@/lib/learning-time-policy";

type LearningTimeTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export class LearningTimeHeartbeatError extends Error {
  constructor(
    readonly status: 403 | 409,
    readonly code:
      | "learning_access_denied"
      | "heartbeat_sequence_gap"
      | "heartbeat_too_soon"
      | "tracking_session_expired"
      | "tracking_session_conflict"
      | "course_version_changed"
      | "parallel_tracking_session",
    message: string,
  ) {
    super(message);
    this.name = "LearningTimeHeartbeatError";
  }
}

async function assertCurrentLessonAccess(
  tx: LearningTimeTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    now: Date;
  },
) {
  const [member] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new LearningTimeHeartbeatError(
      403,
      "learning_access_denied",
      "Aktive Lernzeit kann nur fuer ein aktives Mitglied erfasst werden.",
    );
  }

  const access = await getCourseLearningAccess(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    courseId: input.courseId,
    now: input.now,
  });
  if (!access) {
    throw new LearningTimeHeartbeatError(
      403,
      "learning_access_denied",
      "Der Kurs ist fuer dieses Mitglied aktuell nicht freigegeben.",
    );
  }
  const lesson = access.lessons.get(input.lessonId);
  if (!lesson?.access.accessible) {
    throw new LearningTimeHeartbeatError(
      403,
      "learning_access_denied",
      "Die Lektion ist fuer dieses Mitglied aktuell nicht freigegeben.",
    );
  }
  const lessonTitle = lesson.lesson.title;
  if (
    typeof lessonTitle !== "string" ||
    lessonTitle.trim().length === 0 ||
    lessonTitle.length > 220
  ) {
    throw new LearningTimeHeartbeatError(
      403,
      "learning_access_denied",
      "Die publizierte Lektion enthaelt keine gueltige Tracking-Bezeichnung.",
    );
  }
  return {
    courseVersionId: access.published.versionId,
    lessonTitle,
  };
}

function activeParallelSession(input: {
  latestSessionId: string;
  requestedSessionId: string;
  latestHeartbeatAt: Date;
  now: Date;
}) {
  return (
    input.latestSessionId !== input.requestedSessionId &&
    input.now.getTime() - input.latestHeartbeatAt.getTime() <=
      LEARNING_TIME_MAX_INTERVAL_MS
  );
}

function postgresErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

export type RecordedLearningTimeHeartbeat = {
  trackingSessionId: string;
  sequence: number;
  creditedSeconds: number;
  sessionActiveSeconds: number;
  duplicate: boolean;
  receivedAt: string;
};

export async function recordLearningTimeHeartbeat(input: {
  organizationId: string;
  userId: string;
  heartbeat: LearningTimeHeartbeatInput;
  now?: Date;
}): Promise<RecordedLearningTimeHeartbeat> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("now must be valid.");
  const heartbeat = input.heartbeat;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`learning-time:${input.organizationId}:${input.userId}`}, 0))`,
    );

    const snapshotBinding = await assertCurrentLessonAccess(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: heartbeat.courseId,
      lessonId: heartbeat.lessonId,
      now,
    });

    const [existingRows, latestRows] = await Promise.all([
      tx
        .select({
          id: lessonLearningTimeSessions.id,
          courseId: lessonLearningTimeSessions.courseId,
          courseVersionId: lessonLearningTimeSessions.courseVersionId,
          lessonId: lessonLearningTimeSessions.lessonId,
          lessonTitle: lessonLearningTimeSessions.lessonTitle,
          lastSequence: lessonLearningTimeSessions.lastSequence,
          activeSeconds: lessonLearningTimeSessions.activeSeconds,
          lastHeartbeatAt: lessonLearningTimeSessions.lastHeartbeatAt,
        })
        .from(lessonLearningTimeSessions)
        .where(
          and(
            eq(lessonLearningTimeSessions.id, heartbeat.trackingSessionId),
            eq(
              lessonLearningTimeSessions.organizationId,
              input.organizationId,
            ),
            eq(lessonLearningTimeSessions.userId, input.userId),
          ),
        )
        .limit(1),
      tx
        .select({
          id: lessonLearningTimeSessions.id,
          lastHeartbeatAt: lessonLearningTimeSessions.lastHeartbeatAt,
        })
        .from(lessonLearningTimeSessions)
        .where(
          and(
            eq(
              lessonLearningTimeSessions.organizationId,
              input.organizationId,
            ),
            eq(lessonLearningTimeSessions.userId, input.userId),
          ),
        )
        .orderBy(
          desc(lessonLearningTimeSessions.lastHeartbeatAt),
          desc(lessonLearningTimeSessions.startedAt),
          desc(lessonLearningTimeSessions.id),
        )
        .limit(1),
    ]);
    const existing = existingRows[0];
    const latest = latestRows[0];

    if (!existing) {
      if (heartbeat.sequence !== 0) {
        throw new LearningTimeHeartbeatError(
          409,
          "heartbeat_sequence_gap",
          "Eine neue Tracking-Sitzung muss mit Sequenz 0 beginnen.",
        );
      }
      try {
        await tx.insert(lessonLearningTimeSessions).values({
          id: heartbeat.trackingSessionId,
          organizationId: input.organizationId,
          userId: input.userId,
          courseId: heartbeat.courseId,
          courseVersionId: snapshotBinding.courseVersionId,
          lessonId: heartbeat.lessonId,
          lessonTitle: snapshotBinding.lessonTitle,
          lastSequence: 0,
          activeSeconds: 0,
          startedAt: now,
          lastHeartbeatAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (postgresErrorCode(error) !== "23505") throw error;
        throw new LearningTimeHeartbeatError(
          409,
          "tracking_session_conflict",
          "Die Tracking-Sitzung konnte nicht eindeutig angelegt werden.",
        );
      }
      await tx
        .update(enrollments)
        .set({ lastAccessedAt: now })
        .where(
          and(
            eq(enrollments.userId, input.userId),
            eq(enrollments.courseId, heartbeat.courseId),
            eq(enrollments.accessActive, true),
          ),
        );
      return {
        trackingSessionId: heartbeat.trackingSessionId,
        sequence: 0,
        creditedSeconds: 0,
        sessionActiveSeconds: 0,
        duplicate: false,
        receivedAt: now.toISOString(),
      };
    }

    if (
      existing.courseId !== heartbeat.courseId ||
      existing.lessonId !== heartbeat.lessonId
    ) {
      throw new LearningTimeHeartbeatError(
        409,
        "tracking_session_conflict",
        "Die Tracking-Sitzung ist bereits an eine andere Lektion gebunden.",
      );
    }
    if (
      existing.courseVersionId !== snapshotBinding.courseVersionId ||
      existing.lessonTitle !== snapshotBinding.lessonTitle
    ) {
      throw new LearningTimeHeartbeatError(
        409,
        "course_version_changed",
        "Die publizierte Kursversion hat gewechselt. Eine neue Tracking-Sitzung ist erforderlich.",
      );
    }

    const sequence = classifyLearningTimeSequence(
      existing.lastSequence,
      heartbeat.sequence,
    );
    if (sequence.kind === "duplicate") {
      return {
        trackingSessionId: existing.id,
        sequence: heartbeat.sequence,
        creditedSeconds: 0,
        sessionActiveSeconds: existing.activeSeconds,
        duplicate: true,
        receivedAt: existing.lastHeartbeatAt.toISOString(),
      };
    }
    if (sequence.kind === "gap") {
      throw new LearningTimeHeartbeatError(
        409,
        "heartbeat_sequence_gap",
        "Der Heartbeat folgt nicht direkt auf die letzte bestaetigte Sequenz.",
      );
    }
    if (
      latest &&
      activeParallelSession({
        latestSessionId: latest.id,
        requestedSessionId: existing.id,
        latestHeartbeatAt: latest.lastHeartbeatAt,
        now,
      })
    ) {
      throw new LearningTimeHeartbeatError(
        409,
        "parallel_tracking_session",
        "Eine neuere aktive Lektionsansicht hat diese Tracking-Sitzung ersetzt.",
      );
    }

    const credit = calculateLearningTimeCredit({
      previousHeartbeatAt: existing.lastHeartbeatAt,
      receivedAt: now,
      currentActiveSeconds: existing.activeSeconds,
    });
    if (!credit.ok) {
      throw credit.reason === "too_soon"
        ? new LearningTimeHeartbeatError(
            409,
            "heartbeat_too_soon",
            "Der Heartbeat wurde zu frueh gesendet.",
          )
        : new LearningTimeHeartbeatError(
            409,
            "tracking_session_expired",
            "Die Tracking-Sitzung ist abgelaufen und muss neu gestartet werden.",
          );
    }

    const sessionActiveSeconds =
      existing.activeSeconds + credit.creditedSeconds;
    const [updated] = await tx
      .update(lessonLearningTimeSessions)
      .set({
        lastSequence: heartbeat.sequence,
        activeSeconds: sessionActiveSeconds,
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(lessonLearningTimeSessions.id, existing.id),
          eq(
            lessonLearningTimeSessions.organizationId,
            input.organizationId,
          ),
          eq(lessonLearningTimeSessions.userId, input.userId),
          eq(lessonLearningTimeSessions.lastSequence, existing.lastSequence),
        ),
      )
      .returning({ id: lessonLearningTimeSessions.id });
    if (!updated) {
      throw new LearningTimeHeartbeatError(
        409,
        "tracking_session_conflict",
        "Die Tracking-Sitzung wurde parallel veraendert.",
      );
    }
    await tx
      .update(enrollments)
      .set({ lastAccessedAt: now })
      .where(
        and(
          eq(enrollments.userId, input.userId),
          eq(enrollments.courseId, heartbeat.courseId),
          eq(enrollments.accessActive, true),
        ),
      );
    return {
      trackingSessionId: existing.id,
      sequence: heartbeat.sequence,
      creditedSeconds: credit.creditedSeconds,
      sessionActiveSeconds,
      duplicate: false,
      receivedAt: now.toISOString(),
    };
  });
}
