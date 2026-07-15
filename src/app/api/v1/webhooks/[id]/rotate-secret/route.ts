import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { encryptWebhookSecret } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["webhooks:write"], action: "webhook.secret.rotate", resourceType: "webhook", idempotent: true }, async (context) => {
    const [current] = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.organizationId, context.organizationId))).limit(1);
    if (!current) throw new ApiError(404, "not_found", "Webhook nicht gefunden.");
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    await db.update(webhooks).set({ signingSecretEncrypted: encryptWebhookSecret(secret), updatedAt: new Date() }).where(eq(webhooks.id, id));
    return { data: { id, secret }, resourceId: id, meta: { secretShownOnce: true } };
  });
}
