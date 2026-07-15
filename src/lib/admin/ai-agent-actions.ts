"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  aiAgents,
  aiConversations,
} from "@/db/schema";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { requireTeamPermission } from "@/lib/auth";
import type { AiAdminMessageCode } from "@/lib/i18n/ai-admin";
import { logServerError } from "@/lib/server-error-logging";

export type AiAgentAdminActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: AiAdminMessageCode;
  messageParams?: Record<string, string | number | boolean>;
  resourceId?: string;
};

const identifierSchema = z.string().uuid();

function errorState(
  message: string,
  messageCode: AiAdminMessageCode,
  messageParams?: Record<string, string | number | boolean>,
): AiAgentAdminActionState {
  return { ok: false, message, messageCode, messageParams };
}

function revalidateAiAgents() {
  revalidatePath("/admin/ai");
  revalidatePath("/academy/ai");
  revalidatePath("/academy", "layout");
}

export async function toggleAiAgentAdminAction(
  agentId: string,
): Promise<AiAgentAdminActionState> {
  const actor = await requireTeamPermission("ai.manage");
  const parsedId = identifierSchema.safeParse(agentId);
  if (!parsedId.success) {
    return errorState("Der KI-Agent ist ungueltig.", "invalidAgent");
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ai-agents:${actor.organizationId}`}))`,
      );
      const [current] = await tx
        .select()
        .from(aiAgents)
        .where(
          and(
            eq(aiAgents.id, parsedId.data),
            eq(aiAgents.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (!current) return { kind: "missing" as const };
      if (!current.active && !current.publishedVersionId) {
        return { kind: "unpublished" as const };
      }

      if (current.active) {
        const [alternatives] = await tx
          .select({ value: count() })
          .from(aiAgents)
          .where(
            and(
              eq(aiAgents.organizationId, actor.organizationId),
              eq(aiAgents.active, true),
              sql`${aiAgents.publishedVersionId} is not null`,
              ne(aiAgents.id, current.id),
            ),
          );
        if (Number(alternatives?.value ?? 0) === 0) {
          return { kind: "last-active" as const };
        }
      }

      const active = !current.active;
      const [updated] = await tx
        .update(aiAgents)
        .set({ active })
        .where(
          and(
            eq(aiAgents.id, current.id),
            eq(aiAgents.organizationId, actor.organizationId),
          ),
        )
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: active ? "agent.activated" : "agent.deactivated",
        entityType: "ai_agent",
        entityId: updated.id,
        metadata: { name: updated.name, active },
      });
      return { kind: "updated" as const, agent: updated };
    });

    if (result.kind === "missing") {
      return errorState("Der KI-Agent wurde nicht gefunden.", "agentMissing");
    }
    if (result.kind === "last-active") {
      return errorState(
        "Der letzte aktive KI-Agent kann nicht pausiert werden. Aktiviere zuerst eine Alternative.",
        "lastActivePause",
      );
    }
    if (result.kind === "unpublished") {
      return errorState(
        "Veroeffentliche zuerst eine Agentenversion, bevor du den Agenten aktivierst.",
        "unpublishedActivate",
      );
    }

    await enqueueWebhook(actor.organizationId, "agent.updated", {
      ...result.agent,
      mutation: result.agent.active ? "activated" : "deactivated",
    });
    revalidateAiAgents();
    return {
      ok: true,
      message: `KI-Agent "${result.agent.name}" ${result.agent.active ? "aktiviert" : "pausiert"}.`,
      messageCode: "agentStatusChanged",
      messageParams: { name: result.agent.name, active: result.agent.active },
      resourceId: result.agent.id,
    };
  } catch (error) {
    logServerError(error, { action: "admin.ai_agent.toggle" });
    return errorState(
      "Der Status des KI-Agenten konnte nicht geaendert werden.",
      "agentStatusFailed",
    );
  }
}

export async function deleteAiAgentAdminAction(
  agentId: string,
  confirmation: string,
): Promise<AiAgentAdminActionState> {
  const actor = await requireTeamPermission("ai.manage");
  const parsed = z
    .object({
      id: identifierSchema,
      confirmation: z.string().trim().min(1).max(120),
    })
    .safeParse({ id: agentId, confirmation });
  if (!parsed.success) {
    return errorState("Die Bestaetigung ist ungueltig.", "invalidConfirmation");
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ai-agents:${actor.organizationId}`}))`,
      );
      const [current] = await tx
        .select()
        .from(aiAgents)
        .where(
          and(
            eq(aiAgents.id, parsed.data.id),
            eq(aiAgents.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (!current) return { kind: "missing" as const };
      if (parsed.data.confirmation !== current.name) {
        return { kind: "confirmation" as const };
      }

      const [usage] = await tx
        .select({ value: count() })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.organizationId, actor.organizationId),
            eq(aiConversations.agentId, current.id),
          ),
        );
      if (Number(usage?.value ?? 0) > 0) {
        return {
          kind: "in-use" as const,
          conversationCount: Number(usage?.value ?? 0),
        };
      }
      if (current.publishedVersionId) {
        return { kind: "published" as const };
      }

      if (current.active) {
        const [alternatives] = await tx
          .select({ value: count() })
          .from(aiAgents)
          .where(
            and(
              eq(aiAgents.organizationId, actor.organizationId),
              eq(aiAgents.active, true),
              sql`${aiAgents.publishedVersionId} is not null`,
              ne(aiAgents.id, current.id),
            ),
          );
        if (Number(alternatives?.value ?? 0) === 0) {
          return { kind: "last-active" as const };
        }
      }

      const [deleted] = await tx
        .delete(aiAgents)
        .where(
          and(
            eq(aiAgents.id, current.id),
            eq(aiAgents.organizationId, actor.organizationId),
          ),
        )
        .returning();
      if (!deleted) return { kind: "missing" as const };
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "agent.deleted",
        entityType: "ai_agent",
        entityId: deleted.id,
        metadata: { name: deleted.name, active: deleted.active },
      });
      return { kind: "deleted" as const, agent: deleted };
    });

    if (result.kind === "missing") {
      return errorState("Der KI-Agent wurde nicht gefunden.", "agentMissing");
    }
    if (result.kind === "confirmation") {
      return errorState(
        "Der eingegebene Name stimmt nicht mit dem KI-Agenten ueberein.",
        "confirmationMismatch",
      );
    }
    if (result.kind === "in-use") {
      return errorState(
        `Der KI-Agent hat ${result.conversationCount} gespeicherte ${result.conversationCount === 1 ? "Konversation" : "Konversationen"} und kann nicht geloescht werden. Pausiere ihn stattdessen.`,
        "agentInUse",
        { count: result.conversationCount },
      );
    }
    if (result.kind === "published") {
      return errorState(
        "Veroeffentlichte KI-Agenten bleiben fuer Audit und bestehende Chats erhalten. Pausiere ihn stattdessen.",
        "publishedDelete",
      );
    }
    if (result.kind === "last-active") {
      return errorState(
        "Der letzte aktive KI-Agent kann nicht geloescht werden. Aktiviere zuerst eine Alternative.",
        "lastActiveDelete",
      );
    }

    await enqueueWebhook(actor.organizationId, "agent.updated", {
      ...result.agent,
      mutation: "deleted",
    });
    revalidateAiAgents();
    return {
      ok: true,
      message: `KI-Agent "${result.agent.name}" geloescht.`,
      messageCode: "agentDeleted",
      messageParams: { name: result.agent.name },
      resourceId: result.agent.id,
    };
  } catch (error) {
    logServerError(error, { action: "admin.ai_agent.delete" });
    return errorState(
      "Der KI-Agent konnte nicht geloescht werden.",
      "agentDeleteFailed",
    );
  }
}
