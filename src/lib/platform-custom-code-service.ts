import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import {
  DEFAULT_PLATFORM_CUSTOM_CODE,
  PLATFORM_CUSTOM_CODE_SETTING_KEY,
  storedPlatformCustomCodeSchema,
} from "@/lib/platform-custom-code";

export async function getPlatformCustomCodeConfiguration(
  organizationId: string | null,
) {
  if (!organizationId) return DEFAULT_PLATFORM_CUSTOM_CODE;
  const [record] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, organizationId),
        eq(platformSettings.key, PLATFORM_CUSTOM_CODE_SETTING_KEY),
      ),
    )
    .limit(1);
  const parsed = storedPlatformCustomCodeSchema.safeParse(record?.value);
  return parsed.success ? parsed.data : DEFAULT_PLATFORM_CUSTOM_CODE;
}
