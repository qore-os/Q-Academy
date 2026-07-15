import "server-only";

import { createECDH, createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  userSessions,
  webPushSubscriptions,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { resolveSafeWebhookTarget } from "@/lib/api/webhook-security";

const MAX_SUBSCRIPTIONS_PER_USER = 10;

function canonicalBase64Url(value: string, byteLength: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return (
    decoded.length === byteLength && decoded.toString("base64url") === value
  );
}

function validP256PublicKey(value: string) {
  if (!canonicalBase64Url(value, 65)) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    ecdh.computeSecret(Buffer.from(value, "base64url"));
    return true;
  } catch {
    return false;
  }
}

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().trim().min(1).max(4_096),
    expirationTime: z.number().int().positive().nullable().optional(),
    keys: z
      .object({
        p256dh: z
          .string()
          .refine(validP256PublicKey, {
            message: "Der Push-Schluessel ist ungueltig.",
          }),
        auth: z.string().refine((value) => canonicalBase64Url(value, 16), {
          message: "Das Push-Authentifizierungsmerkmal ist ungueltig.",
        }),
      })
      .strict(),
  })
  .strict();

export type BrowserPushSubscription = z.infer<typeof pushSubscriptionSchema>;

function subscriptionAssociatedData(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  subscriptionId: string;
}) {
  return `web-push-subscription:${input.organizationId}:${input.userId}:${input.sessionId}:${input.subscriptionId}`;
}

function endpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

function normalizePushEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(422, "validation_error", "Der Push-Endpunkt ist ungueltig.");
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new ApiError(
      422,
      "validation_error",
      "Push-Endpunkte muessen HTTPS auf Port 443 verwenden.",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new ApiError(
      422,
      "validation_error",
      "Push-Endpunkte duerfen keine Zugangsdaten oder Fragmente enthalten.",
    );
  }
  return url.toString();
}

async function canonicalPushEndpoint(value: string) {
  const endpoint = normalizePushEndpoint(value);
  await resolveSafeWebhookTarget(endpoint);
  return endpoint;
}

function expirationDate(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  const maximum = Date.now() + 10 * 365 * 24 * 60 * 60_000;
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.getTime() > maximum) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Laufzeit des Push-Abonnements ist ungueltig.",
    );
  }
  return date;
}

export async function upsertWebPushSubscription(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  subscription: BrowserPushSubscription;
}) {
  const endpoint = await canonicalPushEndpoint(input.subscription.endpoint);
  const hash = endpointHash(endpoint);
  const expiresAt = expirationDate(input.subscription.expirationTime);

  return db.transaction(async (tx) => {
    const [activeSession] = await tx
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.id, input.sessionId),
          eq(userSessions.organizationId, input.organizationId),
          eq(userSessions.userId, input.userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for("share", { of: userSessions });
    if (!activeSession) {
      throw new ApiError(
        401,
        "authentication_required",
        "Die Sitzung fuer das Push-Abonnement ist nicht mehr aktiv.",
      );
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`,
    );
    const [existing] = await tx
      .select({
        id: webPushSubscriptions.id,
        organizationId: webPushSubscriptions.organizationId,
        userId: webPushSubscriptions.userId,
        sessionId: webPushSubscriptions.sessionId,
      })
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.endpointHash, hash))
      .limit(1)
      .for("update", { of: webPushSubscriptions });

    const sameOwner =
      existing?.organizationId === input.organizationId &&
      existing.userId === input.userId;
    const sameSession = sameOwner && existing.sessionId === input.sessionId;
    if (existing && !sameSession) {
      throw new ApiError(
        409,
        "conflict",
        "Das Push-Abonnement ist bereits an eine andere Sitzung gebunden.",
      );
    }
    const id = sameSession ? existing.id : randomUUID();
    const stored: BrowserPushSubscription = {
      endpoint,
      expirationTime: expiresAt?.getTime() ?? null,
      keys: input.subscription.keys,
    };
    const subscriptionEncrypted = encryptPayload(
      JSON.stringify(stored),
      subscriptionAssociatedData({
        organizationId: input.organizationId,
        userId: input.userId,
        sessionId: input.sessionId,
        subscriptionId: id,
      }),
    );
    if (sameSession) {
      await tx
        .update(webPushSubscriptions)
        .set({
          sessionId: input.sessionId,
          subscriptionEncrypted,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webPushSubscriptions.id, id),
            eq(webPushSubscriptions.organizationId, input.organizationId),
            eq(webPushSubscriptions.userId, input.userId),
          ),
        );
    } else {
      await tx.insert(webPushSubscriptions).values({
        id,
        organizationId: input.organizationId,
        userId: input.userId,
        sessionId: input.sessionId,
        endpointHash: hash,
        subscriptionEncrypted,
        expiresAt,
      });
    }

    const subscriptions = await tx
      .select({ id: webPushSubscriptions.id })
      .from(webPushSubscriptions)
      .where(
        and(
          eq(webPushSubscriptions.organizationId, input.organizationId),
          eq(webPushSubscriptions.userId, input.userId),
        ),
      )
      .orderBy(desc(webPushSubscriptions.updatedAt), desc(webPushSubscriptions.id));
    const expiredIds = subscriptions
      .slice(MAX_SUBSCRIPTIONS_PER_USER)
      .map((subscription) => subscription.id);
    if (expiredIds.length > 0) {
      await tx
        .delete(webPushSubscriptions)
        .where(inArray(webPushSubscriptions.id, expiredIds));
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: "push.subscription.enabled",
      entityType: "web_push_subscription",
      entityId: id,
      metadata: { refreshed: sameSession, pruned: expiredIds.length },
    });
    return { id, enabled: true as const };
  });
}

export async function deleteWebPushSubscription(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  endpoint: string;
}) {
  const endpoint = normalizePushEndpoint(input.endpoint);
  const [removed] = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(webPushSubscriptions)
      .where(
        and(
          eq(webPushSubscriptions.organizationId, input.organizationId),
          eq(webPushSubscriptions.userId, input.userId),
          eq(webPushSubscriptions.sessionId, input.sessionId),
          eq(webPushSubscriptions.endpointHash, endpointHash(endpoint)),
        ),
      )
      .returning({ id: webPushSubscriptions.id });
    if (rows[0]) {
      await tx.insert(activityEvents).values({
        organizationId: input.organizationId,
        userId: input.userId,
        type: "push.subscription.disabled",
        entityType: "web_push_subscription",
        entityId: rows[0].id,
        metadata: {},
      });
    }
    return rows;
  });
  return { enabled: false as const, removed: Boolean(removed) };
}

export function decryptWebPushSubscription(input: {
  id: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  subscriptionEncrypted: unknown;
}) {
  const parsed = pushSubscriptionSchema.safeParse(
    JSON.parse(
      decryptPayload(
        input.subscriptionEncrypted,
        subscriptionAssociatedData({
          organizationId: input.organizationId,
          userId: input.userId,
          sessionId: input.sessionId,
          subscriptionId: input.id,
        }),
      ),
    ),
  );
  if (!parsed.success) throw new Error("Stored web push subscription is invalid.");
  return parsed.data;
}

export async function hasWebPushSubscription(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  endpoint: string;
}) {
  const endpoint = normalizePushEndpoint(input.endpoint);
  const [subscription] = await db
    .select({ id: webPushSubscriptions.id })
    .from(webPushSubscriptions)
    .where(
      and(
        eq(webPushSubscriptions.organizationId, input.organizationId),
        eq(webPushSubscriptions.userId, input.userId),
        eq(webPushSubscriptions.sessionId, input.sessionId),
        eq(webPushSubscriptions.endpointHash, endpointHash(endpoint)),
      ),
    )
    .limit(1);
  return subscription !== undefined;
}
