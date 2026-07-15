import { submitExamAttempt } from "@/lib/exam-lifecycle";
import {
  examAttemptSubmitSchema,
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
    { mutation: true, action: "exam_attempt.submit" },
    async (user) => {
      const input = examAttemptSubmitSchema.parse(
        await parseSessionJson(request, {
          maxBytes: EXAM_SESSION_JSON_MAX_BYTES,
        }),
      );
      return sessionData(
        request,
        await submitExamAttempt({
          organizationId: user.organizationId,
          userId: user.id,
          attemptId: id,
          ...input,
        }),
      );
    },
  );
}
