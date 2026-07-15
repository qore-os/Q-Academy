import {
  getExamAttempt,
  saveExamAttemptDraft,
} from "@/lib/exam-lifecycle";
import {
  examAttemptDraftSchema,
  EXAM_SESSION_JSON_MAX_BYTES,
} from "@/lib/exam-lifecycle-model";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  return handleSessionRequest(
    request,
    { action: "exam_attempt.read" },
    async (user) =>
      sessionData(
        request,
        await getExamAttempt({
          organizationId: user.organizationId,
          userId: user.id,
          attemptId: id,
        }),
      ),
  );
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  return handleSessionRequest(
    request,
    { mutation: true, action: "exam_attempt.autosave" },
    async (user) => {
      const input = examAttemptDraftSchema.parse(
        await parseSessionJson(request, {
          maxBytes: EXAM_SESSION_JSON_MAX_BYTES,
        }),
      );
      return sessionData(
        request,
        await saveExamAttemptDraft({
          organizationId: user.organizationId,
          userId: user.id,
          attemptId: id,
          ...input,
        }),
      );
    },
  );
}
