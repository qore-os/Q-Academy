import { requireEmailApiKeyActor } from "@/lib/email-center";
import { releaseEmailSuppression } from "@/lib/email-feedback";
import { emailSuppressionReleaseSchema } from "@/lib/email-feedback-model";
import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["email:write"],
      action: "email.suppression.release",
      resourceType: "email_suppression",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, emailSuppressionReleaseSchema),
      execute: async (tools, body) => {
        const actorId = await requireEmailApiKeyActor(tools.tx, {
          organizationId: tools.context.organizationId,
          apiKeyId: tools.context.apiKeyId,
        });
        const result = await releaseEmailSuppression(tools.tx, {
          organizationId: tools.context.organizationId,
          suppressionId: id,
          actorId,
          reason: body.reason,
          source: "api",
        });
        return {
          data: result,
          resourceId: result.id,
        };
      },
    },
  );
}
