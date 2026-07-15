"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import {
  acknowledgeCurrentMemberWelcome,
  updateMemberWelcomeSettings,
} from "@/lib/member-welcome";
import { memberWelcomeSettingsInputSchema } from "@/lib/member-welcome-model";
import { logServerError } from "@/lib/server-error-logging";

export type MemberWelcomeSettingsActionState = {
  error?: string;
  success?: string;
  version?: number;
  code?: MemberWelcomeSettingsActionCode;
};

export type MemberWelcomeSettingsActionCode =
  | "welcomeInvalid"
  | "welcomeVideoInvalid"
  | "welcomeSaved"
  | "noChanges"
  | "welcomeFailed";

function checkboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function updateMemberWelcomeSettingsAction(
  _state: MemberWelcomeSettingsActionState,
  formData: FormData,
): Promise<MemberWelcomeSettingsActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = memberWelcomeSettingsInputSchema.safeParse({
    enabled: checkboxValue(formData, "enabled"),
    title: formData.get("title"),
    welcomeText: formData.get("welcomeText"),
    videoUrl: optionalString(formData, "videoUrl"),
    promptProfileImage: checkboxValue(formData, "promptProfileImage"),
    promptProfileCompletion: checkboxValue(
      formData,
      "promptProfileCompletion",
    ),
  });
  if (!parsed.success) {
    return {
      code: parsed.error.issues[0]?.path[0] === "videoUrl" ? "welcomeVideoInvalid" : "welcomeInvalid",
      error:
        parsed.error.issues[0]?.message ??
        "Bitte die Willkommens-Einstellungen pruefen.",
    };
  }

  try {
    const saved = await db.transaction((tx) =>
      updateMemberWelcomeSettings(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        source: "admin_ui",
        patch: parsed.data,
      }),
    );
    revalidatePath("/admin/settings");
    revalidatePath("/academy", "layout");
    return {
      code: saved.changed ? "welcomeSaved" : "noChanges",
      success: saved.changed
        ? `Willkommens-Popup als Version ${saved.version} gespeichert.`
        : "Keine Aenderungen gespeichert.",
      version: saved.version,
    };
  } catch (error) {
    if (error instanceof ApiError) return { code: "welcomeFailed", error: error.message };
    logServerError(error, { action: "platform.welcome.update" });
    return { code: "welcomeFailed", error: "Das Willkommens-Popup konnte nicht gespeichert werden." };
  }
}

const acknowledgementVersionSchema = z.number().int().min(1);

export async function acknowledgeMemberWelcomeAction(
  configurationVersion: number,
) {
  const member = await requireUser();
  const version = acknowledgementVersionSchema.safeParse(configurationVersion);
  if (!version.success || member.role !== "member") {
    return { status: "not_available" as const };
  }

  try {
    const result = await acknowledgeCurrentMemberWelcome({
      organizationId: member.organizationId,
      userId: member.id,
      configurationVersion: version.data,
    });
    revalidatePath("/academy", "layout");
    return result;
  } catch (error) {
    logServerError(error, { action: "platform.welcome.acknowledge" });
    return { status: "failed" as const };
  }
}
