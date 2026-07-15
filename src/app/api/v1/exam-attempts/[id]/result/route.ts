import { getExamAttemptResult } from "@/lib/exam-lifecycle";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["assessments:read"],
      action: "exam_attempt.result",
      resourceType: "assessment_attempt",
    },
    async (context) => ({
      data: await getExamAttemptResult({
        organizationId: context.organizationId,
        attemptId: id,
      }),
      resourceId: id,
    }),
  );
}
