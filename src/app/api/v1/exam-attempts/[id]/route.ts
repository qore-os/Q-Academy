import {
  getExamAttempt,
  saveExamAttemptDraft,
} from "@/lib/exam-lifecycle";
import { examAttemptDraftSchema } from "@/lib/exam-lifecycle-model";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["assessments:read"],
      action: "exam_attempt.read",
      resourceType: "assessment_attempt",
    },
    async (context) => ({
      data: await getExamAttempt({
        organizationId: context.organizationId,
        attemptId: id,
      }),
      resourceId: id,
    }),
  );
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["assessments:write"],
      action: "exam_attempt.autosave",
      resourceType: "assessment_attempt",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, examAttemptDraftSchema);
      return {
        data: await saveExamAttemptDraft({
          organizationId: context.organizationId,
          attemptId: id,
          ...input,
        }),
        resourceId: id,
      };
    },
  );
}
