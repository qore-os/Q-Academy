"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  activityEvents,
  organizations,
  platformSettings,
  users,
} from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth";
import {
  NATIVE_START_DESTINATION_SETTINGS_KEY,
} from "@/lib/mobile/start-destination";
import {
  nativeStartDestinationSchema,
  sanitizeNativeStartDestination,
} from "@/lib/mobile/start-destination-model";

export type NativeStartDestinationActionState = {
  ok: boolean | null;
  message: string;
  code?: NativeStartDestinationActionCode;
};

export type NativeStartDestinationActionCode =
  | "nativeInvalid"
  | "permissionChanged"
  | "nativeSaved"
  | "unchanged";

export async function updateNativeStartDestinationAction(
  _state: NativeStartDestinationActionState,
  formData: FormData,
): Promise<NativeStartDestinationActionState> {
  const actor = await requireOrganizationAdmin();
  const parsed = nativeStartDestinationSchema.safeParse(
    formData.get("destination"),
  );
  if (!parsed.success) {
    return { ok: false, code: "nativeInvalid", message: "Bitte waehle einen gueltigen App-Start." };
  }

  const changed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`native-start:${actor.organizationId}`}, 0))`,
    );
    const [authorized] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, users.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.organizationId, actor.organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "admin"]),
        ),
      )
      .limit(1)
      .for("share", { of: users });
    if (!authorized) return null;

    const [currentRow] = await tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.organizationId, actor.organizationId),
          eq(
            platformSettings.key,
            NATIVE_START_DESTINATION_SETTINGS_KEY,
          ),
        ),
      )
      .limit(1)
      .for("update");
    const previous = sanitizeNativeStartDestination(currentRow?.value);
    if (previous === parsed.data) return false;
    const now = new Date();
    await tx
      .insert(platformSettings)
      .values({
        organizationId: actor.organizationId,
        key: NATIVE_START_DESTINATION_SETTINGS_KEY,
        value: { destination: parsed.data },
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [platformSettings.organizationId, platformSettings.key],
        set: { value: { destination: parsed.data }, updatedAt: now },
      });
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "platform.native_start.updated",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: { previous, destination: parsed.data },
    });
    return true;
  });

  if (changed === null) {
    return { ok: false, code: "permissionChanged", message: "Die Berechtigung wurde geaendert." };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  return {
    ok: true,
    code: changed ? "nativeSaved" : "unchanged",
    message: changed ? "App-Start gespeichert." : "Keine Aenderung erforderlich.",
  };
}
