import "server-only";

import { and, asc, eq, gt, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { assessmentAttempts } from "@/db/schema";
import type { ActiveExamContentLock } from "@/lib/exam-content-access-policy";

export {
  activeExamBlocksContent,
  type ActiveExamContentLock,
} from "@/lib/exam-content-access-policy";

type ExamContentAccessReader = Pick<typeof db, "select">;

export async function getActiveExamContentLock(
  reader: ExamContentAccessReader,
  input: { organizationId: string; userId: string; now?: Date },
): Promise<ActiveExamContentLock | null> {
  const now = input.now ?? new Date();
  const [attempt] = await reader
    .select({
      attemptId: assessmentAttempts.id,
      courseId: assessmentAttempts.courseId,
      lessonId: assessmentAttempts.lessonId,
      mode: assessmentAttempts.contentAccessMode,
      deadlineAt: assessmentAttempts.deadlineAt,
    })
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.organizationId, input.organizationId),
        eq(assessmentAttempts.userId, input.userId),
        or(
          eq(assessmentAttempts.status, "in_progress"),
          eq(assessmentAttempts.status, "submitted"),
        ),
        ne(assessmentAttempts.contentAccessMode, "allow"),
        or(
          isNull(assessmentAttempts.deadlineAt),
          gt(assessmentAttempts.deadlineAt, now),
        ),
      ),
    )
    .orderBy(asc(assessmentAttempts.startedAt), asc(assessmentAttempts.id))
    .limit(1);

  if (!attempt || attempt.mode === "allow") return null;
  return { ...attempt, mode: attempt.mode };
}
