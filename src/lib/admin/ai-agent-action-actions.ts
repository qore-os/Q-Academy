"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { decideAiAgentActionRequest } from "@/lib/ai/agent-actions";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import type { AiAdminMessageCode } from "@/lib/i18n/ai-admin";
import { logServerError } from "@/lib/server-error-logging";

export type AiAgentActionDecisionState = {
  ok: boolean | null;
  message: string;
  messageCode?: AiAdminMessageCode;
};

const inputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.coerce.number().int().positive(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(1_000).optional(),
    confirmed: z.literal("yes"),
  })
  .superRefine((input, context) => {
    if (input.decision === "reject" && !input.note) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "Bitte begruende die Ablehnung.",
      });
    }
  });

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry : "";
}

export async function decideAiAgentActionAdminAction(
  _state: AiAgentActionDecisionState,
  formData: FormData,
): Promise<AiAgentActionDecisionState> {
  const actor = await requireTeamPermission("ai.manage");
  const parsed = inputSchema.safeParse({
    requestId: value(formData, "requestId"),
    expectedRevision: value(formData, "expectedRevision"),
    decision: value(formData, "decision"),
    note: value(formData, "note") || undefined,
    confirmed: value(formData, "confirmed"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Die Entscheidung ist ungueltig.",
      messageCode:
        parsed.error.issues[0]?.path[0] === "note"
          ? "decisionReasonRequired"
          : "decisionInvalid",
    };
  }

  try {
    await decideAiAgentActionRequest({
      organizationId: actor.organizationId,
      actorId: actor.id,
      actor: { kind: "user", id: actor.id, userId: actor.id },
      requestId: parsed.data.requestId,
      decision: {
        decision: parsed.data.decision,
        expectedRevision: parsed.data.expectedRevision,
        note: parsed.data.note,
      },
    });
    revalidatePath("/admin/ai");
    revalidatePath("/academy/ai");
    revalidatePath("/academy/courses");
    return {
      ok: true,
      message:
        parsed.data.decision === "approve"
          ? "Kurszugriff freigegeben."
          : "Aktionsanfrage abgelehnt.",
      messageCode:
        parsed.data.decision === "approve"
          ? "decisionApproved"
          : "decisionRejected",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        messageCode: "decisionFailed",
      };
    }
    logServerError(error, {
      action: "admin.ai_agent_action.decide",
      requestId: parsed.data.requestId,
    });
    return {
      ok: false,
      message: "Die Aktionsanfrage konnte nicht entschieden werden.",
      messageCode: "decisionFailed",
    };
  }
}
