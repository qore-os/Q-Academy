import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberWelcomeSettings } from "@/db/schema";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { updateMemberWelcomeSettings } from "@/lib/member-welcome";
import { memberWelcomeSettingsUpdateSchema } from "@/lib/member-welcome-model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["organization:read"],
      action: "organization.welcome.read",
      resourceType: "member_welcome_settings",
    },
    async (context) => {
      const [settings] = await db
        .select()
        .from(memberWelcomeSettings)
        .where(
          eq(memberWelcomeSettings.organizationId, context.organizationId),
        )
        .limit(1);
      return {
        data: settings ?? {
          organizationId: context.organizationId,
          enabled: false,
          title: "Willkommen in deiner Academy",
          welcomeText:
            "Schoen, dass du da bist. Hier findest du alles fuer deinen Lernstart.",
          videoUrl: null,
          promptProfileImage: false,
          promptProfileCompletion: false,
          version: 0,
          createdAt: null,
          updatedAt: null,
        },
        resourceId: context.organizationId,
      };
    },
  );
}

export async function PATCH(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["organization:write"],
      action: "organization.welcome.update",
      resourceType: "member_welcome_settings",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, memberWelcomeSettingsUpdateSchema),
      execute: async (tools, patch) => {
        const saved = await updateMemberWelcomeSettings(tools.tx, {
          organizationId: tools.context.organizationId,
          source: "api",
          patch,
        });
        return {
          data: {
            organizationId: tools.context.organizationId,
            enabled: saved.enabled,
            title: saved.title,
            welcomeText: saved.welcomeText,
            videoUrl: saved.videoUrl,
            promptProfileImage: saved.promptProfileImage,
            promptProfileCompletion: saved.promptProfileCompletion,
            version: saved.version,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
          },
          resourceId: tools.context.organizationId,
        };
      },
    },
  );
}
