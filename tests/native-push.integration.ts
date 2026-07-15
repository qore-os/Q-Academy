import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 3, prepare: false });
let applicationClient: { end: () => Promise<void> } | null = null;

after(async () => {
  await Promise.all([sql.end(), applicationClient?.end()]);
});

test(
  "native push encrypts session devices and materializes exactly-once deliveries",
  { timeout: 60_000 },
  async () => {
    process.env.FCM_PROJECT_ID = "academy-test";
    process.env.FCM_SERVICE_ACCOUNT_CLIENT_EMAIL =
      "push@academy-test.iam.gserviceaccount.com";
    process.env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY = "unused-test-private-key";
    process.env.MOBILE_APP_BUNDLE_ID = "com.qacademy.mobile";
    const [{ postgresClient }, devices, delivery] = await Promise.all([
      import("../src/db/index"),
      import("../src/lib/push/native-devices"),
      import("../src/lib/push/native-delivery"),
    ]);
    applicationClient = postgresClient;
    const suffix = `${Date.now()}-${randomUUID()}`;
    let organizationId = "";
    let foreignOrganizationId = "";
    try {
      const organizations = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values
          (${`Native push ${suffix}`}, ${`native-push-${suffix}`}),
          (${`Native push foreign ${suffix}`}, ${`native-push-foreign-${suffix}`})
        returning id
      `;
      organizationId = organizations[0]!.id;
      foreignOrganizationId = organizations[1]!.id;
      const users = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${organizationId}, ${`native-${suffix}@example.test`}, 'unused', 'Native', 'Member', 'member'),
          (${foreignOrganizationId}, ${`foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', 'member')
        returning id
      `;
      const sessions = await sql<Array<{ id: string }>>`
        insert into user_sessions (organization_id, user_id, jti_hash, expires_at)
        values
          (${organizationId}, ${users[0]!.id}, ${createHash("sha256").update(`native-${suffix}`).digest("hex")}, now() + interval '1 day'),
          (${foreignOrganizationId}, ${users[1]!.id}, ${createHash("sha256").update(`foreign-${suffix}`).digest("hex")}, now() + interval '1 day')
        returning id
      `;
      const token = `fcm:${"A".repeat(140)}`;
      const created = await devices.upsertNativePushDevice({
        organizationId,
        userId: users[0]!.id,
        sessionId: sessions[0]!.id,
        device: {
          platform: "android",
          appId: "com.qacademy.mobile",
          token,
        },
      });
      const [stored] = await sql<
        Array<{ tokenHash: string; tokenEncrypted: unknown }>
      >`
        select token_hash as "tokenHash", token_encrypted as "tokenEncrypted"
        from native_push_devices where id = ${created.id}
      `;
      assert.equal(stored!.tokenHash, createHash("sha256").update(token).digest("hex"));
      assert.equal(JSON.stringify(stored!.tokenEncrypted).includes(token), false);
      await assert.rejects(
        devices.upsertNativePushDevice({
          organizationId: foreignOrganizationId,
          userId: users[1]!.id,
          sessionId: sessions[1]!.id,
          device: {
            platform: "android",
            appId: "com.qacademy.mobile",
            token,
          },
        }),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409,
      );

      const [reclaimSession] = await sql<Array<{ id: string }>>`
        insert into user_sessions (organization_id, user_id, jti_hash, expires_at)
        values (
          ${organizationId}, ${users[0]!.id},
          ${createHash("sha256").update(`reclaim-${suffix}`).digest("hex")},
          now() + interval '1 day'
        )
        returning id
      `;
      const reclaimToken = `fcm:${"R".repeat(140)}`;
      await devices.upsertNativePushDevice({
        organizationId,
        userId: users[0]!.id,
        sessionId: reclaimSession!.id,
        device: {
          platform: "android",
          appId: "com.qacademy.mobile",
          token: reclaimToken,
        },
      });
      await sql`
        update user_sessions set expires_at = now() - interval '1 minute'
        where id = ${reclaimSession!.id}
      `;
      const reclaimed = await devices.upsertNativePushDevice({
        organizationId: foreignOrganizationId,
        userId: users[1]!.id,
        sessionId: sessions[1]!.id,
        device: {
          platform: "android",
          appId: "com.qacademy.mobile",
          token: reclaimToken,
        },
      });
      const [reclaimedOwner] = await sql<
        Array<{ organization_id: string; user_id: string }>
      >`
        select organization_id, user_id from native_push_devices
        where id = ${reclaimed.id}
      `;
      assert.deepEqual(reclaimedOwner, {
        organization_id: foreignOrganizationId,
        user_id: users[1]!.id,
      });

      await sql`
        insert into user_notification_preferences (
          organization_id, user_id, category, email_enabled, push_enabled
        ) values (${organizationId}, ${users[0]!.id}, 'community', true, false)
      `;
      const [blockedNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, category)
        values (${users[0]!.id}, 'Community', 'Kein nativer Push.', 'community')
        returning id
      `;
      assert.equal(await delivery.materializeNativePushDeliveries(), 1);
      const [blockedDelivery] = await sql<
        Array<{ status: string; response_body: string | null }>
      >`
        select status, response_body from native_push_deliveries
        where notification_id = ${blockedNotification.id}
      `;
      assert.deepEqual(blockedDelivery, {
        status: "failed",
        response_body: "Durch Benachrichtigungseinstellungen unterdrueckt.",
      });

      await sql`
        update user_notification_preferences set push_enabled = true
        where organization_id = ${organizationId}
          and user_id = ${users[0]!.id} and category = 'community'
      `;
      const [queuedNotification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, category)
        values (${users[0]!.id}, 'Community queued', 'Opt-out vor Versand.', 'community')
        returning id
      `;
      assert.equal(await delivery.materializeNativePushDeliveries(), 1);
      const [queuedDelivery] = await sql<Array<{ id: string }>>`
        select id from native_push_deliveries
        where notification_id = ${queuedNotification.id} and device_id = ${created.id}
      `;
      const queuedClaimedAt = new Date();
      await sql`
        update native_push_deliveries
        set status = 'processing', claimed_at = ${queuedClaimedAt.toISOString()}::timestamptz,
            updated_at = ${queuedClaimedAt.toISOString()}::timestamptz
        where id = ${queuedDelivery.id}
      `;
      let suppressedSends = 0;
      let preferenceRaceHookCalls = 0;
      const suppressed = await delivery.deliverQueuedNativePush(
        { id: queuedDelivery.id, claimedAt: queuedClaimedAt },
        {
          beforeProviderRevalidation: async () => {
            preferenceRaceHookCalls += 1;
            await sql`
              update user_notification_preferences set push_enabled = false
              where organization_id = ${organizationId}
                and user_id = ${users[0]!.id} and category = 'community'
            `;
          },
          deliver: async () => {
            suppressedSends += 1;
            throw new Error("Preference-suppressed native push reached provider.");
          },
        },
      );
      assert.equal(preferenceRaceHookCalls, 1);
      assert.equal(suppressed?.status, "failed");
      assert.equal(suppressedSends, 0);

      const [notification] = await sql<Array<{ id: string }>>`
        insert into notifications (user_id, title, body, href)
        values (${users[0]!.id}, 'Neue Lektion', 'Eine Lektion ist verfuegbar.', '/academy/courses')
        returning id
      `;
      let sends = 0;
      const processed = await delivery.processNativePushQueue(10, {
        deliver: async (input) => {
          sends += 1;
          assert.equal(input.token, token);
          assert.equal(input.message.notificationId, notification!.id);
          return {
            status: 200,
            delivered: true,
            permanent: false,
            expired: false,
            detail: "test delivery",
          };
        },
      });
      assert.equal(processed.length, 1);
      assert.equal(sends, 1);
      await delivery.processNativePushQueue(10, {
        deliver: async () => {
          sends += 1;
          throw new Error("duplicate delivery");
        },
      });
      assert.equal(sends, 1);
      const [queue] = await sql<Array<{ status: string; attempt: number }>>`
        select status, attempt from native_push_deliveries
        where notification_id = ${notification!.id} and device_id = ${created.id}
      `;
      assert.deepEqual(queue, { status: "delivered", attempt: 1 });
    } finally {
      for (const tenantId of [organizationId, foreignOrganizationId].filter(Boolean)) {
        await sql`delete from organizations where id = ${tenantId}`;
      }
    }
  },
);
