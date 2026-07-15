import "server-only";

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  nativePushDeliveries,
  nativePushDevices,
  notifications,
  organizations,
  userNotificationPreferences,
  userSessions,
  users,
} from "@/db/schema";
import { decryptNativePushToken } from "@/lib/push/native-devices";
import { deliverNativePush } from "@/lib/push/native-provider";
import { resolveNativePushProviderConfiguration } from "@/lib/push/native-provider-config";

const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;
const WORKER_CONCURRENCY = 5;

function safeHref(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/academy";
  try {
    const parsed = new URL(value, "https://q-academy.local");
    if (parsed.origin !== "https://q-academy.local") return "/academy";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/academy";
  }
}

function retryAt(attempt: number) {
  const base = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + base + Math.round(base * (Math.random() * 0.2 - 0.1)));
}

export async function materializeNativePushDeliveries(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(1_000, limit));
  const rows = await db.execute(sql`
    insert into native_push_deliveries (
      organization_id, user_id, notification_id, device_id, status, response_body
    )
    select
      device.organization_id,
      notification.user_id,
      notification.id,
      device.id,
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
      on account.id = notification.user_id and account.status = 'active'
    inner join organizations organization
      on organization.id = account.organization_id and organization.status = 'active'
    inner join native_push_devices device
      on device.user_id = notification.user_id
      and device.organization_id = account.organization_id
      and notification.created_at >= device.created_at
    left join user_notification_preferences preference
      on preference.organization_id = account.organization_id
      and preference.user_id = notification.user_id
      and preference.category = notification.category
    inner join user_sessions native_session
      on native_session.id = device.session_id
      and native_session.user_id = device.user_id
      and native_session.organization_id = device.organization_id
      and native_session.revoked_at is null
      and native_session.expires_at > now()
    where notification.read = false
      and not exists (
        select 1 from native_push_deliveries delivery
        where delivery.notification_id = notification.id
          and delivery.device_id = device.id
      )
    order by notification.created_at, notification.id, device.id
    limit ${boundedLimit}
    on conflict (notification_id, device_id) do nothing
    returning id
  `);
  return rows.length;
}

type Claim = { id: string; claimedAt: Date };

type NativePushDeliveryDependencies = {
  deliver?: typeof deliverNativePush;
  beforeProviderRevalidation?: () => Promise<void> | void;
};

async function claimNext(): Promise<Claim | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({ id: nativePushDeliveries.id })
      .from(nativePushDeliveries)
      .where(
        or(
          eq(nativePushDeliveries.status, "pending"),
          and(
            eq(nativePushDeliveries.status, "retrying"),
            lte(nativePushDeliveries.nextRetryAt, now),
          ),
          and(
            eq(nativePushDeliveries.status, "processing"),
            or(
              isNull(nativePushDeliveries.claimedAt),
              lte(nativePushDeliveries.claimedAt, staleBefore),
            ),
          ),
        ),
      )
      .orderBy(asc(nativePushDeliveries.createdAt), asc(nativePushDeliveries.id))
      .limit(1)
      .for("update", { of: nativePushDeliveries, skipLocked: true });
    if (!delivery) return null;
    await tx
      .update(nativePushDeliveries)
      .set({ status: "processing", claimedAt: now, updatedAt: now })
      .where(eq(nativePushDeliveries.id, delivery.id));
    return { id: delivery.id, claimedAt: now };
  });
}

async function finishUnavailable(claim: Claim, detail: string) {
  await db
    .update(nativePushDeliveries)
    .set({
      status: "failed",
      attempt: sql`least(${nativePushDeliveries.attempt} + 1, ${MAX_ATTEMPTS})`,
      responseBody: detail.slice(0, 500),
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(nativePushDeliveries.id, claim.id),
        eq(nativePushDeliveries.status, "processing"),
        eq(nativePushDeliveries.claimedAt, claim.claimedAt),
      ),
    );
}

async function finishReadSuppressed(claim: Claim) {
  const [updated] = await db
    .update(nativePushDeliveries)
    .set({
      status: "delivered",
      attempt: sql`${nativePushDeliveries.attempt} + 1`,
      responseBody: "Bereits in der Anwendung gelesen; Push unterdrueckt.",
      claimedAt: null,
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(nativePushDeliveries.id, claim.id),
        eq(nativePushDeliveries.status, "processing"),
        eq(nativePushDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

async function finishPreferenceSuppressed(claim: Claim) {
  const [updated] = await db
    .update(nativePushDeliveries)
    .set({
      status: "failed",
      attempt: sql`least(${nativePushDeliveries.attempt} + 1, ${MAX_ATTEMPTS})`,
      responseStatus: null,
      responseBody: "Durch Benachrichtigungseinstellungen unterdrueckt.",
      nextRetryAt: null,
      claimedAt: null,
      deliveredAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(nativePushDeliveries.id, claim.id),
        eq(nativePushDeliveries.status, "processing"),
        eq(nativePushDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function deliverQueuedNativePush(
  claim: Claim,
  dependencies: NativePushDeliveryDependencies = {},
) {
  const [record] = await db
    .select({
      delivery: nativePushDeliveries,
      device: nativePushDevices,
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
    .from(nativePushDeliveries)
    .innerJoin(
      nativePushDevices,
      and(
        eq(nativePushDevices.id, nativePushDeliveries.deviceId),
        eq(nativePushDevices.userId, nativePushDeliveries.userId),
        eq(nativePushDevices.organizationId, nativePushDeliveries.organizationId),
      ),
    )
    .innerJoin(
      notifications,
      and(
        eq(notifications.id, nativePushDeliveries.notificationId),
        eq(notifications.userId, nativePushDeliveries.userId),
      ),
    )
    .innerJoin(
      userSessions,
      and(
        eq(userSessions.id, nativePushDevices.sessionId),
        eq(userSessions.userId, nativePushDevices.userId),
        eq(userSessions.organizationId, nativePushDevices.organizationId),
        isNull(userSessions.revokedAt),
        sql`${userSessions.expiresAt} > now()`,
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, nativePushDeliveries.userId),
        eq(users.organizationId, nativePushDeliveries.organizationId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, nativePushDeliveries.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .leftJoin(
      userNotificationPreferences,
      and(
        eq(
          userNotificationPreferences.organizationId,
          nativePushDeliveries.organizationId,
        ),
        eq(userNotificationPreferences.userId, nativePushDeliveries.userId),
        eq(userNotificationPreferences.category, notifications.category),
      ),
    )
    .where(
      and(
        eq(nativePushDeliveries.id, claim.id),
        eq(nativePushDeliveries.status, "processing"),
        eq(nativePushDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .limit(1);
  if (!record) {
    await finishUnavailable(claim, "Der native Push-Empfaenger ist nicht mehr zulaessig.");
    return null;
  }
  const attempt = record.delivery.attempt + 1;
  if (record.notification.read) {
    return await finishReadSuppressed(claim);
  }
  if (
    record.notification.category !== "system" &&
    record.pushEnabled === false
  ) {
    return await finishPreferenceSuppressed(claim);
  }
  const token = decryptNativePushToken({
    id: record.device.id,
    organizationId: record.device.organizationId,
    userId: record.device.userId,
    sessionId: record.device.sessionId,
    tokenEncrypted: record.device.tokenEncrypted,
  });
  await dependencies.beforeProviderRevalidation?.();
  const [providerRecipient] = await db
    .select({
      read: notifications.read,
      category: notifications.category,
      pushEnabled: userNotificationPreferences.pushEnabled,
    })
    .from(nativePushDeliveries)
    .innerJoin(
      nativePushDevices,
      and(
        eq(nativePushDevices.id, nativePushDeliveries.deviceId),
        eq(nativePushDevices.userId, nativePushDeliveries.userId),
        eq(nativePushDevices.organizationId, nativePushDeliveries.organizationId),
      ),
    )
    .innerJoin(
      notifications,
      and(
        eq(notifications.id, nativePushDeliveries.notificationId),
        eq(notifications.userId, nativePushDeliveries.userId),
      ),
    )
    .innerJoin(
      userSessions,
      and(
        eq(userSessions.id, nativePushDevices.sessionId),
        eq(userSessions.userId, nativePushDevices.userId),
        eq(userSessions.organizationId, nativePushDevices.organizationId),
        isNull(userSessions.revokedAt),
        sql`${userSessions.expiresAt} > now()`,
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, nativePushDeliveries.userId),
        eq(users.organizationId, nativePushDeliveries.organizationId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, nativePushDeliveries.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .leftJoin(
      userNotificationPreferences,
      and(
        eq(
          userNotificationPreferences.organizationId,
          nativePushDeliveries.organizationId,
        ),
        eq(userNotificationPreferences.userId, nativePushDeliveries.userId),
        eq(userNotificationPreferences.category, notifications.category),
      ),
    )
    .where(
      and(
        eq(nativePushDeliveries.id, claim.id),
        eq(nativePushDeliveries.status, "processing"),
        eq(nativePushDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .limit(1);
  if (!providerRecipient) {
    await finishUnavailable(
      claim,
      "Der native Push-Empfaenger ist nicht mehr zulaessig.",
    );
    return null;
  }
  if (providerRecipient.read) {
    return await finishReadSuppressed(claim);
  }
  if (
    providerRecipient.category !== "system" &&
    providerRecipient.pushEnabled === false
  ) {
    return await finishPreferenceSuppressed(claim);
  }
  const provider = await (dependencies.deliver ?? deliverNativePush)({
    platform: record.device.platform,
    token,
    message: {
      notificationId: record.notification.id,
      title: record.notification.title,
      body: record.notification.body,
      href: safeHref(record.notification.href),
    },
  });
  if (provider.expired) {
    await db.delete(nativePushDevices).where(eq(nativePushDevices.id, record.device.id));
    return { id: claim.id, status: "expired" as const };
  }
  const status = provider.delivered
    ? "delivered"
    : provider.permanent || attempt >= MAX_ATTEMPTS
      ? "failed"
      : "retrying";
  const [updated] = await db
    .update(nativePushDeliveries)
    .set({
      status,
      attempt,
      responseStatus: provider.status,
      responseBody: provider.delivered ? null : provider.detail,
      nextRetryAt: status === "retrying" ? retryAt(attempt) : null,
      claimedAt: null,
      deliveredAt: provider.delivered ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(nativePushDeliveries.id, claim.id),
        eq(nativePushDeliveries.status, "processing"),
        eq(nativePushDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function processNativePushQueue(
  limit = 25,
  dependencies: NativePushDeliveryDependencies = {},
) {
  const configuration = resolveNativePushProviderConfiguration();
  if (!configuration.android && !configuration.ios) return [];
  const boundedLimit = Math.max(1, Math.min(100, limit));
  await materializeNativePushDeliveries(Math.max(100, boundedLimit * 4));
  const claims: Claim[] = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const claim = await claimNext();
    if (!claim) break;
    claims.push(claim);
  }
  const results = [];
  for (let index = 0; index < claims.length; index += WORKER_CONCURRENCY) {
    const batch = claims.slice(index, index + WORKER_CONCURRENCY);
    const delivered = await Promise.all(
      batch.map((claim) => deliverQueuedNativePush(claim, dependencies)),
    );
    results.push(...delivered.filter((entry) => entry !== null));
  }
  return results;
}
