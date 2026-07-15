import "server-only";

import { Agent } from "node:https";
import {
  and,
  asc,
  eq,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import webPush from "web-push";

import { db } from "@/db";
import {
  notifications,
  organizations,
  pushNotificationDeliveries,
  userNotificationPreferences,
  userSessions,
  users,
  webPushSubscriptions,
} from "@/db/schema";
import { resolveSafeWebhookTarget } from "@/lib/api/webhook-security";
import { getWebPushConfiguration } from "@/lib/server-environment";
import { decryptWebPushSubscription } from "@/lib/push/subscriptions";

const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;
const WORKER_CONCURRENCY = 5;
const MAX_CLAIMS_PER_TENANT = 2;

function retryAt(attempt: number) {
  const baseDelay = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.round(baseDelay * (Math.random() * 0.2 - 0.1));
  return new Date(Date.now() + baseDelay + jitter);
}

function safeNotificationHref(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/academy";
  try {
    const url = new URL(value, "https://q-academy.local");
    if (url.origin !== "https://q-academy.local") return "/academy";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/academy";
  }
}

function boundedText(value: string, maximumLength: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength);
}

export async function materializePushNotificationDeliveries(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(1_000, limit));
  const result = await db.execute(sql`
    insert into push_notification_deliveries (
      organization_id,
      user_id,
      notification_id,
      subscription_id,
      status,
      response_body
    )
    select
      subscription.organization_id,
      notification.user_id,
      notification.id,
      subscription.id,
      case
        when notification.category <> 'system' and preference.push_enabled = false
          then 'failed'::push_delivery_status
        else 'pending'::push_delivery_status
      end,
      case
        when notification.category <> 'system' and preference.push_enabled = false
          then 'Durch Benachrichtigungseinstellungen unterdrueckt.'
        else null
      end
    from notifications notification
    inner join users account
      on account.id = notification.user_id
      and account.status = 'active'
    inner join organizations organization
      on organization.id = account.organization_id
      and organization.status = 'active'
    inner join web_push_subscriptions subscription
      on subscription.user_id = notification.user_id
      and subscription.organization_id = account.organization_id
      and (subscription.expires_at is null or subscription.expires_at > now())
      and notification.created_at >= subscription.created_at
    left join user_notification_preferences preference
      on preference.organization_id = account.organization_id
      and preference.user_id = notification.user_id
      and preference.category = notification.category
    inner join user_sessions browser_session
      on browser_session.id = subscription.session_id
      and browser_session.user_id = subscription.user_id
      and browser_session.organization_id = subscription.organization_id
      and browser_session.revoked_at is null
      and browser_session.expires_at > now()
    where notification.read = false
      and not exists (
        select 1
        from push_notification_deliveries delivery
        where delivery.notification_id = notification.id
          and delivery.subscription_id = subscription.id
      )
    order by notification.created_at, notification.id, subscription.id
    limit ${boundedLimit}
    on conflict (notification_id, subscription_id) do nothing
    returning id
  `);
  return result.length;
}

type PushDeliveryClaim = {
  id: string;
  organizationId: string;
  claimedAt: Date;
};

type PushDeliveryDependencies = {
  beforeProviderRevalidation?: () => Promise<void> | void;
};

async function claimNextPushDelivery(excludedOrganizationIds: string[]) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({
        id: pushNotificationDeliveries.id,
        organizationId: pushNotificationDeliveries.organizationId,
      })
      .from(pushNotificationDeliveries)
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, pushNotificationDeliveries.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .where(
        and(
          excludedOrganizationIds.length > 0
            ? notInArray(
                pushNotificationDeliveries.organizationId,
                excludedOrganizationIds,
              )
            : undefined,
          or(
            eq(pushNotificationDeliveries.status, "pending"),
            and(
              eq(pushNotificationDeliveries.status, "retrying"),
              lte(pushNotificationDeliveries.nextRetryAt, now),
            ),
            and(
              eq(pushNotificationDeliveries.status, "processing"),
              or(
                isNull(pushNotificationDeliveries.claimedAt),
                lte(pushNotificationDeliveries.claimedAt, staleBefore),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(pushNotificationDeliveries.createdAt))
      .limit(1)
      .for("update", { of: pushNotificationDeliveries, skipLocked: true });
    if (!delivery) return null;
    await tx
      .update(pushNotificationDeliveries)
      .set({ status: "processing", claimedAt: now, updatedAt: now })
      .where(eq(pushNotificationDeliveries.id, delivery.id));
    return { ...delivery, claimedAt: now } satisfies PushDeliveryClaim;
  });
}

function pushStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function permanentPushFailure(status: number | null) {
  return status !== null && [400, 401, 403, 404, 410, 413].includes(status);
}

function pinnedPushAgent(
  addresses: Array<{ address: string; family: 4 | 6 }>,
  attempt: number,
) {
  const selected = addresses[(Math.max(1, attempt) - 1) % addresses.length];
  if (!selected) throw new Error("Push endpoint has no safe address.");
  return new Agent({
    keepAlive: false,
    lookup: (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [selected]);
        return;
      }
      callback(null, selected.address, selected.family);
    },
  });
}

async function finishPushUnavailable(
  claim: PushDeliveryClaim,
  detail: string,
) {
  await db
    .update(pushNotificationDeliveries)
    .set({
      status: "failed",
      attempt: sql`least(${pushNotificationDeliveries.attempt} + 1, ${MAX_ATTEMPTS})`,
      responseBody: detail,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushNotificationDeliveries.id, claim.id),
        eq(pushNotificationDeliveries.organizationId, claim.organizationId),
        eq(pushNotificationDeliveries.status, "processing"),
        eq(pushNotificationDeliveries.claimedAt, claim.claimedAt),
      ),
    );
}

async function finishPushReadSuppressed(claim: PushDeliveryClaim) {
  const [updated] = await db
    .update(pushNotificationDeliveries)
    .set({
      status: "delivered",
      attempt: sql`${pushNotificationDeliveries.attempt} + 1`,
      responseBody: "Bereits in der Anwendung gelesen; Push unterdrueckt.",
      claimedAt: null,
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushNotificationDeliveries.id, claim.id),
        eq(pushNotificationDeliveries.organizationId, claim.organizationId),
        eq(pushNotificationDeliveries.status, "processing"),
        eq(pushNotificationDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

async function finishPushPreferenceSuppressed(claim: PushDeliveryClaim) {
  const [updated] = await db
    .update(pushNotificationDeliveries)
    .set({
      status: "failed",
      attempt: sql`least(${pushNotificationDeliveries.attempt} + 1, ${MAX_ATTEMPTS})`,
      responseStatus: null,
      responseBody: "Durch Benachrichtigungseinstellungen unterdrueckt.",
      nextRetryAt: null,
      claimedAt: null,
      deliveredAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushNotificationDeliveries.id, claim.id),
        eq(pushNotificationDeliveries.organizationId, claim.organizationId),
        eq(pushNotificationDeliveries.status, "processing"),
        eq(pushNotificationDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function deliverQueuedPush(
  claim: PushDeliveryClaim,
  dependencies: PushDeliveryDependencies = {},
) {
  const configuration = getWebPushConfiguration();
  if (!configuration) return null;
  const [record] = await db
    .select({
      delivery: pushNotificationDeliveries,
      subscription: webPushSubscriptions,
      notification: {
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        read: notifications.read,
        category: notifications.category,
      },
      pushEnabled: userNotificationPreferences.pushEnabled,
    })
    .from(pushNotificationDeliveries)
    .innerJoin(
      webPushSubscriptions,
      and(
        eq(webPushSubscriptions.id, pushNotificationDeliveries.subscriptionId),
        eq(webPushSubscriptions.userId, pushNotificationDeliveries.userId),
        eq(
          webPushSubscriptions.organizationId,
          pushNotificationDeliveries.organizationId,
        ),
      ),
    )
    .innerJoin(
      notifications,
      and(
        eq(notifications.id, pushNotificationDeliveries.notificationId),
        eq(notifications.userId, pushNotificationDeliveries.userId),
      ),
    )
    .innerJoin(
      userSessions,
      and(
        eq(userSessions.id, webPushSubscriptions.sessionId),
        eq(userSessions.userId, webPushSubscriptions.userId),
        eq(userSessions.organizationId, webPushSubscriptions.organizationId),
        isNull(userSessions.revokedAt),
        sql`${userSessions.expiresAt} > now()`,
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, pushNotificationDeliveries.userId),
        eq(users.organizationId, pushNotificationDeliveries.organizationId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, pushNotificationDeliveries.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .leftJoin(
      userNotificationPreferences,
      and(
        eq(
          userNotificationPreferences.organizationId,
          pushNotificationDeliveries.organizationId,
        ),
        eq(
          userNotificationPreferences.userId,
          pushNotificationDeliveries.userId,
        ),
        eq(userNotificationPreferences.category, notifications.category),
      ),
    )
    .where(
      and(
        eq(pushNotificationDeliveries.id, claim.id),
        eq(pushNotificationDeliveries.organizationId, claim.organizationId),
        eq(pushNotificationDeliveries.status, "processing"),
        eq(pushNotificationDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .limit(1);

  if (!record) {
    await finishPushUnavailable(
      claim,
      "Der Push-Empfaenger ist nicht mehr zulaessig.",
    );
    return null;
  }

  if (record.notification.read) {
    return await finishPushReadSuppressed(claim);
  }

  if (
    record.notification.category !== "system" &&
    record.pushEnabled === false
  ) {
    return await finishPushPreferenceSuppressed(claim);
  }

  if (record.subscription.expiresAt && record.subscription.expiresAt <= new Date()) {
    await db
      .delete(webPushSubscriptions)
      .where(eq(webPushSubscriptions.id, record.subscription.id));
    return { id: claim.id, status: "expired" as const };
  }

  const attempt = record.delivery.attempt + 1;
  let responseStatus: number | null = null;
  let delivered = false;
  let permanent = false;
  try {
    const subscription = decryptWebPushSubscription({
      id: record.subscription.id,
      organizationId: record.subscription.organizationId,
      userId: record.subscription.userId,
      sessionId: record.subscription.sessionId,
      subscriptionEncrypted: record.subscription.subscriptionEncrypted,
    });
    const target = await resolveSafeWebhookTarget(subscription.endpoint);
    await dependencies.beforeProviderRevalidation?.();
    const [providerRecipient] = await db
      .select({
        read: notifications.read,
        category: notifications.category,
        pushEnabled: userNotificationPreferences.pushEnabled,
      })
      .from(pushNotificationDeliveries)
      .innerJoin(
        webPushSubscriptions,
        and(
          eq(webPushSubscriptions.id, pushNotificationDeliveries.subscriptionId),
          eq(webPushSubscriptions.userId, pushNotificationDeliveries.userId),
          eq(
            webPushSubscriptions.organizationId,
            pushNotificationDeliveries.organizationId,
          ),
        ),
      )
      .innerJoin(
        notifications,
        and(
          eq(notifications.id, pushNotificationDeliveries.notificationId),
          eq(notifications.userId, pushNotificationDeliveries.userId),
        ),
      )
      .innerJoin(
        userSessions,
        and(
          eq(userSessions.id, webPushSubscriptions.sessionId),
          eq(userSessions.userId, webPushSubscriptions.userId),
          eq(
            userSessions.organizationId,
            webPushSubscriptions.organizationId,
          ),
          isNull(userSessions.revokedAt),
          sql`${userSessions.expiresAt} > now()`,
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, pushNotificationDeliveries.userId),
          eq(users.organizationId, pushNotificationDeliveries.organizationId),
          eq(users.status, "active"),
        ),
      )
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, pushNotificationDeliveries.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .leftJoin(
        userNotificationPreferences,
        and(
          eq(
            userNotificationPreferences.organizationId,
            pushNotificationDeliveries.organizationId,
          ),
          eq(
            userNotificationPreferences.userId,
            pushNotificationDeliveries.userId,
          ),
          eq(userNotificationPreferences.category, notifications.category),
        ),
      )
      .where(
        and(
          eq(pushNotificationDeliveries.id, claim.id),
          eq(pushNotificationDeliveries.organizationId, claim.organizationId),
          eq(pushNotificationDeliveries.status, "processing"),
          eq(pushNotificationDeliveries.claimedAt, claim.claimedAt),
        ),
      )
      .limit(1);
    if (!providerRecipient) {
      await finishPushUnavailable(
        claim,
        "Der Push-Empfaenger ist nicht mehr zulaessig.",
      );
      return null;
    }
    if (providerRecipient.read) {
      return await finishPushReadSuppressed(claim);
    }
    if (
      providerRecipient.category !== "system" &&
      providerRecipient.pushEnabled === false
    ) {
      return await finishPushPreferenceSuppressed(claim);
    }
    const response = await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: subscription.keys,
      },
      JSON.stringify({
        notificationId: record.notification.id,
        title: boundedText(record.notification.title, 180),
        body: boundedText(record.notification.body, 500),
        href: safeNotificationHref(record.notification.href),
      }),
      {
        TTL: 24 * 60 * 60,
        urgency: "normal",
        topic: record.notification.id.replaceAll("-", "").slice(0, 32),
        timeout: 10_000,
        vapidDetails: configuration,
        agent: pinnedPushAgent(target.addresses, attempt),
      },
    );
    responseStatus = response.statusCode;
    delivered = response.statusCode >= 200 && response.statusCode < 300;
    permanent = !delivered && permanentPushFailure(responseStatus);
  } catch (error) {
    responseStatus = pushStatus(error);
    permanent = permanentPushFailure(responseStatus);
  }

  if (responseStatus === 404 || responseStatus === 410) {
    await db
      .delete(webPushSubscriptions)
      .where(eq(webPushSubscriptions.id, record.subscription.id));
    return { id: claim.id, status: "expired" as const };
  }

  const status = delivered
    ? "delivered"
    : permanent || attempt >= MAX_ATTEMPTS
      ? "failed"
      : "retrying";
  const [updated] = await db
    .update(pushNotificationDeliveries)
    .set({
      status,
      attempt,
      responseStatus,
      responseBody: delivered
        ? null
        : responseStatus
          ? `Der Push-Dienst antwortete mit HTTP ${responseStatus}.`
          : "Der Push-Dienst war nicht erreichbar.",
      nextRetryAt: status === "retrying" ? retryAt(attempt) : null,
      claimedAt: null,
      deliveredAt: delivered ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushNotificationDeliveries.id, claim.id),
        eq(pushNotificationDeliveries.organizationId, claim.organizationId),
        eq(pushNotificationDeliveries.status, "processing"),
        eq(pushNotificationDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function processPushQueue(limit = 25) {
  if (!getWebPushConfiguration()) return [];
  const boundedLimit = Math.max(1, Math.min(100, limit));
  await materializePushNotificationDeliveries(Math.max(100, boundedLimit * 4));

  const claims: PushDeliveryClaim[] = [];
  const tenantClaims = new Map<string, number>();
  for (let index = 0; index < boundedLimit; index += 1) {
    const excludedOrganizationIds = [...tenantClaims]
      .filter(([, count]) => count >= MAX_CLAIMS_PER_TENANT)
      .map(([organizationId]) => organizationId);
    let claim = await claimNextPushDelivery(excludedOrganizationIds);
    if (!claim && excludedOrganizationIds.length > 0) {
      tenantClaims.clear();
      claim = await claimNextPushDelivery([]);
    }
    if (!claim) break;
    claims.push(claim);
    tenantClaims.set(
      claim.organizationId,
      (tenantClaims.get(claim.organizationId) ?? 0) + 1,
    );
  }

  const results = [];
  for (let index = 0; index < claims.length; index += WORKER_CONCURRENCY) {
    const batch = claims.slice(index, index + WORKER_CONCURRENCY);
    const delivered = await Promise.all(
      batch.map((claim) => deliverQueuedPush(claim)),
    );
    results.push(...delivered.filter((result) => result !== null));
  }
  return results;
}
