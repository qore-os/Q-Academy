import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import {
  sanitizeNativeStartDestination,
  type NativeStartDestination,
} from "@/lib/mobile/start-destination-model";

export const NATIVE_START_DESTINATION_SETTINGS_KEY =
  "native_start_destination";

export async function getNativeStartDestination(
  organizationId: string | null,
): Promise<NativeStartDestination> {
  if (!organizationId) return "dashboard";
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, organizationId),
        eq(platformSettings.key, NATIVE_START_DESTINATION_SETTINGS_KEY),
      ),
    )
    .limit(1);
  return sanitizeNativeStartDestination(row?.value);
}
