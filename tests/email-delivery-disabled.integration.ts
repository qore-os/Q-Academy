import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test(
  "disabled email delivery fails closed without calling a provider",
  { timeout: 30_000 },
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: false });
    const originalFetch = globalThis.fetch;
    const originalRequired = process.env.EMAIL_DELIVERY_REQUIRED;
    const originalDeliveryUrl = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
    const originalDeliverySecret = process.env.EMAIL_DELIVERY_WEBHOOK_SECRET;
    const organizationId = randomUUID();
    const memberId = randomUUID();
    const deliveryId = randomUUID();
    const recipientEmail = `${memberId}@example.test`;
    const claimedAt = new Date();
    let providerCalls = 0;
    let applicationClient:
      | { end: (options?: { timeout?: number }) => Promise<void> }
      | undefined;

    try {
      process.env.EMAIL_DELIVERY_REQUIRED = "false";
      delete process.env.EMAIL_DELIVERY_WEBHOOK_URL;
      delete process.env.EMAIL_DELIVERY_WEBHOOK_SECRET;
      globalThis.fetch = (async () => {
        providerCalls += 1;
        throw new Error("A disabled delivery attempted a network call.");
      }) as typeof fetch;

      const [
        { deliverQueuedEmail },
        { encryptPayload },
        { postgresClient },
      ] = await Promise.all([
        import("../src/lib/email-delivery"),
        import("../src/lib/api/crypto"),
        import("../src/db/index"),
      ]);
      applicationClient = postgresClient;

      await sql`
        insert into organizations (id, name, slug)
        values (
          ${organizationId}, 'Disabled Mail Organization',
          ${`disabled-mail-${organizationId.slice(0, 8)}`}
        )
      `;
      await sql`
        insert into users (
          id, organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${memberId}, ${organizationId}, ${recipientEmail}, 'unused',
          'Mara', 'Member', 'member', 'invited'
        )
      `;
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${deliveryId}, ${organizationId}, ${memberId},
          'invitation.created', 'system', ${recipientEmail},
          ${sql.json(
            encryptPayload(
              JSON.stringify({
                link: "https://academy.example.test/invitations/token",
                locale: "de",
              }),
              `email-delivery:${deliveryId}`,
            ),
          )},
          'processing', ${claimedAt.toISOString()}::timestamptz
        )
      `;

      const result = await deliverQueuedEmail({ id: deliveryId, claimedAt });

      assert.equal(result?.status, "failed");
      assert.equal(result?.attempt, 1);
      assert.equal(
        result?.responseBody,
        "Die E-Mail-Zustellung ist nicht konfiguriert.",
      );
      assert.equal(providerCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalRequired === undefined) {
        delete process.env.EMAIL_DELIVERY_REQUIRED;
      } else {
        process.env.EMAIL_DELIVERY_REQUIRED = originalRequired;
      }
      if (originalDeliveryUrl === undefined) {
        delete process.env.EMAIL_DELIVERY_WEBHOOK_URL;
      } else {
        process.env.EMAIL_DELIVERY_WEBHOOK_URL = originalDeliveryUrl;
      }
      if (originalDeliverySecret === undefined) {
        delete process.env.EMAIL_DELIVERY_WEBHOOK_SECRET;
      } else {
        process.env.EMAIL_DELIVERY_WEBHOOK_SECRET = originalDeliverySecret;
      }
      await sql`delete from organizations where id = ${organizationId}`;
      await applicationClient?.end();
      await sql.end();
    }
  },
);
