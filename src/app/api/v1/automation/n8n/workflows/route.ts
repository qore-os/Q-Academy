import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  automationWorkflowConnections,
  webhooks,
} from "@/db/schema";
import { encryptWebhookSecret } from "@/lib/api/crypto";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { assertSafeWebhookUrl } from "@/lib/api/webhook-security";
import { n8nWorkflowInputSchema } from "@/lib/commerce/model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:read"],
    action: "automation.n8n.workflow.list",
    resourceType: "automation_workflow",
  }, async (context) => ({
    data: await db.select({
      id: automationWorkflowConnections.id,
      name: automationWorkflowConnections.name,
      provider: automationWorkflowConnections.provider,
      webhookId: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      active: webhooks.active,
      createdAt: automationWorkflowConnections.createdAt,
    }).from(automationWorkflowConnections).innerJoin(webhooks, and(
      eq(webhooks.id, automationWorkflowConnections.webhookId),
      eq(webhooks.organizationId, context.organizationId),
    )).where(eq(automationWorkflowConnections.organizationId, context.organizationId))
      .orderBy(desc(automationWorkflowConnections.createdAt)),
  }));
}

export async function POST(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:write"],
    action: "automation.n8n.workflow.create",
    resourceType: "automation_workflow",
    idempotent: true,
  }, async (context) => {
    const input = await parseJson(request, n8nWorkflowInputSchema);
    await assertSafeWebhookUrl(input.url);
    const workflow = await db.transaction(async (tx) => {
      const [webhook] = await tx.insert(webhooks).values({
        organizationId: context.organizationId,
        name: `n8n: ${input.name}`,
        url: input.url,
        signingSecretEncrypted: encryptWebhookSecret(input.signingSecret),
        events: input.events,
        active: input.active,
      }).returning();
      const [created] = await tx.insert(automationWorkflowConnections).values({
        organizationId: context.organizationId,
        provider: "n8n",
        name: input.name,
        webhookId: webhook.id,
      }).returning();
      await tx.insert(activityEvents).values({
        organizationId: context.organizationId,
        type: "automation.n8n.workflow.created",
        entityType: "automation_workflow",
        entityId: created.id,
        metadata: { webhookId: webhook.id, events: input.events, source: "api" },
      });
      return { ...created, url: webhook.url, events: webhook.events, active: webhook.active };
    });
    return { data: workflow, status: 201, resourceId: workflow.id };
  });
}
