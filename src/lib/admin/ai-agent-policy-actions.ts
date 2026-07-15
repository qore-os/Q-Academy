"use server";

import { revalidatePath } from "next/cache";

import {
  aiAgentPolicyInputSchema,
  updateAiAgentPolicy,
} from "@/lib/ai/agent-policy";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import type { AiAdminMessageCode } from "@/lib/i18n/ai-admin";
import { logServerError } from "@/lib/server-error-logging";

export type AiAgentPolicyActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: AiAdminMessageCode;
};

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function updateAiAgentPolicyAdminAction(
  _state: AiAgentPolicyActionState,
  formData: FormData,
): Promise<AiAgentPolicyActionState> {
  const actor = await requireTeamPermission("ai.manage");
  const hourlyEnabled = formValue(formData, "hourlyEnabled") === "on";
  const parsed = aiAgentPolicyInputSchema.safeParse({
    enabled: formValue(formData, "enabled") === "on",
    monthlyCreditLimit: Number(formValue(formData, "monthlyCreditLimit")),
    perMemberHourlyLimit: hourlyEnabled
      ? Number(formValue(formData, "perMemberHourlyLimit"))
      : null,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Bitte pruefe die KI-Creditlimits.",
      messageCode: "policyInvalid",
    };
  }

  try {
    const result = await updateAiAgentPolicy({
      actor: {
        id: actor.id,
        organizationId: actor.organizationId,
        role: actor.role,
      },
      policy: parsed.data,
    });
    revalidatePath("/admin/ai");
    return {
      ok: true,
      message: result.changed
        ? "KI-Policy gespeichert."
        : "Die KI-Policy ist bereits aktuell.",
      messageCode: result.changed ? "policySaved" : "policyUnchanged",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        messageCode: "policySaveFailed",
      };
    }
    logServerError(error, { action: "admin.ai_agent_policy.update" });
    return {
      ok: false,
      message: "Die KI-Policy konnte nicht gespeichert werden.",
      messageCode: "policySaveFailed",
    };
  }
}
