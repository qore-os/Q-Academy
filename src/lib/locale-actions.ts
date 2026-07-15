"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents, organizations, users } from "@/db/schema";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import { preserveEmailTemplatesAcrossDefaultLocaleChange } from "@/lib/email-center";
import {
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "@/lib/i18n/model";

export type LocaleActionCode =
  | "profileSaved"
  | "organizationSaved"
  | "invalidLocale"
  | "profileUnavailable"
  | "organizationUnavailable";

export type LocaleActionState = {
  ok: boolean | null;
  code?: LocaleActionCode;
};

const localeSchema = z.enum(SUPPORTED_LOCALES);

function formString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function updateOwnLocaleAction(
  _state: LocaleActionState,
  formData: FormData,
): Promise<LocaleActionState> {
  const actor = await requireUser();
  const rawLocale = formString(formData, "preferredLocale");
  const parsed = rawLocale === "inherit"
    ? { success: true as const, data: null }
    : localeSchema.safeParse(rawLocale);
  if (!parsed.success) {
    return { ok: false, code: "invalidLocale" };
  }

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: users.id,
        preferredLocale: users.preferredLocale,
        status: users.status,
      })
      .from(users)
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current || current.status !== "active") return false;
    await tx
      .update(users)
      .set({ preferredLocale: parsed.data })
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.organizationId, actor.organizationId),
          eq(users.status, "active"),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "profile.locale_updated",
      entityType: "user",
      entityId: actor.id,
      metadata: {
        previousLocale: current.preferredLocale,
        preferredLocale: parsed.data,
        inherited: parsed.data === null,
      },
    });
    return true;
  });
  if (!updated) {
    return { ok: false, code: "profileUnavailable" };
  }
  revalidatePath("/academy/profile");
  revalidatePath("/academy", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true, code: "profileSaved" };
}

export async function updateOrganizationDefaultLocaleAction(
  _state: LocaleActionState,
  formData: FormData,
): Promise<LocaleActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = localeSchema.safeParse(formString(formData, "defaultLocale"));
  if (!parsed.success) {
    return { ok: false, code: "invalidLocale" };
  }

  const updated = await db.transaction(async (tx) => {
    const [currentActor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.organizationId, actor.organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "admin"]),
        ),
      )
      .limit(1)
      .for("share");
    if (!currentActor) return false;
    const [organization] = await tx
      .select({ defaultLocale: organizations.defaultLocale })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, actor.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .limit(1)
      .for("update");
    if (!organization) return false;
    await preserveEmailTemplatesAcrossDefaultLocaleChange(tx, {
      organizationId: actor.organizationId,
      previousLocale: normalizeLocale(organization.defaultLocale),
      nextLocale: parsed.data,
    });
    await tx
      .update(organizations)
      .set({ defaultLocale: parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(organizations.id, actor.organizationId),
          eq(organizations.status, "active"),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "organization.locale_updated",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        previousLocale: organization.defaultLocale,
        defaultLocale: parsed.data,
      },
    });
    return true;
  });
  if (!updated) {
    return { ok: false, code: "organizationUnavailable" };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/admin", "layout");
  revalidatePath("/academy", "layout");
  return { ok: true, code: "organizationSaved" };
}
