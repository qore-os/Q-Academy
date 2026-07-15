import {
  getEmailTemplateSettings,
  requireEmailApiKeyActor,
  updateEmailTemplateSettings,
} from "@/lib/email-center";
import {
  emailTemplateLocaleQuerySchema,
  emailTemplateSettingsUpdateSchema,
} from "@/lib/email-center-model";
import { listMemberPropertyVariableCatalog } from "@/lib/member-properties";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["email:read"],
      action: "email.template.read",
      resourceType: "email_template_settings",
    },
    async (context) => {
      const query = emailTemplateLocaleQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      return {
        data: await getEmailTemplateSettings(
          context.organizationId,
          query.locale,
        ),
        resourceId: context.organizationId,
      };
    },
  );
}

export async function PATCH(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["email:write"],
      action: "email.template.update",
      resourceType: "email_template_settings",
      idempotent: true,
    },
    {
      prepare: async (context) => {
        const propertyTokens = (
          await listMemberPropertyVariableCatalog(context.organizationId)
        ).map((entry) => entry.emailToken);
        return parseJson(
          request,
          emailTemplateSettingsUpdateSchema({
            "feedback.reply": propertyTokens,
            "lesson.available": propertyTokens,
          }),
        );
      },
      execute: async (tools, input) => {
        const actorUserId = await requireEmailApiKeyActor(tools.tx, {
          organizationId: tools.context.organizationId,
          apiKeyId: tools.context.apiKeyId,
        });
        const saved = await updateEmailTemplateSettings(tools.tx, {
          organizationId: tools.context.organizationId,
          actorUserId,
          source: "api",
          locale: input.locale,
          settings: {
            version: input.version,
            templates: input.templates,
          },
        });
        return {
          data: saved,
          resourceId: tools.context.organizationId,
        };
      },
    },
  );
}
