"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationAdmin } from "@/lib/auth";
import {
  memberSidebarLinkInputSchema,
  memberSidebarLinkOrderSchema,
} from "@/lib/member-sidebar-link-model";
import {
  createMemberSidebarLink,
  deleteMemberSidebarLink,
  reorderMemberSidebarLinks,
  updateMemberSidebarLink,
} from "@/lib/member-sidebar-links";
import { logServerError } from "@/lib/server-error-logging";

const idSchema = z.string().uuid();

export type MemberSidebarLinkActionState = {
  ok: boolean | null;
  message: string;
  code?: MemberSidebarLinkActionCode;
};

export type MemberSidebarLinkActionCode =
  | "sidebarInvalid"
  | "sidebarInvalidHref"
  | "permissionChanged"
  | "sidebarCreated"
  | "sidebarDuplicate"
  | "sidebarNotFound"
  | "sidebarSaved"
  | "sidebarSaveFailed"
  | "sidebarDeleted"
  | "sidebarDeleteFailed"
  | "sidebarOrderInvalid"
  | "sidebarOrderStale"
  | "sidebarOrderSaved"
  | "sidebarOrderFailed";

function parseInput(formData: FormData) {
  return memberSidebarLinkInputSchema.safeParse({
    label: formData.get("label"),
    description: formData.get("description") ?? "",
    href: formData.get("href"),
    icon: formData.get("icon"),
    active: formData.get("active") === "on",
  });
}

function refreshSidebarLinks() {
  revalidatePath("/admin/settings");
  revalidatePath("/academy", "layout");
}

export async function createMemberSidebarLinkAction(
  _state: MemberSidebarLinkActionState,
  formData: FormData,
): Promise<MemberSidebarLinkActionState> {
  const actor = await requireOrganizationAdmin();
  const parsed = parseInput(formData);
  if (!parsed.success) {
    return {
      ok: false,
      code: parsed.error.issues[0]?.path[0] === "href" ? "sidebarInvalidHref" : "sidebarInvalid",
      message: parsed.error.issues[0]?.message ?? "Link bitte pruefen.",
    };
  }
  try {
    const result = await createMemberSidebarLink({
      actor: { id: actor.id, organizationId: actor.organizationId },
      ...parsed.data,
    });
    if (!result) {
      return { ok: false, code: "permissionChanged", message: "Die Berechtigung wurde geaendert." };
    }
    refreshSidebarLinks();
    return { ok: true, code: "sidebarCreated", message: "Sidebar-Link angelegt." };
  } catch (error) {
    logServerError(error, { action: "platform.member_sidebar_link.create" });
    return {
      ok: false,
      code: "sidebarDuplicate",
      message: "Der Link konnte nicht angelegt werden. Der Name muss eindeutig sein.",
    };
  }
}

export async function updateMemberSidebarLinkAction(
  id: string,
  _state: MemberSidebarLinkActionState,
  formData: FormData,
): Promise<MemberSidebarLinkActionState> {
  const actor = await requireOrganizationAdmin();
  const [parsedId, parsed] = [idSchema.safeParse(id), parseInput(formData)];
  if (!parsedId.success || !parsed.success) {
    return {
      ok: false,
      code: !parsed.success && parsed.error.issues[0]?.path[0] === "href" ? "sidebarInvalidHref" : "sidebarInvalid",
      message:
        (parsed.success ? null : parsed.error.issues[0]?.message) ??
        "Link bitte pruefen.",
    };
  }
  try {
    const result = await updateMemberSidebarLink({
      actor: { id: actor.id, organizationId: actor.organizationId },
      id: parsedId.data,
      ...parsed.data,
    });
    if (result === null) {
      return { ok: false, code: "permissionChanged", message: "Die Berechtigung wurde geaendert." };
    }
    if (!result) return { ok: false, code: "sidebarNotFound", message: "Link nicht gefunden." };
    refreshSidebarLinks();
    return { ok: true, code: "sidebarSaved", message: "Sidebar-Link gespeichert." };
  } catch (error) {
    logServerError(error, { action: "platform.member_sidebar_link.update" });
    return {
      ok: false,
      code: "sidebarSaveFailed",
      message: "Der Link konnte nicht gespeichert werden. Der Name muss eindeutig sein.",
    };
  }
}

export async function deleteMemberSidebarLinkAction(id: string): Promise<MemberSidebarLinkActionState> {
  const actor = await requireOrganizationAdmin();
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, code: "sidebarNotFound", message: "Link nicht gefunden." };
  try {
    const result = await deleteMemberSidebarLink({
      actor: { id: actor.id, organizationId: actor.organizationId },
      id: parsedId.data,
    });
    if (result === null) {
      return { ok: false, code: "permissionChanged", message: "Die Berechtigung wurde geaendert." };
    }
    if (!result) return { ok: false, code: "sidebarNotFound", message: "Link nicht gefunden." };
    refreshSidebarLinks();
    return { ok: true, code: "sidebarDeleted", message: "Sidebar-Link geloescht." };
  } catch (error) {
    logServerError(error, { action: "platform.member_sidebar_link.delete" });
    return { ok: false, code: "sidebarDeleteFailed", message: "Der Link konnte nicht geloescht werden." };
  }
}

export async function reorderMemberSidebarLinksAction(orderedIds: string[]): Promise<MemberSidebarLinkActionState> {
  const actor = await requireOrganizationAdmin();
  const parsed = memberSidebarLinkOrderSchema.safeParse(orderedIds);
  if (!parsed.success) {
    return { ok: false, code: "sidebarOrderInvalid", message: "Sortierung ist ungueltig." };
  }
  try {
    const result = await reorderMemberSidebarLinks({
      actor: { id: actor.id, organizationId: actor.organizationId },
      orderedIds: parsed.data,
    });
    if (result === null) {
      return { ok: false, code: "permissionChanged", message: "Die Berechtigung wurde geaendert." };
    }
    if (!result) {
      return { ok: false, code: "sidebarOrderStale", message: "Die Linkliste hat sich geaendert. Bitte neu laden." };
    }
    refreshSidebarLinks();
    return { ok: true, code: "sidebarOrderSaved", message: "Reihenfolge gespeichert." };
  } catch (error) {
    logServerError(error, { action: "platform.member_sidebar_links.reorder" });
    return { ok: false, code: "sidebarOrderFailed", message: "Reihenfolge konnte nicht gespeichert werden." };
  }
}
