import { startOrResumeExamAttempt } from "@/lib/exam-lifecycle";
import { examAttemptApiStartSchema } from "@/lib/exam-lifecycle-model";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["assessments:write", "courses:read"],
      action: "exam_attempt.start",
      resourceType: "assessment_attempt",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, examAttemptApiStartSchema);
      const attempt = await startOrResumeExamAttempt({
        organizationId: context.organizationId,
        ...input,
      });
      return {
        data: attempt,
        status: attempt.resumed ? 200 : 201,
        resourceId: attempt.id,
      };
    },
  );
}
