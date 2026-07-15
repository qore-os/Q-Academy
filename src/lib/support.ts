import "server-only";

import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationSupportSettings, type User } from "@/db/schema";
import { decryptWebhookSecret } from "@/lib/api/crypto";

export type SupportLauncherConfiguration =
  | { provider: "link"; label: string; url: string }
  | { provider: "email"; label: string; email: string }
  | {
      provider: "intercom";
      label: string;
      appId: string;
      userHash: string | null;
      userId: string;
      email: string;
      name: string;
    };

export async function getSupportSettings(organizationId: string) {
  const [settings] = await db
    .select()
    .from(organizationSupportSettings)
    .where(eq(organizationSupportSettings.organizationId, organizationId))
    .limit(1);
  return settings ?? {
    organizationId,
    enabled: false,
    provider: "link" as const,
    launcherLabel: "Support",
    supportUrl: null,
    supportEmail: null,
    intercomAppId: null,
    identitySecretEncrypted: null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function getSupportLauncherConfiguration(
  user: Pick<User, "id" | "organizationId" | "email" | "firstName" | "lastName">,
): Promise<SupportLauncherConfiguration | null> {
  const settings = await getSupportSettings(user.organizationId);
  if (!settings.enabled) return null;
  if (settings.provider === "link" && settings.supportUrl) {
    return {
      provider: "link",
      label: settings.launcherLabel,
      url: settings.supportUrl,
    };
  }
  if (settings.provider === "email" && settings.supportEmail) {
    return {
      provider: "email",
      label: settings.launcherLabel,
      email: settings.supportEmail,
    };
  }
  if (settings.provider === "intercom" && settings.intercomAppId) {
    let userHash: string | null = null;
    if (settings.identitySecretEncrypted) {
      const secret = decryptWebhookSecret(settings.identitySecretEncrypted);
      userHash = createHmac("sha256", secret).update(user.id).digest("hex");
    }
    return {
      provider: "intercom",
      label: settings.launcherLabel,
      appId: settings.intercomAppId,
      userHash,
      userId: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
    };
  }
  return null;
}
