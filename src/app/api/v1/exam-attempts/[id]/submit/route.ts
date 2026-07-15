import { submitExamAttempt } from "@/lib/exam-lifecycle";
import { examAttemptSubmitSchema } from "@/lib/exam-lifecycle-model";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["assessments:write"],
      action: "exam_attempt.submit",
      resourceType: "assessment_attempt",
      idempotent: true,
    },
    async (context) => ({
      data: await submitExamAttempt({
        organizationId: context.organizationId,
        attemptId: id,
        ...(await parseJson(request, examAttemptSubmitSchema)),
      }),
      resourceId: id,
    }),
  );
}
