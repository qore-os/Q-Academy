import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { assessmentAttempts } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  coursePermissionAllows,
  coursePermissionForUser,
} from "@/lib/course-permissions";
import { releaseExamAttempt } from "@/lib/exam-lifecycle";
import {
  examAttemptReleaseSchema,
  EXAM_SESSION_JSON_MAX_BYTES,
} from "@/lib/exam-lifecycle-model";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSessionRequest(
    request,
    { mutation: true, action: "exam_attempt.release" },
    async (user) => {
      const [attempt] = await db
        .select({ courseId: assessmentAttempts.courseId })
        .from(assessmentAttempts)
        .where(
          and(
            eq(assessmentAttempts.id, id),
            eq(assessmentAttempts.organizationId, user.organizationId),
          ),
        )
        .limit(1);
      if (!attempt) {
        throw new ApiError(404, "not_found", "Pruefungsversuch nicht gefunden.");
      }
      const permission = await coursePermissionForUser(user, attempt.courseId);
      if (!coursePermissionAllows(permission, "edit")) {
        throw new ApiError(404, "not_found", "Pruefungsversuch nicht gefunden.");
      }
      const input = examAttemptReleaseSchema.parse(
        await parseSessionJson(request, {
          maxBytes: EXAM_SESSION_JSON_MAX_BYTES,
        }),
      );
      return sessionData(
        request,
        await releaseExamAttempt({
          organizationId: user.organizationId,
          actorUserId: user.id,
          attemptId: id,
          ...input,
        }),
      );
    },
  );
}
