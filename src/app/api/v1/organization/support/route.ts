import { db } from "@/db";
import { organizationSupportSettings } from "@/db/schema";
import { encryptWebhookSecret } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { supportSettingsInputSchema } from "@/lib/commerce/model";
import { getSupportSettings } from "@/lib/support";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function publicSettings(settings: Awaited<ReturnType<typeof getSupportSettings>>) {
  const { identitySecretEncrypted: _secret, ...safe } = settings;
  return { ...safe, identitySecretConfigured: Boolean(_secret) };
}

export async function GET(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:read"],
    action: "support.settings.read",
    resourceType: "support_settings",
  }, async (context) => ({
    data: publicSettings(await getSupportSettings(context.organizationId)),
  }));
}

export async function PATCH(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:write"],
    action: "support.settings.update",
    resourceType: "support_settings",
    idempotent: true,
  }, async (context) => {
    const input = await parseJson(request, supportSettingsInputSchema);
    const current = await getSupportSettings(context.organizationId);
    const encryptedSecret = input.clearIdentitySecret
      ? null
      : input.identitySecret
        ? encryptWebhookSecret(input.identitySecret)
        : current.identitySecretEncrypted;
    if (input.enabled && input.provider === "intercom" && !encryptedSecret) {
      throw new ApiError(
        422,
        "validation_error",
        "Fuer Intercom fehlt das Identity-Secret.",
      );
    }
    const [saved] = await db.insert(organizationSupportSettings).values({
      organizationId: context.organizationId,
      enabled: input.enabled,
      provider: input.provider,
      launcherLabel: input.launcherLabel,
      supportUrl: input.supportUrl,
      supportEmail: input.supportEmail,
      intercomAppId: input.intercomAppId,
      identitySecretEncrypted: encryptedSecret,
    }).onConflictDoUpdate({
      target: organizationSupportSettings.organizationId,
      set: {
        enabled: input.enabled,
        provider: input.provider,
        launcherLabel: input.launcherLabel,
        supportUrl: input.supportUrl,
        supportEmail: input.supportEmail,
        intercomAppId: input.intercomAppId,
        identitySecretEncrypted: encryptedSecret,
        updatedAt: new Date(),
      },
    }).returning();
    return { data: publicSettings(saved), resourceId: context.organizationId };
  });
}
