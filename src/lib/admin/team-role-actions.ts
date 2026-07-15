"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { requireOwner } from "@/lib/auth";
import {
  assignTeamRole,
  createTeamRole,
  deleteTeamRole,
  unassignTeamRole,
  updateTeamRole,
} from "@/lib/team-permissions";
import { logServerError } from "@/lib/server-error-logging";

export type TeamRoleMessageCode =
  | "created"
  | "create_failed"
  | "updated"
  | "update_failed"
  | "deleted"
  | "delete_failed"
  | "assigned"
  | "assign_failed"
  | "unassigned"
  | "unassign_failed"
  | "validation_failed";

export type TeamRoleActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: TeamRoleMessageCode;
};

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function permissions(formData: FormData) {
  return formData
    .getAll("permissions")
    .filter((value): value is string => typeof value === "string");
}

function handled(
  error: unknown,
  fallback: string,
  messageCode: TeamRoleMessageCode,
): TeamRoleActionState {
  if (error instanceof ApiError) {
    return { ok: false, message: error.message, messageCode };
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      message: error.issues[0]?.message ?? "Bitte pruefe die Rollenangaben.",
      messageCode: "validation_failed",
    };
  }
  logServerError(error, { action: "team_role.admin" });
  return { ok: false, message: fallback, messageCode };
}

function revalidateRoles() {
  revalidatePath("/admin/settings/roles");
  revalidatePath("/admin", "layout");
}

export async function createTeamRoleAdminAction(
  _state: TeamRoleActionState,
  formData: FormData,
): Promise<TeamRoleActionState> {
  const actor = await requireOwner();
  try {
    await createTeamRole(actor, {
      name: formValue(formData, "name"),
      description: formValue(formData, "description") || null,
      color: formValue(formData, "color") || "#2b9188",
      permissions: permissions(formData),
    });
    revalidateRoles();
    return {
      ok: true,
      message: "Team-Rolle wurde erstellt.",
      messageCode: "created",
    };
  } catch (error) {
    return handled(
      error,
      "Die Team-Rolle konnte nicht erstellt werden.",
      "create_failed",
    );
  }
}

export async function updateTeamRoleAdminAction(
  _state: TeamRoleActionState,
  formData: FormData,
): Promise<TeamRoleActionState> {
  const actor = await requireOwner();
  try {
    await updateTeamRole(actor, formValue(formData, "roleId"), {
      name: formValue(formData, "name"),
      description: formValue(formData, "description") || null,
      color: formValue(formData, "color"),
      permissions: permissions(formData),
      active: formData.getAll("active").includes("true"),
      revision: Number(formValue(formData, "revision")),
    });
    revalidateRoles();
    return {
      ok: true,
      message: "Team-Rolle wurde aktualisiert.",
      messageCode: "updated",
    };
  } catch (error) {
    return handled(
      error,
      "Die Team-Rolle konnte nicht aktualisiert werden.",
      "update_failed",
    );
  }
}

export async function deleteTeamRoleAdminAction(
  _state: TeamRoleActionState,
  formData: FormData,
): Promise<TeamRoleActionState> {
  const actor = await requireOwner();
  try {
    await deleteTeamRole(actor, formValue(formData, "roleId"));
    revalidateRoles();
    return {
      ok: true,
      message: "Team-Rolle wurde geloescht.",
      messageCode: "deleted",
    };
  } catch (error) {
    return handled(
      error,
      "Die Team-Rolle konnte nicht geloescht werden.",
      "delete_failed",
    );
  }
}

export async function assignTeamRoleAdminAction(
  _state: TeamRoleActionState,
  formData: FormData,
): Promise<TeamRoleActionState> {
  const actor = await requireOwner();
  try {
    await assignTeamRole(
      actor,
      formValue(formData, "roleId"),
      formValue(formData, "userId"),
    );
    revalidateRoles();
    return {
      ok: true,
      message: "Team-Rolle wurde zugewiesen.",
      messageCode: "assigned",
    };
  } catch (error) {
    return handled(
      error,
      "Die Team-Rolle konnte nicht zugewiesen werden.",
      "assign_failed",
    );
  }
}

export async function unassignTeamRoleAdminAction(
  _state: TeamRoleActionState,
  formData: FormData,
): Promise<TeamRoleActionState> {
  const actor = await requireOwner();
  try {
    await unassignTeamRole(actor, formValue(formData, "userId"));
    revalidateRoles();
    return {
      ok: true,
      message: "Die Standardrechte gelten wieder.",
      messageCode: "unassigned",
    };
  } catch (error) {
    return handled(
      error,
      "Die Zuweisung konnte nicht entfernt werden.",
      "unassign_failed",
    );
  }
}
