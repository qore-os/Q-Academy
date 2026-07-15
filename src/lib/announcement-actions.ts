"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  announcements,
} from "@/db/schema";
import { announcementTargetRuleSetSchema } from "@/lib/announcement-rules";
import {
  announcementContentDocumentSchema,
  announcementContentPersonalizationValues,
  announcementContentToLegacyProjection,
} from "@/lib/announcement-content";
import {
  assertAnnouncementAudience,
  assertAnnouncementTargetRuleSetTargets,
  dismissAnnouncementForUser,
  getAnnouncementForOrganization,
  previewAnnouncementAudience,
  recordAnnouncementInteractions,
  validateAnnouncementConfiguration,
} from "@/lib/announcements";
import { ApiError } from "@/lib/api/errors";
import { announcementCreateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import { logServerError } from "@/lib/server-error-logging";
import { validateTenantPersonalizedTexts } from "@/lib/member-properties";
import { getAnnouncementCopy } from "@/lib/i18n/announcements";
import { SUPPORTED_LOCALES, normalizeLocale } from "@/lib/i18n/model";

export type AnnouncementActionState = { error?: string; success?: string };

const identifierSchema = z.string().uuid();

function optionalFormValue(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseRuleSetFormValue(value: FormDataEntryValue | null) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return null;
  }
}

export async function saveAnnouncementAction(
  _state: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await requireTeamPermission("community.manage");
  const locale = normalizeLocale(formData.get("locale"));
  const copy = getAnnouncementCopy(locale).actionMessages;
  const idValue = optionalFormValue(formData.get("id"));
  const id = idValue ? identifierSchema.safeParse(idValue) : null;
  if (id && !id.success) return { error: copy.invalidAnnouncement };
  const audience = formData.get("audience");
  const targetRuleSet = announcementTargetRuleSetSchema.safeParse(
    parseRuleSetFormValue(formData.get("targetRuleSet")),
  );
  if (!targetRuleSet.success) {
    return { error: copy.invalidRules };
  }
  const contentDocument = announcementContentDocumentSchema.safeParse(
    parseRuleSetFormValue(formData.get("contentDocument")),
  );
  if (!contentDocument.success) {
    return { error: copy.invalidContent };
  }
  const legacyContent = announcementContentToLegacyProjection(
    contentDocument.data,
  );
  const parsed = announcementCreateSchema.safeParse({
    title: formData.get("title"),
    body: legacyContent.body,
    tone: formData.get("tone"),
    placement: formData.get("placement"),
    audience,
    audienceId:
      audience === "all" ? null : optionalFormValue(formData.get("audienceId")),
    targetRuleSet: targetRuleSet.data,
    contentDocument: contentDocument.data,
    href: legacyContent.href,
    actionLabel: legacyContent.actionLabel,
    startsAt: formData.get("startsAt"),
    endsAt: optionalFormValue(formData.get("endsAt")),
    dismissible: formData.get("dismissible") === "on",
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { error: copy.invalidEntries };
  }

  try {
    await assertAnnouncementAudience(
      user.organizationId,
      parsed.data.audience,
      parsed.data.audienceId,
    );
    await assertAnnouncementTargetRuleSetTargets(
      user.organizationId,
      parsed.data.targetRuleSet,
    );
    validateAnnouncementConfiguration({
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt ?? null,
      href: parsed.data.href ?? null,
      actionLabel: parsed.data.actionLabel ?? null,
      placement: parsed.data.placement,
      dismissible: parsed.data.dismissible,
    });
    const personalizationError = await validateTenantPersonalizedTexts({
      organizationId: user.organizationId,
      values: [
        parsed.data.title,
        ...announcementContentPersonalizationValues(contentDocument.data),
      ],
      staticTokens: [
        "member.firstName",
        "member.lastName",
        "member.fullName",
      ],
    });
    if (personalizationError) {
      return { error: copy.invalidVariables };
    }

    const announcement = await db.transaction(async (tx) => {
      if (id?.success) {
        await getAnnouncementForOrganization(id.data, user.organizationId);
        const [updated] = await tx
          .update(announcements)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(
            and(
              eq(announcements.id, id.data),
              eq(announcements.organizationId, user.organizationId),
            ),
          )
          .returning();
        await tx.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "announcement.updated",
          entityType: "announcement",
          entityId: updated.id,
          metadata: {
            targetRuleVersion: updated.targetRuleSet.version,
            targetRuleCount: updated.targetRuleSet.conditions.length,
            contentVersion: updated.contentDocument.version,
            contentBlockCount: updated.contentDocument.blocks.length,
          },
        });
        return updated;
      }
      const [created] = await tx
        .insert(announcements)
        .values({
          ...parsed.data,
          ...legacyContent,
          contentDocument: contentDocument.data,
          organizationId: user.organizationId,
          createdById: user.id,
        })
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "announcement.created",
        entityType: "announcement",
        entityId: created.id,
        metadata: {
          targetRuleVersion: created.targetRuleSet.version,
          targetRuleCount: created.targetRuleSet.conditions.length,
          contentVersion: created.contentDocument.version,
          contentBlockCount: created.contentDocument.blocks.length,
        },
      });
      return created;
    });
    await enqueueWebhook(
      user.organizationId,
      id?.success ? "announcement.updated" : "announcement.created",
      announcement,
    );
    revalidatePath("/admin/announcements");
    revalidatePath("/academy", "layout");
    return {
      success: id?.success
        ? copy.updated
        : copy.created,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error:
          error.code === "not_found"
            ? copy.unavailableReference
            : copy.invalidConfiguration,
      };
    }
    logServerError(error, { action: "announcement.save" });
    return { error: copy.saveFailed };
  }
}

export async function toggleAnnouncementAction(id: string) {
  const user = await requireTeamPermission("community.manage");
  const parsed = identifierSchema.safeParse(id);
  if (!parsed.success) return;
  const current = await getAnnouncementForOrganization(
    parsed.data,
    user.organizationId,
  );
  await db.transaction(async (tx) => {
    await tx
      .update(announcements)
      .set({ active: !current.active, updatedAt: new Date() })
      .where(
        and(
          eq(announcements.id, current.id),
          eq(announcements.organizationId, user.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: user.organizationId,
      userId: user.id,
      type: current.active ? "announcement.deactivated" : "announcement.activated",
      entityType: "announcement",
      entityId: current.id,
    });
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/academy", "layout");
}

export async function deleteAnnouncementAction(id: string) {
  const user = await requireTeamPermission("community.manage");
  const parsed = identifierSchema.safeParse(id);
  if (!parsed.success) return;
  await getAnnouncementForOrganization(parsed.data, user.organizationId);
  await db.transaction(async (tx) => {
    await tx
      .delete(announcements)
      .where(
        and(
          eq(announcements.id, parsed.data),
          eq(announcements.organizationId, user.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: user.organizationId,
      userId: user.id,
      type: "announcement.deleted",
      entityType: "announcement",
      entityId: parsed.data,
    });
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/academy", "layout");
}

export async function dismissAnnouncementAction(id: string) {
  const user = await requireUser();
  const parsed = identifierSchema.safeParse(id);
  if (!parsed.success) return;
  await dismissAnnouncementForUser({
    organizationId: user.organizationId,
    userId: user.id,
    announcementId: parsed.data,
  });
  revalidatePath("/academy", "layout");
}

const previewInputSchema = z
  .object({
    locale: z.enum(SUPPORTED_LOCALES),
    audience: z.enum(["all", "user", "group"]),
    audienceId: z.string().uuid().nullable(),
    targetRuleSet: announcementTargetRuleSetSchema,
  })
  .strict();

export async function previewAnnouncementAudienceAction(input: unknown) {
  const user = await requireTeamPermission("community.manage");
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) {
    const locale =
      typeof input === "object" && input && "locale" in input
        ? normalizeLocale(input.locale)
        : normalizeLocale(null);
    return {
      ok: false as const,
      error: getAnnouncementCopy(locale).actionMessages.previewInvalid,
    };
  }
  const { locale, ...previewInput } = parsed.data;
  const copy = getAnnouncementCopy(locale).actionMessages;
  try {
    const preview = await previewAnnouncementAudience({
      organizationId: user.organizationId,
      ...previewInput,
    });
    return { ok: true as const, ...preview };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false as const, error: copy.previewInvalid };
    }
    logServerError(error, { action: "announcement.preview" });
    return { ok: false as const, error: copy.previewFailed };
  }
}

export async function recordAnnouncementImpressionsAction(ids: string[]) {
  const user = await requireUser();
  const parsed = z.array(identifierSchema).max(50).safeParse(ids);
  if (!parsed.success) return { recorded: 0 };
  return recordAnnouncementInteractions({
    organizationId: user.organizationId,
    userId: user.id,
    announcementIds: parsed.data,
    kind: "impression",
  });
}

export async function recordAnnouncementClickAction(id: string) {
  const user = await requireUser();
  const parsed = identifierSchema.safeParse(id);
  if (!parsed.success) return { recorded: 0 };
  return recordAnnouncementInteractions({
    organizationId: user.organizationId,
    userId: user.id,
    announcementIds: [parsed.data],
    kind: "click",
  });
}
