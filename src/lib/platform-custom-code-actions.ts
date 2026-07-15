"use server";

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { activityEvents, platformSettings } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import type { PlatformCustomCodeMessageCode } from "@/lib/i18n/platform-custom-code";
import {
  DEFAULT_PLATFORM_CUSTOM_CODE,
  normalizePlatformCustomCodeValue,
  parsePlatformCustomCodeOrigins,
  PLATFORM_CUSTOM_CODE_SETTING_KEY,
  platformCustomCodeInputSchema,
  storedPlatformCustomCodeSchema,
} from "@/lib/platform-custom-code";
import { logServerError } from "@/lib/server-error-logging";

export type PlatformCustomCodeActionState = {
  ok: boolean | null;
  code?: PlatformCustomCodeMessageCode;
  revision?: number;
};

function stringValue(formData: FormData, key: string) {
  return normalizePlatformCustomCodeValue(formData.get(key));
}

function contentDigest(headerCode: string, footerCode: string) {
  return createHash("sha256")
    .update(headerCode)
    .update("\0")
    .update(footerCode)
    .digest("hex");
}

export async function savePlatformCustomCodeAction(
  _state: PlatformCustomCodeActionState,
  formData: FormData,
): Promise<PlatformCustomCodeActionState> {
  const actor = await requireOwner();
  const parsed = platformCustomCodeInputSchema.safeParse({
    revision: Number(formData.get("revision")),
    enabled: formData.get("enabled") === "on",
    headerCode: stringValue(formData, "headerCode"),
    headerHeight: Number(formData.get("headerHeight")),
    footerCode: stringValue(formData, "footerCode"),
    footerHeight: Number(formData.get("footerHeight")),
    allowedNetworkOrigins: parsePlatformCustomCodeOrigins(
      formData.get("allowedNetworkOrigins"),
    ),
  });
  if (!parsed.success) return { ok: false, code: "invalid" };

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`platform-custom-code:${actor.organizationId}`}))`,
      );
      const [record] = await tx
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(
          and(
            eq(platformSettings.organizationId, actor.organizationId),
            eq(platformSettings.key, PLATFORM_CUSTOM_CODE_SETTING_KEY),
          ),
        )
        .limit(1)
        .for("update");
      const stored = storedPlatformCustomCodeSchema.safeParse(record?.value);
      const current = stored.success
        ? stored.data
        : DEFAULT_PLATFORM_CUSTOM_CODE;
      if (parsed.data.revision !== current.revision) {
        return { status: "changed" as const, revision: current.revision };
      }

      const next = {
        version: 1 as const,
        revision: current.revision + 1,
        enabled: parsed.data.enabled,
        headerCode: parsed.data.headerCode,
        headerHeight: parsed.data.headerHeight,
        footerCode: parsed.data.footerCode,
        footerHeight: parsed.data.footerHeight,
        allowedNetworkOrigins: parsed.data.allowedNetworkOrigins,
      };
      await tx
        .insert(platformSettings)
        .values({
          organizationId: actor.organizationId,
          key: PLATFORM_CUSTOM_CODE_SETTING_KEY,
          value: next,
        })
        .onConflictDoUpdate({
          target: [platformSettings.organizationId, platformSettings.key],
          set: { value: next, updatedAt: new Date() },
        });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "platform.custom_code.updated",
        entityType: "organization",
        entityId: actor.organizationId,
        metadata: {
          revision: next.revision,
          enabled: next.enabled,
          headerConfigured: Boolean(next.headerCode.trim()),
          footerConfigured: Boolean(next.footerCode.trim()),
          headerHeight: next.headerHeight,
          footerHeight: next.footerHeight,
          allowedNetworkOrigins: next.allowedNetworkOrigins,
          contentSha256: contentDigest(next.headerCode, next.footerCode),
        },
      });
      return { status: "saved" as const, revision: next.revision };
    });

    if (result.status === "changed") {
      return { ok: false, code: "changed", revision: result.revision };
    }
    revalidatePath("/admin/settings");
    revalidatePath("/", "layout");
    return { ok: true, code: "saved", revision: result.revision };
  } catch (error) {
    logServerError(error, {
      action: "platform.custom_code.update",
    });
    return { ok: false, code: "failed" };
  }
}
