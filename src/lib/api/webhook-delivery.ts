import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import {
  and,
  asc,
  eq,
  isNull,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhooks,
} from "@/db/schema";
import { decryptWebhookSecret } from "@/lib/api/crypto";
import { MAX_WEBHOOK_DELIVERY_ATTEMPTS } from "@/lib/api/webhook-delivery-model";
import { describeWebhookDeliveryResponse } from "@/lib/api/webhook-delivery-model";
import {
  resolveSafeWebhookTarget,
  type SafeWebhookTarget,
} from "@/lib/api/webhook-security";

const PROCESSING_LEASE_MS = 5 * 60_000;
const WORKER_CONCURRENCY = 5;
const MAX_CLAIMS_PER_TENANT = 2;
const REQUEST_TIMEOUT_MS = 10_000;

function postPinnedWebhook(
  target: SafeWebhookTarget,
  attempt: number,
  headers: Record<string, string>,
  body: string,
) {
  const selected =
    target.addresses[(Math.max(1, attempt) - 1) % target.addresses.length];
  if (!selected) throw new Error("Das Webhook-Ziel hat keine sichere Adresse.");
  const transport =
    target.url.protocol === "https:" ? requestHttps : requestHttp;

  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    let settled = false;
    const timeoutState: { value?: ReturnType<typeof setTimeout> } = {};
    const settle = (
      callback: () => void,
    ) => {
      if (settled) return;
      settled = true;
      if (timeoutState.value) clearTimeout(timeoutState.value);
      callback();
    };
    const request = transport(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname,
        port: target.url.port || undefined,
        method: "POST",
        path: `${target.url.pathname}${target.url.search}`,
        headers,
        ...(target.url.protocol === "https:" && isIP(target.url.hostname) === 0
          ? { servername: target.url.hostname }
          : {}),
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [selected]);
            return;
          }
          callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (responseBody.length < 4_000) {
            responseBody = `${responseBody}${chunk}`.slice(0, 4_000);
          }
        });
        response.on("end", () =>
          settle(() =>
            resolve({
              status: response.statusCode ?? 0,
              body: responseBody,
            }),
          ),
        );
        response.on("aborted", () =>
          settle(() => reject(new Error("Webhook-Antwort wurde abgebrochen."))),
        );
        response.on("error", (error) => settle(() => reject(error)));
      },
    );
    timeoutState.value = setTimeout(() => {
      const error = new Error("Webhook-Zeitlimit ueberschritten.");
      settle(() => reject(error));
      request.destroy(error);
    }, REQUEST_TIMEOUT_MS);
    request.on("error", (error) => settle(() => reject(error)));
    request.end(body);
  });
}

async function claimNextDelivery(excludedOrganizationIds: string[]) {
  const now = new Date();
  const claimToken = randomUUID();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({
        id: webhookDeliveries.id,
        organizationId: webhookDeliveries.organizationId,
      })
      .from(webhookDeliveries)
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, webhookDeliveries.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .innerJoin(
        webhooks,
        and(
          eq(webhooks.id, webhookDeliveries.webhookId),
          eq(webhooks.organizationId, webhookDeliveries.organizationId),
        ),
      )
      .where(
        and(
          excludedOrganizationIds.length > 0
            ? notInArray(
                webhookDeliveries.organizationId,
                excludedOrganizationIds,
              )
            : undefined,
          or(
            eq(webhookDeliveries.status, "pending"),
            and(
              eq(webhookDeliveries.status, "retrying"),
              lte(webhookDeliveries.nextRetryAt, now),
            ),
            and(
              eq(webhookDeliveries.status, "processing"),
              or(
                isNull(webhookDeliveries.claimedAt),
                lte(webhookDeliveries.claimedAt, staleBefore),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(webhookDeliveries.createdAt))
      .limit(1)
      .for("update", { of: webhookDeliveries, skipLocked: true });
    if (!delivery) return null;
    await tx
      .update(webhookDeliveries)
      .set({
        status: "processing",
        claimedAt: now,
        claimToken,
        nextRetryAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.organizationId, delivery.organizationId),
        ),
      );
    return { ...delivery, claimToken };
  });
}

function retryAt(attempt: number) {
  const baseDelay = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.round(baseDelay * (Math.random() * 0.2 - 0.1));
  return new Date(Date.now() + baseDelay + jitter);
}

export async function deliverWebhook(id: string, claimToken: string) {
  const [record] = await db
    .select({
      delivery: webhookDeliveries,
      webhook: {
        id: webhooks.id,
        url: webhooks.url,
        active: webhooks.active,
        signingSecretEncrypted: webhooks.signingSecretEncrypted,
      },
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhooks,
      and(
        eq(webhooks.id, webhookDeliveries.webhookId),
        eq(webhooks.organizationId, webhookDeliveries.organizationId),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, webhookDeliveries.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(webhookDeliveries.id, id),
        eq(webhookDeliveries.status, "processing"),
        eq(webhookDeliveries.claimToken, claimToken),
      ),
    )
    .limit(1);
  if (!record) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "pending",
        claimedAt: null,
        claimToken: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.status, "processing"),
          eq(webhookDeliveries.claimToken, claimToken),
        ),
      );
    return null;
  }

  const attempt = record.delivery.attempt + 1;
  const startedAt = new Date();
  const started = performance.now();
  let responseStatus: number | null = null;
  let responseBody = "";
  let delivered = false;
  try {
    if (!record.webhook.active) throw new Error("Webhook ist deaktiviert.");
    const target = await resolveSafeWebhookTarget(record.webhook.url);
    const body = JSON.stringify(record.delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = decryptWebhookSecret(record.webhook.signingSecretEncrypted);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const response = await postPinnedWebhook(
      target,
      attempt,
      {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
        "User-Agent": "Q-Academy-Webhooks/1.0",
        "X-QA-Event": record.delivery.event,
        "X-QA-Delivery": record.delivery.id,
        "X-QA-Timestamp": timestamp,
        "X-QA-Signature": `v1=${signature}`,
      },
      body,
    );
    responseStatus = response.status;
    responseBody = response.body;
    delivered = response.status >= 200 && response.status < 300;
  } catch (error) {
    responseBody = error instanceof Error ? error.message.slice(0, 4000) : "Unbekannter Auslieferungsfehler";
  }

  const status = delivered
    ? "delivered"
    : attempt >= MAX_WEBHOOK_DELIVERY_ATTEMPTS
      ? "failed"
      : "retrying";
  const completedAt = new Date();
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  const failureKind = delivered
    ? null
    : describeWebhookDeliveryResponse({ responseStatus, responseBody })
        .failureKind ?? "unknown";
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(webhookDeliveries)
      .set({
        status,
        attempt,
        responseStatus,
        responseBody,
        durationMs,
        nextRetryAt: status === "retrying" ? retryAt(attempt) : null,
        claimedAt: null,
        claimToken: null,
        deliveredAt: delivered ? completedAt : null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.organizationId, record.delivery.organizationId),
          eq(webhookDeliveries.status, "processing"),
          eq(webhookDeliveries.claimToken, claimToken),
        ),
      )
      .returning();
    if (!updated) return null;
    await tx.insert(webhookDeliveryAttempts).values({
      organizationId: record.delivery.organizationId,
      deliveryId: record.delivery.id,
      webhookId: record.webhook.id,
      replayGeneration: record.delivery.replayGeneration,
      attempt,
      outcome: status,
      responseStatus,
      failureKind,
      responseBodyRedacted: responseBody.length > 0,
      durationMs,
      startedAt,
      completedAt,
    });
    await tx
      .update(webhooks)
      .set({ lastDeliveryAt: completedAt, updatedAt: completedAt })
      .where(
        and(
          eq(webhooks.id, record.webhook.id),
          eq(webhooks.organizationId, record.delivery.organizationId),
        ),
      );
    return updated;
  });
}

export async function processWebhookQueue(limit = 25) {
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const claimed: Array<{
    id: string;
    organizationId: string;
    claimToken: string;
  }> = [];
  const tenantClaims = new Map<string, number>();
  for (let index = 0; index < boundedLimit; index += 1) {
    const excludedOrganizationIds = [...tenantClaims]
      .filter(([, count]) => count >= MAX_CLAIMS_PER_TENANT)
      .map(([organizationId]) => organizationId);
    let delivery = await claimNextDelivery(excludedOrganizationIds);
    if (!delivery && excludedOrganizationIds.length > 0) {
      tenantClaims.clear();
      delivery = await claimNextDelivery([]);
    }
    if (!delivery) break;
    claimed.push(delivery);
    tenantClaims.set(
      delivery.organizationId,
      (tenantClaims.get(delivery.organizationId) ?? 0) + 1,
    );
  }

  const results = [];
  for (let index = 0; index < claimed.length; index += WORKER_CONCURRENCY) {
    const batch = claimed.slice(index, index + WORKER_CONCURRENCY);
    const delivered = await Promise.all(
      batch.map((delivery) =>
        deliverWebhook(delivery.id, delivery.claimToken),
      ),
    );
    results.push(...delivered.filter((result) => result !== null));
  }
  return results;
}
