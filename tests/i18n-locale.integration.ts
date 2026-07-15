import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import postgres from "postgres";
import { db, postgresClient } from "../src/db/index";
import {
  getOrganizationDefaultLocale,
  resolveRecipientLocale,
  resolveUserLocale,
} from "../src/lib/i18n/server";
import { deliverAuthLink } from "../src/lib/auth-tokens";
import { decryptPayload } from "../src/lib/api/crypto";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("tenant default and account preference resolve without cross-tenant fallback", async () => {
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const inheritedUserId = randomUUID();
  const preferredUserId = randomUUID();
  const foreignUserId = randomUUID();
  const invitedUserId = randomUUID();
  try {
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values
        (${organizationId}, 'Locale tenant', ${`locale-${organizationId.slice(0, 8)}`}, 'en'),
        (${foreignOrganizationId}, 'Foreign locale tenant', ${`locale-${foreignOrganizationId.slice(0, 8)}`}, 'fr')
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
        (${inheritedUserId}, ${organizationId}, ${`${inheritedUserId}@example.test`}, 'unused', 'Inherited', 'Locale', 'member', 'active', null),
        (${preferredUserId}, ${organizationId}, ${`${preferredUserId}@example.test`}, 'unused', 'Preferred', 'Locale', 'member', 'active', 'it'),
        (${invitedUserId}, ${organizationId}, ${`${invitedUserId}@example.test`}, 'unused', 'Invited', 'Locale', 'member', 'invited', 'es'),
        (${foreignUserId}, ${foreignOrganizationId}, ${`${foreignUserId}@example.test`}, 'unused', 'Foreign', 'Locale', 'member', 'active', 'es')
    `;

    assert.equal(await getOrganizationDefaultLocale(organizationId), "en");
    assert.equal(
      await resolveUserLocale({
        organizationId,
        preferredLocale: null,
      }),
      "en",
    );
    assert.equal(
      await resolveRecipientLocale(db, {
        organizationId,
        userId: preferredUserId,
      }),
      "it",
    );
    await assert.rejects(
      resolveRecipientLocale(db, {
        organizationId,
        userId: foreignUserId,
      }),
      /not available in the requested tenant/,
    );

    const queued = await db.transaction((tx) =>
      deliverAuthLink(
        {
          organizationId,
          userId: invitedUserId,
          event: "invitation.created",
          email: `${invitedUserId}@example.test`,
          link: "https://academy.example.test/invitations/immutable-locale",
        },
        tx,
      ),
    );
    const [delivery] = await sql<Array<{ payload: unknown }>>`
      select payload from email_deliveries where id = ${queued.id}
    `;
    const source = JSON.parse(
      decryptPayload(delivery!.payload, `email-delivery:${queued.id}`),
    ) as { locale: string; link: string };
    assert.equal(source.locale, "es");
    await sql`update users set preferred_locale = 'fr' where id = ${invitedUserId}`;
    const unchangedSource = JSON.parse(
      decryptPayload(delivery!.payload, `email-delivery:${queued.id}`),
    ) as { locale: string };
    assert.equal(unchangedSource.locale, "es");

    await sql`update organizations set default_locale = 'fr' where id = ${organizationId}`;
    assert.equal(
      await resolveRecipientLocale(db, {
        organizationId,
        userId: inheritedUserId,
      }),
      "fr",
    );
  } finally {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
  }
});
