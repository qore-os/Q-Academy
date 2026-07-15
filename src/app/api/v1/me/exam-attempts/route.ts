import {
  examAttemptStartSchema,
  EXAM_SESSION_JSON_MAX_BYTES,
} from "@/lib/exam-lifecycle-model";
import { startOrResumeExamAttempt } from "@/lib/exam-lifecycle";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "exam_attempt.start" },
    async (user) => {
      const input = examAttemptStartSchema.parse(
        await parseSessionJson(request, {
          maxBytes: EXAM_SESSION_JSON_MAX_BYTES,
        }),
      );
      const attempt = await startOrResumeExamAttempt({
        organizationId: user.organizationId,
        userId: user.id,
        ...input,
      });
      return sessionData(request, attempt, attempt.resumed ? 200 : 201);
    },
  );
}
