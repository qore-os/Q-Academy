import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import webPush from "web-push";

const databaseName = `q_academy_web_push_${process.pid}_test`;
const adminUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function isApiConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409 &&
    "code" in error &&
    error.code === "conflict"
  );
}

function isApiUnauthorized(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 401 &&
    "code" in error &&
    error.code === "authentication_required"
  );
}

function browserSubscription(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey(undefined, "uncompressed").toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

test(
  "web push encrypts tenant-bound subscriptions and delivers each queue item exactly once",
  { timeout: 120_000 },
  async () => {
    assert.match(databaseName, /^q_academy_web_push_[0-9]+_test$/);
    const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    let sql: ReturnType<typeof postgres> | null = null;
    let applicationClient: { end: () => Promise<void> } | null = null;
    const originalSendNotification = webPush.sendNotification;
    const originalEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      WEB_PUSH_VAPID_PUBLIC_KEY: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
      WEB_PUSH_VAPID_PRIVATE_KEY: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
      WEB_PUSH_VAPID_SUBJECT: process.env.WEB_PUSH_VAPID_SUBJECT,
    };

    try {
      await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
      await admin.unsafe(
        `create database "${databaseName}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
      );
      sql = postgres(databaseUrl.toString(), {
        max: 6,
        prepare: false,
        onnotice: () => undefined,
      });
      await migrate(drizzle(sql), {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });

      const vapid = webPush.generateVAPIDKeys();
      process.env.DATABASE_URL = databaseUrl.toString();
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapid.publicKey;
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapid.privateKey;
      process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:push@q-academy.de";

      const [{ postgresClient }, subscriptions, delivery] = await Promise.all([
        import("../src/db/index"),
        import("../src/lib/push/subscriptions"),
        import("../src/lib/push/delivery"),
      ]);
      applicationClient = postgresClient;

      const invalidPoint = Buffer.alloc(65);
      invalidPoint[0] = 4;
      assert.equal(
        subscriptions.pushSubscriptionSchema.safeParse({
          ...browserSubscription("https://localhost/push/invalid-point"),
          keys: {
            p256dh: invalidPoint.toString("base64url"),
            auth: randomBytes(16).toString("base64url"),
          },
        }).success,
        false,
      );

      const suffix = `${Date.now()}-${randomUUID()}`;
      const organizations = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values
          (${`Push primary ${suffix}`}, ${`push-primary-${suffix}`}),
          (${`Push foreign ${suffix}`}, ${`push-foreign-${suffix}`})
        returning id
      `;
      const primaryOrganizationId = organizations[0]!.id;
      const foreignOrganizationId = organizations[1]!.id;
      const createdUsers = await sql<
        Array<{ id: string; organization_id: string }>
      >`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${primaryOrganizationId}, ${`push-primary-${suffix}@example.test`}, 'unused', 'Push', 'Primary', 'member'),
          (${foreignOrganizationId}, ${`push-foreign-${suffix}@example.test`}, 'unused', 'Push', 'Foreign', 'member')
        returning id, organization_id
      `;
      const primaryUserId = createdUsers[0]!.id;
      const foreignUserId = createdUsers[1]!.id;
      const createdSessions = await sql<Array<{ id: string }>>`
        insert into user_sessions (
          organization_id, user_id, jti_hash, expires_at
        ) values
          (${primaryOrganizationId}, ${primaryUserId}, ${createHash("sha256").update(`primary-${suffix}`).digest("hex")}, now() + interval '1 day'),
          (${primaryOrganizationId}, ${primaryUserId}, ${createHash("sha256").update(`primary-secondary-${suffix}`).digest("hex")}, now() + interval '1 day'),
          (${foreignOrganizationId}, ${foreignUserId}, ${createHash("sha256").update(`foreign-${suffix}`).digest("hex")}, now() + interval '1 day')
        returning id
      `;
      const primarySessionId = createdSessions[0]!.id;
      const secondaryPrimarySessionId = createdSessions[1]!.id;
      const foreignSessionId = createdSessions[2]!.id;
      const endpoint = `https://localhost/push/${randomUUID()}`;
      const subscription = browserSubscription(endpoint);

      const created = await subscriptions.upsertWebPushSubscription({
        organizationId: primaryOrganizationId,
        userId: primaryUserId,
        sessionId: primarySessionId,
        subscription,
      });
      const [stored] = await sql<
        Array<{
          id: string;
          organization_id: string;
          user_id: string;
          session_id: string;
          endpoint_hash: string;
          subscription_encrypted: unknown;
        }>
      >`
        select id, organization_id, user_id, session_id, endpoint_hash, subscription_encrypted
        from web_push_subscriptions
        where id = ${created.id}
      `;
      assert.ok(stored);
      assert.equal(stored.organization_id, primaryOrganizationId);
      assert.equal(stored.user_id, primaryUserId);
      assert.equal(stored.session_id, primarySessionId);
      assert.equal(
        stored.endpoint_hash,
        createHash("sha256").update(new URL(endpoint).toString()).digest("hex"),
      );
      const serializedEncrypted = JSON.stringify(stored.subscription_encrypted);
      assert.equal(serializedEncrypted.includes(endpoint), false);
      assert.equal(serializedEncrypted.includes(subscription.keys.auth), false);
      assert.deepEqual(
        subscriptions.decryptWebPushSubscription({
          id: stored.id,
          organizationId: primaryOrganizationId,
          userId: primaryUserId,
          sessionId: primarySessionId,
          subscriptionEncrypted: stored.subscription_encrypted,
        }),
        subscription,
      );
      assert.throws(() =>
        subscriptions.decryptWebPushSubscription({
          id: stored.id,
          organizationId: foreignOrganizationId,
          userId: primaryUserId,
          sessionId: primarySessionId,
          subscriptionEncrypted: stored.subscription_encrypted,
        }),
      );
      assert.throws(() =>
        subscriptions.decryptWebPushSubscription({
          id: stored.id,
          organizationId: primaryOrganizationId,
          userId: primaryUserId,
          sessionId: foreignSessionId,
          subscriptionEncrypted: stored.subscription_encrypted,
        }),
      );
      assert.throws(() =>
        subscriptions.decryptWebPushSubscription({
          id: stored.id,
          organizationId: primaryOrganizationId,
          userId: foreignUserId,
          sessionId: primarySessionId,
          subscriptionEncrypted: stored.subscription_encrypted,
        }),
      );
      assert.throws(() =>
        subscriptions.decryptWebPushSubscription({
          id: randomUUID(),
          organizationId: primaryOrganizationId,
          userId: primaryUserId,
          sessionId: primarySessionId,
          subscriptionEncrypted: stored.subscription_encrypted,
        }),
      );

      await assert.rejects(
        subscriptions.upsertWebPushSubscription({
          organizationId: primaryOrganizationId,
          userId: primaryUserId,
          sessionId: secondaryPrimarySessionId,
          subscription: browserSubscription(endpoint),
        }),
        isApiConflict,
      );
      await sql`
        update user_sessions set revoked_at = now()
        where id = ${secondaryPrimarySessionId}
      `;
      await assert.rejects(
        subscriptions.upsertWebPushSubscription({
          organizationId: primaryOrganizationId,
          userId: primaryUserId,
          sessionId: secondaryPrimarySessionId,
          subscription: browserSubscription(
            `https://localhost/push/${randomUUID()}`,
          ),
        }),
        isApiUnauthorized,
      );
      await assert.rejects(
        subscriptions.upsertWebPushSubscription({
          organizationId: foreignOrganizationId,
          userId: foreignUserId,
          sessionId: foreignSessionId,
          subscription: browserSubscription(endpoint),
        }),
        isApiConflict,
      );
      const [ownership] = await sql<
        Array<{ organization_id: string; user_id: string }>
      >`
        select organization_id, user_id
        from web_push_subscriptions
        where id = ${stored.id}
      `;
      assert.deepEqual(ownership, {
        organization_id: primaryOrganizationId,
        user_id: primaryUserId,
      });

      await assert.rejects(
        sql`
          insert into web_push_subscriptions (
            organization_id, user_id, session_id, endpoint_hash,
            subscription_encrypted
          ) select
            ${foreignOrganizationId},
            ${primaryUserId},
            ${primarySessionId},
            ${"b".repeat(64)},
            subscription_encrypted
          from web_push_subscriptions
          where id = ${stored.id}
        `,
        (error) => databaseErrorCode(error) === "23503",
      );
      await assert.rejects(
        sql`
          insert into web_push_subscriptions (
            organization_id, user_id, session_id, endpoint_hash,
            subscription_encrypted
          ) select
            ${primaryOrganizationId},
            ${primaryUserId},
            ${foreignSessionId},
            ${"c".repeat(64)},
            subscription_encrypted
          from web_push_subscriptions
          where id = ${stored.id}
        `,
        (error) => databaseErrorCode(error) === "23503",
      );
      await assert.rejects(
        sql`
          insert into web_push_subscriptions (
            organization_id, user_id, session_id, endpoint_hash,
            subscription_encrypted
          ) select
            ${primaryOrganizationId},
            ${primaryUserId},
            ${primarySessionId},
            'not-a-sha256-hash',
            subscription_encrypted
          from web_push_subscriptions
          where id = ${stored.id}
        `,
        (error) => databaseErrorCode(error) === "23514",
      );

      await sql`select pg_sleep(0.005)`;
      const [notification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, href)
        values (${primaryUserId}, 'Neue Lektion', 'Die Lektion ist jetzt verfuegbar.', '/academy/courses')
        returning id
      `;
      const [foreignNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, href)
        values (${foreignUserId}, 'Fremde Lektion', 'Tenant-isoliert.', '/academy')
        returning id
      `;
      const concurrentMaterialization = await Promise.all([
        delivery.materializePushNotificationDeliveries(),
        delivery.materializePushNotificationDeliveries(),
        delivery.materializePushNotificationDeliveries(),
      ]);
      assert.equal(
        concurrentMaterialization.reduce((total, value) => total + value, 0),
        1,
      );
      assert.equal(await delivery.materializePushNotificationDeliveries(), 0);
      const [materialized] = await sql<
        Array<{ id: string; notification_id: string; subscription_id: string }>
      >`
        select id, notification_id, subscription_id
        from push_notification_deliveries
      `;
      assert.ok(materialized);
      assert.equal(materialized.notification_id, notification.id);
      assert.equal(materialized.subscription_id, stored.id);

      await assert.rejects(
        sql`
          insert into push_notification_deliveries (
            organization_id, user_id, notification_id, subscription_id
          ) values (
            ${foreignOrganizationId},
            ${foreignUserId},
            ${foreignNotification.id},
            ${stored.id}
          )
        `,
        (error) => databaseErrorCode(error) === "23503",
      );

      let sendCalls = 0;
      webPush.sendNotification = (async () => {
        sendCalls += 1;
        return { statusCode: 201, headers: {}, body: "" };
      }) as typeof webPush.sendNotification;
      const firstClaimedAt = new Date();
      await sql`
        update push_notification_deliveries
        set status = 'processing',
            claimed_at = ${firstClaimedAt.toISOString()}::timestamptz,
            updated_at = ${firstClaimedAt.toISOString()}::timestamptz
        where id = ${materialized.id}
      `;
      const firstDelivery = await delivery.deliverQueuedPush({
        id: materialized.id,
        organizationId: primaryOrganizationId,
        claimedAt: firstClaimedAt,
      });
      assert.equal(firstDelivery?.status, "delivered");
      assert.equal(firstDelivery?.attempt, 1);
      assert.equal(sendCalls, 1);
      assert.equal(
        await delivery.deliverQueuedPush({
          id: materialized.id,
          organizationId: primaryOrganizationId,
          claimedAt: firstClaimedAt,
        }),
        null,
      );
      assert.equal(sendCalls, 1);

      await sql`
        insert into user_notification_preferences (
          organization_id, user_id, category, email_enabled, push_enabled
        ) values (${primaryOrganizationId}, ${primaryUserId}, 'learning', true, false)
      `;
      await assert.rejects(
        sql`
          insert into user_notification_preferences (
            organization_id, user_id, category, email_enabled, push_enabled
          ) values (${foreignOrganizationId}, ${primaryUserId}, 'learning', true, false)
        `,
        (error) => databaseErrorCode(error) === "23503",
      );
      const [blockedNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, category)
        values (${primaryUserId}, 'Unterdrueckt', 'Kein Push.', 'learning')
        returning id
      `;
      assert.equal(await delivery.materializePushNotificationDeliveries(), 1);
      const [blockedDelivery] = await sql<
        Array<{ status: string; response_body: string | null }>
      >`
        select status, response_body from push_notification_deliveries
        where notification_id = ${blockedNotification.id}
      `;
      assert.deepEqual(blockedDelivery, {
        status: "failed",
        response_body: "Durch Benachrichtigungseinstellungen unterdrueckt.",
      });

      await sql`
        update user_notification_preferences set push_enabled = true
        where organization_id = ${primaryOrganizationId}
          and user_id = ${primaryUserId} and category = 'learning'
      `;
      const [revalidatedNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, category)
        values (${primaryUserId}, 'Revalidiert', 'Opt-out vor Versand.', 'learning')
        returning id
      `;
      assert.equal(await delivery.materializePushNotificationDeliveries(), 1);
      const [revalidatedDelivery] = await sql<Array<{ id: string }>>`
        select id from push_notification_deliveries
        where notification_id = ${revalidatedNotification.id}
      `;
      const revalidatedClaimedAt = new Date();
      await sql`
        update push_notification_deliveries
        set status = 'processing', claimed_at = ${revalidatedClaimedAt.toISOString()}::timestamptz,
            updated_at = ${revalidatedClaimedAt.toISOString()}::timestamptz
        where id = ${revalidatedDelivery.id}
      `;
      const callsBeforePreferenceRevalidation = sendCalls;
      const preferenceClient = sql;
      let preferenceRaceHookCalls = 0;
      const suppressed = await delivery.deliverQueuedPush(
        {
          id: revalidatedDelivery.id,
          organizationId: primaryOrganizationId,
          claimedAt: revalidatedClaimedAt,
        },
        {
          beforeProviderRevalidation: async () => {
            preferenceRaceHookCalls += 1;
            await preferenceClient`
              update user_notification_preferences set push_enabled = false
              where organization_id = ${primaryOrganizationId}
                and user_id = ${primaryUserId} and category = 'learning'
            `;
          },
        },
      );
      assert.equal(preferenceRaceHookCalls, 1);
      assert.equal(suppressed?.status, "failed");
      assert.equal(
        suppressed?.responseBody,
        "Durch Benachrichtigungseinstellungen unterdrueckt.",
      );
      assert.equal(sendCalls, callsBeforePreferenceRevalidation);

      await sql`select pg_sleep(0.005)`;
      const [retryNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body)
        values (${primaryUserId}, 'Retry', 'Push-Dienst temporaer nicht erreichbar.')
        returning id
      `;
      assert.equal(await delivery.materializePushNotificationDeliveries(), 1);
      const [retryDelivery] = await sql<Array<{ id: string }>>`
        select id from push_notification_deliveries
        where notification_id = ${retryNotification.id}
      `;
      const retryClaimedAt = new Date();
      await sql`
        update push_notification_deliveries
        set status = 'processing',
            claimed_at = ${retryClaimedAt.toISOString()}::timestamptz,
            updated_at = ${retryClaimedAt.toISOString()}::timestamptz
        where id = ${retryDelivery.id}
      `;
      webPush.sendNotification = (async () => {
        sendCalls += 1;
        throw Object.assign(new Error("temporary push outage"), { statusCode: 503 });
      }) as typeof webPush.sendNotification;
      const retrying = await delivery.deliverQueuedPush({
        id: retryDelivery.id,
        organizationId: primaryOrganizationId,
        claimedAt: retryClaimedAt,
      });
      assert.equal(retrying?.status, "retrying");
      assert.equal(retrying?.attempt, 1);
      assert.ok(retrying?.nextRetryAt instanceof Date);

      const secondClaimedAt = new Date(Date.now() + 1);
      await sql`
        update push_notification_deliveries
        set status = 'processing',
            claimed_at = ${secondClaimedAt.toISOString()}::timestamptz,
            next_retry_at = null,
            updated_at = ${secondClaimedAt.toISOString()}::timestamptz
        where id = ${retryDelivery.id}
      `;
      webPush.sendNotification = (async () => {
        sendCalls += 1;
        return { statusCode: 201, headers: {}, body: "" };
      }) as typeof webPush.sendNotification;
      const recovered = await delivery.deliverQueuedPush({
        id: retryDelivery.id,
        organizationId: primaryOrganizationId,
        claimedAt: secondClaimedAt,
      });
      assert.equal(recovered?.status, "delivered");
      assert.equal(recovered?.attempt, 2);

      await sql`select pg_sleep(0.005)`;
      const [workerNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body)
        values (${primaryUserId}, 'Worker', 'Wird vom Queue-Worker beansprucht.')
        returning id
      `;
      const callsBeforeWorker = sendCalls;
      const workerResults = await delivery.processPushQueue(10);
      assert.equal(workerResults.length, 1);
      assert.equal(workerResults[0]?.status, "delivered");
      assert.equal(sendCalls, callsBeforeWorker + 1);
      assert.deepEqual(await delivery.processPushQueue(10), []);
      assert.equal(sendCalls, callsBeforeWorker + 1);
      const [workerDelivery] = await sql<Array<{ status: string; attempt: number }>>`
        select status, attempt
        from push_notification_deliveries
        where notification_id = ${workerNotification.id}
      `;
      assert.deepEqual(workerDelivery, { status: "delivered", attempt: 1 });

      await sql`select pg_sleep(0.005)`;
      const [staleNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body)
        values (${primaryUserId}, 'Stale', 'Browser-Abonnement ist abgelaufen.')
        returning id
      `;
      assert.equal(await delivery.materializePushNotificationDeliveries(), 1);
      const [staleDelivery] = await sql<Array<{ id: string }>>`
        select id from push_notification_deliveries
        where notification_id = ${staleNotification.id}
      `;
      const staleClaimedAt = new Date();
      await sql`
        update push_notification_deliveries
        set status = 'processing',
            claimed_at = ${staleClaimedAt.toISOString()}::timestamptz,
            updated_at = ${staleClaimedAt.toISOString()}::timestamptz
        where id = ${staleDelivery.id}
      `;
      webPush.sendNotification = (async () => {
        sendCalls += 1;
        throw Object.assign(new Error("subscription gone"), { statusCode: 410 });
      }) as typeof webPush.sendNotification;
      assert.deepEqual(
        await delivery.deliverQueuedPush({
          id: staleDelivery.id,
          organizationId: primaryOrganizationId,
          claimedAt: staleClaimedAt,
        }),
        { id: staleDelivery.id, status: "expired" },
      );
      const [remaining] = await sql<
        Array<{ subscriptions: number; deliveries: number }>
      >`
        select
          (select count(*)::int from web_push_subscriptions) as subscriptions,
          (select count(*)::int from push_notification_deliveries) as deliveries
      `;
      assert.deepEqual(remaining, { subscriptions: 0, deliveries: 0 });

      const replacementSubscription = browserSubscription(
        `https://localhost/push/${randomUUID()}`,
      );
      const replacement = await subscriptions.upsertWebPushSubscription({
        organizationId: primaryOrganizationId,
        userId: primaryUserId,
        sessionId: primarySessionId,
        subscription: replacementSubscription,
      });
      assert.equal(
        await subscriptions.hasWebPushSubscription({
          organizationId: primaryOrganizationId,
          userId: primaryUserId,
          sessionId: primarySessionId,
          endpoint: replacementSubscription.endpoint,
        }),
        true,
      );
      await sql`
        update user_sessions set revoked_at = now()
        where id = ${primarySessionId}
      `;
      const [revokedSessionCleanup] = await sql<Array<{ value: number }>>`
        select count(*)::int as value
        from web_push_subscriptions where id = ${replacement.id}
      `;
      assert.equal(revokedSessionCleanup.value, 0);
    } finally {
      webPush.sendNotification = originalSendNotification;
      if (applicationClient) await applicationClient.end();
      if (sql) await sql.end();
      await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
      await admin.end();
      for (const [name, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  },
);
