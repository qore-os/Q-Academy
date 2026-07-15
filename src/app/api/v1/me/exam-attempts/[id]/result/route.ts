import { getExamAttemptResult } from "@/lib/exam-lifecycle";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSessionRequest(
    request,
    { action: "exam_attempt.result" },
    async (user) =>
      sessionData(
        request,
        await getExamAttemptResult({
          organizationId: user.organizationId,
          userId: user.id,
          attemptId: id,
        }),
      ),
  );
}
