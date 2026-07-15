import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

test(
  "notification preferences suppress tenant-bound mail before payload or network access",
  { timeout: 30_000 },
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: false });
    const suffix = randomUUID();
    const deliveryId = randomUUID();
    let organizationId = "";
    let foreignOrganizationId = "";
    const originalFetch = globalThis.fetch;
    const originalDeliveryRequired = process.env.EMAIL_DELIVERY_REQUIRED;
    const originalDeliveryUrl = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
    let networkCalls = 0;
    try {
      process.env.EMAIL_DELIVERY_REQUIRED = "true";
      process.env.EMAIL_DELIVERY_WEBHOOK_URL =
        "https://mail-provider.example.test/deliver";
      const organizations = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values
          ('Preference integration', ${`preference-${suffix}`}),
          ('Preference foreign', ${`preference-foreign-${suffix}`})
        returning id
      `;
      organizationId = organizations[0]!.id;
      foreignOrganizationId = organizations[1]!.id;
      const [user] = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status, phone
        ) values (
          ${organizationId}, ${`preference-${suffix}@example.test`}, 'unused',
          'Preference', 'Member', 'member', 'active', '+491701234567'
        ) returning id
      `;
      await sql`
        insert into user_notification_preferences (
          organization_id, user_id, category, email_enabled, push_enabled
        ) values (${organizationId}, ${user.id}, 'feedback', false, true)
      `;
      await assert.rejects(
        sql`
          insert into user_notification_preferences (
            organization_id, user_id, category, email_enabled, push_enabled
          ) values (${foreignOrganizationId}, ${user.id}, 'feedback', false, false)
        `,
        (error) => databaseErrorCode(error) === "23503",
      );
      await assert.rejects(
        sql`
          update users set phone = '0170-1234567'
          where id = ${user.id} and organization_id = ${organizationId}
        `,
        (error) => databaseErrorCode(error) === "23514",
      );

      const claimedAt = new Date();
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${deliveryId}, ${organizationId}, ${user.id}, 'feedback.reply',
          'feedback', ${`preference-${suffix}@example.test`},
          '{"intentionally":"not-decryptable"}'::jsonb, 'processing',
          ${claimedAt.toISOString()}::timestamptz
        )
      `;
      globalThis.fetch = (async () => {
        networkCalls += 1;
        throw new Error("Preference-suppressed mail reached the network.");
      }) as typeof fetch;

      const [
        { deliverQueuedEmail },
        { postgresClient },
        { encryptPayload },
      ] = await Promise.all([
        import("../src/lib/email-delivery"),
        import("../src/db/index"),
        import("../src/lib/api/crypto"),
      ]);
      const result = await deliverQueuedEmail({ id: deliveryId, claimedAt });
      assert.equal(result?.status, "failed");
      assert.equal(result?.attempt, 1);
      assert.equal(
        result?.responseBody,
        "Durch Benachrichtigungseinstellungen unterdrueckt.",
      );
      assert.equal(networkCalls, 0);

      await sql`
        update user_notification_preferences set email_enabled = true
        where organization_id = ${organizationId}
          and user_id = ${user.id} and category = 'feedback'
      `;
      const raceDeliveryId = randomUUID();
      const raceClaimedAt = new Date(Date.now() + 1);
      const encryptedPayload = encryptPayload(
        JSON.stringify({
          subject: "Preference race",
          message: "This payload must not reach the mail provider.",
          locale: "de",
        }),
        `email-delivery:${raceDeliveryId}`,
      );
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${raceDeliveryId}, ${organizationId}, ${user.id}, 'feedback.reply',
          'feedback', ${`preference-${suffix}@example.test`},
          ${sql.json(encryptedPayload)}, 'processing',
          ${raceClaimedAt.toISOString()}::timestamptz
        )
      `;
      let raceHookCalls = 0;
      const raceResult = await deliverQueuedEmail(
        { id: raceDeliveryId, claimedAt: raceClaimedAt },
        {
          beforeProviderRevalidation: async () => {
            raceHookCalls += 1;
            await sql`
              update user_notification_preferences set email_enabled = false
              where organization_id = ${organizationId}
                and user_id = ${user.id} and category = 'feedback'
            `;
          },
        },
      );
      assert.equal(raceHookCalls, 1);
      assert.equal(raceResult?.status, "failed");
      assert.equal(
        raceResult?.responseBody,
        "Durch Benachrichtigungseinstellungen unterdrueckt.",
      );
      assert.equal(networkCalls, 0);
      await postgresClient.end();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalDeliveryRequired === undefined) {
        delete process.env.EMAIL_DELIVERY_REQUIRED;
      } else {
        process.env.EMAIL_DELIVERY_REQUIRED = originalDeliveryRequired;
      }
      if (originalDeliveryUrl === undefined) {
        delete process.env.EMAIL_DELIVERY_WEBHOOK_URL;
      } else {
        process.env.EMAIL_DELIVERY_WEBHOOK_URL = originalDeliveryUrl;
      }
      if (organizationId) {
        await sql`delete from organizations where id = ${organizationId}`;
      }
      if (foreignOrganizationId) {
        await sql`delete from organizations where id = ${foreignOrganizationId}`;
      }
      await sql.end();
    }
  },
);
