"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  communitySpaces,
  posts,
} from "@/db/schema";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";
import { replaceCommunitySpaceAccessPolicy } from "@/lib/community-access";
import {
  communityAreaCreateSchema,
  communityAreaMoveSchema,
  communitySpaceAccessPolicySchema,
  communitySpaceMoveSchema,
} from "@/lib/api/schemas";
import { COMMUNITY_SPACE_TYPES } from "@/lib/community-domain";
import {
  deleteCommunityCommentWithPointReversal,
  deleteCommunityPostWithPointReversal,
  deleteCommunitySpaceWithPointReversal,
  updateCommunityCommentMutation,
  updateCommunityPostMutation,
} from "@/lib/community-mutations";
import { rejectCommunityContentAsAdmin } from "@/lib/community-moderation-admin";
import { slugify } from "@/lib/utils";
import {
  createCommunityArea,
  deleteCommunityArea,
  moveCommunityArea,
  moveCommunitySpace,
  updateCommunityArea,
  updateCommunitySpaceWithLayout,
} from "@/lib/community-layout";
import {
  COMMUNITY_STANDARD_PROFILE_FIELDS,
  replaceCommunityProfileSettings,
  type CommunityPublicProfileFieldInput,
} from "@/lib/community-public-profile";
import type { CommunityAdminActionCode } from "@/lib/i18n/community-admin";
import type {
  CommunityActionCode,
  CommunityActionParams,
} from "@/lib/i18n/community-actions";
import { logServerError } from "@/lib/server-error-logging";

export type CommunityActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: CommunityAdminActionCode;
  code?: CommunityActionCode;
  params?: CommunityActionParams;
  moderationState?: "pending" | "published" | "held" | "rejected";
  contentVersion?: number;
  revision?: number;
  resourceId?: string;
  profileHref?: string;
  missingFields?: Array<{ key: string; label: string }>;
};

const identifierSchema = z.string().uuid();
const spaceSchema = z.object({
  title: z.string().trim().min(2, "Der Titel muss mindestens zwei Zeichen enthalten.").max(160),
  description: z.string().trim().max(5000).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Die Akzentfarbe ist ungueltig."),
  type: z.enum(COMMUNITY_SPACE_TYPES),
});

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function communityContentFromFormData(formData: FormData):
  | { input: { content: string } | { richText: unknown } }
  | { error: string } {
  const richText = formData.get("richText");
  if (richText !== null && richText !== "") {
    if (typeof richText !== "string" || richText.length > 100_000) {
      return { error: "Der formatierte Community-Inhalt ist ungueltig." };
    }
    try {
      return { input: { richText: JSON.parse(richText) as unknown } };
    } catch {
      return { error: "Der formatierte Community-Inhalt ist ungueltig." };
    }
  }
  return { input: { content: value(formData, "content") } };
}

function communityApiErrorState(
  error: unknown,
  fallback: string,
  messageCode?: CommunityAdminActionCode,
  code?: CommunityActionCode,
  params?: CommunityActionParams,
): CommunityActionState {
  if (!(error instanceof ApiError)) {
    logServerError(error, { action: "community.action" });
    return { ok: false, message: fallback, messageCode, code, params };
  }
  const state: CommunityActionState = {
    ok: false,
    message: fallback,
    messageCode,
    code:
      error.code === "profile_incomplete"
        ? "profileIncomplete"
        : error.code === "conflict"
          ? "contentChanged"
          : error.code === "not_found"
            ? "contentNotFound"
            : error.code === "forbidden"
              ? "contentForbidden"
              : code,
    params,
  };
  if (
    error.code === "profile_incomplete" &&
    typeof error.details === "object" &&
    error.details !== null
  ) {
    if (
      "profileHref" in error.details &&
      typeof error.details.profileHref === "string"
    ) {
      state.profileHref = error.details.profileHref;
    }
    if ("missingFields" in error.details && Array.isArray(error.details.missingFields)) {
      state.missingFields = error.details.missingFields.flatMap((field) =>
        typeof field === "object" &&
        field !== null &&
        "key" in field &&
        typeof field.key === "string" &&
        "label" in field &&
        typeof field.label === "string"
          ? [{ key: field.key, label: field.label }]
          : [],
      );
    }
  }
  return state;
}

function refreshCommunity() {
  revalidatePath("/admin/community");
  revalidatePath("/academy/community");
  revalidatePath("/academy");
}

function invalidResource(
  label: string,
  messageCode?: CommunityAdminActionCode,
): CommunityActionState {
  return { ok: false, message: `${label} ist ungueltig.`, messageCode };
}

export async function updateCommunitySpaceAccessPolicyAdminAction(
  spaceId: string,
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(spaceId).success) {
    return invalidResource("Der Community-Bereich", "accessSaveFailed");
  }
  const rawRules = formData.get("accessRulesJson");
  if (typeof rawRules !== "string" || rawRules.length > 100_000) {
    return { ok: false, message: "Die Zugriffsregeln sind ungueltig.", messageCode: "accessSaveFailed" };
  }
  let rules: unknown;
  try {
    rules = JSON.parse(rawRules);
  } catch {
    return { ok: false, message: "Die Zugriffsregeln sind kein gueltiges JSON.", messageCode: "accessSaveFailed" };
  }
  const parsed = communitySpaceAccessPolicySchema.safeParse({
    accessMode: value(formData, "accessMode"),
    rules,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Die Zugriffsregeln sind ungueltig.",
      messageCode: "accessSaveFailed",
    };
  }
  try {
    await replaceCommunitySpaceAccessPolicy({
      organizationId: actor.organizationId,
      actorId: actor.id,
      spaceId,
      ...parsed.data,
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Zugriffsregeln konnten nicht gespeichert werden.",
      "accessSaveFailed",
    );
  }
  refreshCommunity();
  return { ok: true, message: "Community-Zugriffsregeln gespeichert.", messageCode: "accessSaved" };
}

export async function updateCommunitySpaceAdminAction(
  spaceId: string,
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(spaceId).success) return invalidResource("Der Community-Bereich", "spaceSaveFailed");

  const parsed = spaceSchema.safeParse({
    title: value(formData, "title"),
    description: value(formData, "description") || null,
    color: value(formData, "color"),
    type: value(formData, "type") || "feed",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Bitte pruefe die Bereichsdaten.", messageCode: "spaceSaveFailed" };
  }

  const slug = slugify(parsed.data.title);
  if (!slug) return { ok: false, message: "Aus dem Titel konnte kein gueltiger Kurzname erzeugt werden.", messageCode: "spaceSaveFailed" };

  try {
    await updateCommunitySpaceWithLayout({
      organizationId: actor.organizationId,
      actorId: actor.id,
      spaceId,
      ...parsed.data,
      slug,
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Der Community-Bereich konnte nicht gespeichert werden.",
      "spaceSaveFailed",
    );
  }

  refreshCommunity();
  return { ok: true, message: "Community-Bereich gespeichert.", messageCode: "spaceSaved" };
}

export async function createCommunityAreaAdminAction(
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  const title = value(formData, "title");
  const positionValue = value(formData, "position");
  const parsed = communityAreaCreateSchema.safeParse({
    title,
    slug: value(formData, "slug") || slugify(title),
    description: value(formData, "description") || null,
    position: positionValue ? Number(positionValue) : undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Die Community-Area ist ungueltig.",
      messageCode: "areaCreateFailed",
    };
  }
  try {
    const area = await createCommunityArea({
      organizationId: actor.organizationId,
      actorId: actor.id,
      ...parsed.data,
      slug: parsed.data.slug ?? slugify(parsed.data.title),
    });
    refreshCommunity();
    return {
      ok: true,
      message: "Community-Area erstellt.",
      messageCode: "areaCreated",
      resourceId: area.id,
    };
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Community-Area konnte nicht erstellt werden.",
      "areaCreateFailed",
    );
  }
}

export async function updateCommunityAreaAdminAction(
  areaId: string,
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(areaId).success) {
    return invalidResource("Die Community-Area", "areaSaveFailed");
  }
  const title = value(formData, "title");
  const parsed = communityAreaCreateSchema.safeParse({
    title,
    slug: value(formData, "slug") || slugify(title),
    description: value(formData, "description") || null,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Die Community-Area ist ungueltig.",
      messageCode: "areaSaveFailed",
    };
  }
  try {
    await updateCommunityArea({
      organizationId: actor.organizationId,
      actorId: actor.id,
      areaId,
      title: parsed.data.title,
      slug: parsed.data.slug ?? slugify(parsed.data.title),
      description: parsed.data.description,
    });
    refreshCommunity();
    return { ok: true, message: "Community-Area gespeichert.", messageCode: "areaSaved" };
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Community-Area konnte nicht gespeichert werden.",
      "areaSaveFailed",
    );
  }
}

export async function moveCommunityAreaAdminAction(
  areaId: string,
  position: number,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = z
    .object({ areaId: identifierSchema })
    .and(communityAreaMoveSchema)
    .safeParse({ areaId, position });
  if (!parsed.success) return invalidResource("Die Community-Area", "areaMoveFailed");
  try {
    await moveCommunityArea({
      organizationId: actor.organizationId,
      actorId: actor.id,
      areaId: parsed.data.areaId,
      position: parsed.data.position,
    });
    refreshCommunity();
    return { ok: true, message: "Community-Area verschoben.", messageCode: "areaMoved" };
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Community-Area konnte nicht verschoben werden.",
      "areaMoveFailed",
    );
  }
}

export async function deleteCommunityAreaAdminAction(
  areaId: string,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(areaId).success) {
    return invalidResource("Die Community-Area", "areaDeleteFailed");
  }
  try {
    await deleteCommunityArea({
      organizationId: actor.organizationId,
      actorId: actor.id,
      areaId,
    });
    refreshCommunity();
    return { ok: true, message: "Community-Area geloescht.", messageCode: "areaDeleted" };
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Community-Area konnte nicht geloescht werden.",
      "areaDeleteFailed",
    );
  }
}

export async function moveCommunitySpaceAdminAction(
  spaceId: string,
  areaId: string,
  position: number,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = z
    .object({ spaceId: identifierSchema })
    .and(communitySpaceMoveSchema)
    .safeParse({ spaceId, areaId, position });
  if (!parsed.success) return invalidResource("Der Community-Bereich", "spaceMoveFailed");
  try {
    await moveCommunitySpace({
      organizationId: actor.organizationId,
      actorId: actor.id,
      spaceId: parsed.data.spaceId,
      areaId: parsed.data.areaId,
      position: parsed.data.position,
    });
    refreshCommunity();
    return { ok: true, message: "Community-Bereich verschoben.", messageCode: "spaceMoved" };
  } catch (error) {
    return communityApiErrorState(
      error,
      "Der Community-Bereich konnte nicht verschoben werden.",
      "spaceMoveFailed",
    );
  }
}

const communityProfileFieldInputSchema = z
  .object({
    standardField: z.enum(COMMUNITY_STANDARD_PROFILE_FIELDS).nullable().optional(),
    customFieldId: identifierSchema.nullable().optional(),
    requiredForPosting: z.boolean().default(false),
  })
  .strict();

export async function replaceCommunityProfileSettingsAdminAction(
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  const fieldsJson = formData.get("fieldsJson");
  if (typeof fieldsJson !== "string" || fieldsJson.length > 100_000) {
    return { ok: false, message: "Die Profilfelder sind ungueltig.", messageCode: "profileSaveFailed" };
  }
  let fieldsInput: unknown;
  try {
    fieldsInput = JSON.parse(fieldsJson) as unknown;
  } catch {
    return { ok: false, message: "Die Profilfelder sind kein gueltiges JSON.", messageCode: "profileSaveFailed" };
  }
  const parsed = z
    .object({
      expectedRevision: z.coerce.number().int().min(0),
      completionGateEnabled: z.boolean(),
      fields: z.array(communityProfileFieldInputSchema).max(100),
    })
    .safeParse({
      expectedRevision: formData.get("expectedRevision"),
      completionGateEnabled: ["on", "true", "1"].includes(
        String(formData.get("completionGateEnabled") ?? ""),
      ),
      fields: fieldsInput,
    });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Die Community-Profilkonfiguration ist ungueltig.",
      messageCode: "profileSaveFailed",
    };
  }
  try {
    const saved = await replaceCommunityProfileSettings({
      organizationId: actor.organizationId,
      actorId: actor.id,
      expectedRevision: parsed.data.expectedRevision,
      completionGateEnabled: parsed.data.completionGateEnabled,
      fields: parsed.data.fields satisfies CommunityPublicProfileFieldInput[],
    });
    refreshCommunity();
    revalidatePath("/academy/profile");
    return {
      ok: true,
      message: "Community-Profilkonfiguration gespeichert.",
      messageCode: "profileSaved",
      revision: saved.settings.revision,
    };
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Community-Profilkonfiguration konnte nicht gespeichert werden.",
      "profileSaveFailed",
    );
  }
}

export async function deleteCommunitySpaceAdminAction(
  spaceId: string,
  confirmation: string,
): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = z.object({ spaceId: identifierSchema, confirmation: z.string().trim().min(1) }).safeParse({
    spaceId,
    confirmation,
  });
  if (!parsed.success) return invalidResource("Der Community-Bereich", "spaceDeleteFailed");

  let result: "missing" | "confirmation" | "deleted";
  try {
    result = await db.transaction(async (tx) => {
      const deleted = await deleteCommunitySpaceWithPointReversal(tx, {
        organizationId: actor.organizationId,
        spaceId: parsed.data.spaceId,
        actorId: actor.id,
        authorization: "manage",
        confirmationTitle: parsed.data.confirmation,
      });
      if (deleted.status === "missing") return "missing" as const;
      if (deleted.status === "confirmation_mismatch") {
        return "confirmation" as const;
      }
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "community_space.deleted",
        entityType: "community_space",
        entityId: deleted.space.id,
        metadata: {
          title: deleted.space.title,
          deletedPosts: deleted.deletedPostCount,
          deletedComments: deleted.deletedCommentCount,
        },
      });
      return "deleted" as const;
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Der Community-Bereich konnte nicht geloescht werden.",
      "spaceDeleteFailed",
    );
  }

  if (result === "missing") return { ok: false, message: "Der Community-Bereich wurde nicht gefunden.", messageCode: "spaceDeleteFailed" };
  if (result === "confirmation") return { ok: false, message: "Der eingegebene Bereichsname stimmt nicht ueberein.", messageCode: "spaceDeleteFailed" };
  refreshCommunity();
  return { ok: true, message: "Community-Bereich und alle enthaltenen Inhalte wurden geloescht.", messageCode: "spaceDeleted" };
}

export async function togglePostPinnedAdminAction(postId: string): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(postId).success) return invalidResource("Der Beitrag", "postToggleFailed");

  const result = await db.transaction(async (tx) => {
    const [post] = await tx
      .select({ id: posts.id, pinned: posts.pinned })
      .from(posts)
      .innerJoin(communitySpaces, and(eq(communitySpaces.id, posts.spaceId), eq(communitySpaces.organizationId, actor.organizationId)))
      .where(and(eq(posts.id, postId), eq(posts.organizationId, actor.organizationId)))
      .limit(1)
      .for("update", { of: posts });
    if (!post) return null;
    const pinned = !post.pinned;
    await tx.update(posts).set({ pinned, updatedAt: new Date() }).where(and(eq(posts.id, postId), eq(posts.organizationId, actor.organizationId)));
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: pinned ? "community_post.pinned" : "community_post.unpinned",
      entityType: "post",
      entityId: postId,
    });
    return pinned;
  });

  if (result === null) return { ok: false, message: "Der Beitrag wurde nicht gefunden.", messageCode: "postToggleFailed" };
  refreshCommunity();
  return { ok: true, message: result ? "Beitrag fixiert." : "Fixierung aufgehoben.", messageCode: result ? "postPinned" : "postUnpinned" };
}

export async function togglePostLockedAdminAction(postId: string): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(postId).success) return invalidResource("Der Beitrag", "postToggleFailed");

  const result = await db.transaction(async (tx) => {
    const [post] = await tx
      .select({ id: posts.id, locked: posts.locked })
      .from(posts)
      .innerJoin(
        communitySpaces,
        and(
          eq(communitySpaces.id, posts.spaceId),
          eq(communitySpaces.organizationId, actor.organizationId),
        ),
      )
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: posts });
    if (!post) return null;
    const locked = !post.locked;
    await tx
      .update(posts)
      .set({ locked, updatedAt: new Date() })
      .where(
        and(
          eq(posts.id, post.id),
          eq(posts.organizationId, actor.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: locked ? "community_post.locked" : "community_post.unlocked",
      entityType: "post",
      entityId: post.id,
    });
    return locked;
  });
  if (result === null) return { ok: false, message: "Der Beitrag wurde nicht gefunden.", messageCode: "postToggleFailed" };
  refreshCommunity();
  return { ok: true, message: result ? "Antworten gesperrt." : "Antworten freigegeben.", messageCode: result ? "postLocked" : "postUnlocked" };
}

export async function deletePostAdminAction(postId: string): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(postId).success) return invalidResource("Der Beitrag", "postRejectFailed");

  try {
    await db.transaction((tx) =>
      rejectCommunityContentAsAdmin(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        targetType: "post",
        targetId: postId,
        note: "Beitrag durch die Community-Administration abgelehnt.",
      }),
    );
  } catch (error) {
    return communityApiErrorState(
      error,
      "Der Beitrag konnte nicht moderiert werden.",
      "postRejectFailed",
    );
  }
  refreshCommunity();
  return { ok: true, message: "Beitrag wurde abgelehnt und verborgen.", messageCode: "postRejected" };
}

export async function deleteCommentAdminAction(commentId: string): Promise<CommunityActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(commentId).success) return invalidResource("Die Antwort", "commentRejectFailed");

  try {
    await db.transaction((tx) =>
      rejectCommunityContentAsAdmin(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        targetType: "comment",
        targetId: commentId,
        note: "Antwort durch die Community-Administration abgelehnt.",
      }),
    );
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Antwort konnte nicht moderiert werden.",
      "commentRejectFailed",
    );
  }
  refreshCommunity();
  return { ok: true, message: "Antwort wurde abgelehnt und verborgen.", messageCode: "commentRejected" };
}

export async function updateOwnPostAction(
  postId: string,
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireUser();
  const communityContent = communityContentFromFormData(formData);
  if ("error" in communityContent) {
    return {
      ok: false,
      message: communityContent.error,
      code: "invalidRichContent",
    };
  }
  const parsed = z
    .object({
      id: identifierSchema,
      expectedContentVersion: z.coerce.number().int().min(1),
    })
    .safeParse({
      id: postId,
      expectedContentVersion: formData.get("expectedContentVersion"),
    });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Der Beitrag ist ungueltig.",
      code: "contentInvalid",
      params: { target: "post", operation: "edit" },
    };
  }

  let updated;
  try {
    updated = await updateCommunityPostMutation({
      organizationId: actor.organizationId,
      actorId: actor.id,
      postId: parsed.data.id,
      expectedContentVersion: parsed.data.expectedContentVersion,
      ...communityContent.input,
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Der Beitrag konnte nicht gespeichert werden.",
      undefined,
      "contentSaveFailed",
      { target: "post", operation: "edit" },
    );
  }
  if (!updated) {
    return {
      ok: false,
      message: "Du kannst nur eigene Beitraege bearbeiten.",
      code: "contentForbidden",
      params: { target: "post", operation: "edit" },
    };
  }
  refreshCommunity();
  return {
    ok: true,
    moderationState: updated.moderationState,
    contentVersion: updated.moderationVersion,
    message:
      updated.moderationState === "pending"
        ? "Aenderung wurde zur Freigabe eingereicht."
        : updated.moderationState === "held"
          ? "Aenderung wird vor der Veroeffentlichung geprueft."
          : "Beitrag gespeichert.",
    code: "contentSaved",
    params: {
      target: "post",
      moderationState: updated.moderationState,
    },
  };
}

export async function deleteOwnPostAction(postId: string): Promise<CommunityActionState> {
  const actor = await requireUser();
  if (!identifierSchema.safeParse(postId).success) {
    return {
      ok: false,
      message: "Der Beitrag ist ungueltig.",
      code: "contentInvalid",
      params: { target: "post", operation: "delete" },
    };
  }

  let result: boolean;
  try {
    result = await db.transaction(async (tx) => {
      const deleted = await deleteCommunityPostWithPointReversal(tx, {
        organizationId: actor.organizationId,
        postId,
        actorId: actor.id,
        authorization: "own",
      });
      if (!deleted) return false;
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "community_post.deleted",
        entityType: "post",
        entityId: deleted.post.id,
      });
      return true;
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Der Beitrag konnte nicht geloescht werden.",
      undefined,
      "contentDeleteFailed",
      { target: "post", operation: "delete" },
    );
  }
  if (!result) {
    return {
      ok: false,
      message: "Du kannst nur eigene Beitraege loeschen.",
      code: "contentForbidden",
      params: { target: "post", operation: "delete" },
    };
  }
  refreshCommunity();
  return {
    ok: true,
    message: "Beitrag geloescht.",
    code: "contentDeleted",
    params: { target: "post" },
  };
}

export async function updateOwnCommentAction(
  commentId: string,
  _state: CommunityActionState,
  formData: FormData,
): Promise<CommunityActionState> {
  const actor = await requireUser();
  const communityContent = communityContentFromFormData(formData);
  if ("error" in communityContent) {
    return {
      ok: false,
      message: communityContent.error,
      code: "invalidRichContent",
    };
  }
  const parsed = z
    .object({
      id: identifierSchema,
      expectedContentVersion: z.coerce.number().int().min(1),
    })
    .safeParse({
      id: commentId,
      expectedContentVersion: formData.get("expectedContentVersion"),
    });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Die Antwort ist ungueltig.",
      code: "contentInvalid",
      params: { target: "answer", operation: "edit" },
    };
  }

  let updated;
  try {
    updated = await updateCommunityCommentMutation({
      organizationId: actor.organizationId,
      actorId: actor.id,
      commentId: parsed.data.id,
      expectedContentVersion: parsed.data.expectedContentVersion,
      ...communityContent.input,
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Antwort konnte nicht gespeichert werden.",
      undefined,
      "contentSaveFailed",
      { target: "answer", operation: "edit" },
    );
  }
  if (!updated) {
    return {
      ok: false,
      message: "Die Antwort wurde nicht gefunden.",
      code: "contentNotFound",
      params: { target: "answer", operation: "edit" },
    };
  }
  refreshCommunity();
  return {
    ok: true,
    moderationState: updated.moderationState,
    contentVersion: updated.moderationVersion,
    message:
      updated.moderationState === "pending"
        ? "Aenderung wurde zur Freigabe eingereicht."
        : updated.moderationState === "held"
          ? "Aenderung wird vor der Veroeffentlichung geprueft."
          : "Antwort gespeichert.",
    code: "contentSaved",
    params: {
      target: "answer",
      moderationState: updated.moderationState,
    },
  };
}

export async function deleteOwnCommentAction(commentId: string): Promise<CommunityActionState> {
  const actor = await requireUser();
  if (!identifierSchema.safeParse(commentId).success) {
    return {
      ok: false,
      message: "Die Antwort ist ungueltig.",
      code: "contentInvalid",
      params: { target: "answer", operation: "delete" },
    };
  }

  let result: boolean;
  try {
    result = await db.transaction(async (tx) => {
      const deleted = await deleteCommunityCommentWithPointReversal(tx, {
        organizationId: actor.organizationId,
        commentId,
        actorId: actor.id,
        authorization: "own",
      });
      if (!deleted) return false;
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "community_comment.deleted",
        entityType: "comment",
        entityId: deleted.comment.id,
      });
      return true;
    });
  } catch (error) {
    return communityApiErrorState(
      error,
      "Die Antwort konnte nicht geloescht werden.",
      undefined,
      "contentDeleteFailed",
      { target: "answer", operation: "delete" },
    );
  }
  if (!result) {
    return {
      ok: false,
      message: "Du kannst nur eigene Antworten loeschen.",
      code: "contentForbidden",
      params: { target: "answer", operation: "delete" },
    };
  }
  refreshCommunity();
  return {
    ok: true,
    message: "Antwort geloescht.",
    code: "contentDeleted",
    params: { target: "answer" },
  };
}
