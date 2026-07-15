import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import postgres from "postgres";

import { db, postgresClient } from "../src/db/index";
import {
  getEmailTemplateSettings,
  preserveEmailTemplatesAcrossDefaultLocaleChange,
  queueEmailTemplateTest,
  renderTenantEmailContent,
  updateEmailTemplateSettings,
} from "../src/lib/email-center";
import { DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE } from "../src/lib/email-center-model";
import { decryptPayload } from "../src/lib/api/crypto";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

async function emailPersonalizationSchemaReady() {
  const [row] = await sql<Array<{ ready: boolean }>>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'custom_field_definitions'
        and column_name = 'personalization_enabled'
    ) as ready
  `;
  return row?.ready === true;
}

test("tenant email templates persist and render independently per locale", async (t) => {
  if (!(await emailPersonalizationSchemaReady())) {
    t.skip("Pending member-personalization schema has not been migrated yet.");
    return;
  }
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const marker = `ES-${randomUUID()}`;
  try {
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (${organizationId}, 'Localized mail tenant', ${`mail-${organizationId.slice(0, 8)}`}, 'de')
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${actorId}, ${organizationId}, ${`${actorId}@example.test`}, 'unused',
        'Mail', 'Owner', 'owner', 'active'
      )
    `;

    const spanish = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE.es);
    spanish.templates["invitation.created"].subject =
      `${marker} {{platformName}}`;
    const saved = await db.transaction((tx) =>
      updateEmailTemplateSettings(tx, {
        organizationId,
        actorUserId: actorId,
        source: "admin_ui",
        locale: "es",
        settings: spanish,
      }),
    );
    assert.equal(saved.changed, true);

    const [stored] = await sql<Array<{ key: string }>>`
      select key from platform_settings
      where organization_id = ${organizationId}
        and key = 'email_templates.es'
    `;
    assert.equal(stored?.key, "email_templates.es");

    const rendered = await renderTenantEmailContent(db, {
      organizationId,
      event: "invitation.created",
      locale: "es",
      variables: {
        firstName: "Mara",
        invitationUrl: "https://academy.example.test/invitations/example",
        expiresIn: "7 días",
      },
    });
    assert.match(rendered.subject, new RegExp(`^${marker}`));

    const [spanishView, englishView] = await Promise.all([
      getEmailTemplateSettings(organizationId, "es"),
      getEmailTemplateSettings(organizationId, "en"),
    ]);
    assert.equal(
      spanishView.templates["invitation.created"].subject,
      `${marker} {{platformName}}`,
    );
    assert.equal(
      englishView.templates["invitation.created"].subject,
      DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE.en.templates[
        "invitation.created"
      ].subject,
    );
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});

test("legacy templates retain their locale across tenant-default changes and test deliveries snapshot locale", async (t) => {
  if (!(await emailPersonalizationSchemaReady())) {
    t.skip("Pending member-personalization schema has not been migrated yet.");
    return;
  }
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const actorEmail = `${actorId}@example.test`;
  const marker = `LEGACY-${randomUUID()}`;
  try {
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (${organizationId}, 'Legacy mail tenant', ${`legacy-mail-${organizationId.slice(0, 8)}`}, 'de')
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${actorId}, ${organizationId}, ${actorEmail}, 'unused',
        'Mail', 'Owner', 'owner', 'active'
      )
    `;
    const legacy = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE.de);
    legacy.templates["feedback.reply"].subject = `${marker} {{defaultSubject}}`;
    await sql`
      insert into platform_settings (organization_id, key, value)
      values (${organizationId}, 'email_templates', ${sql.json(legacy)})
    `;

    const before = await getEmailTemplateSettings(organizationId, "de");
    assert.equal(before.source, "legacy");
    assert.match(before.templates["feedback.reply"].subject, new RegExp(marker));

    await db.transaction((tx) =>
      preserveEmailTemplatesAcrossDefaultLocaleChange(tx, {
        organizationId,
        previousLocale: "de",
        nextLocale: "en",
      }),
    );
    await sql`
      update organizations
      set default_locale = 'en'
      where id = ${organizationId}
    `;

    const [german, english] = await Promise.all([
      getEmailTemplateSettings(organizationId, "de"),
      getEmailTemplateSettings(organizationId, "en"),
    ]);
    assert.equal(german.source, "localized");
    assert.match(german.templates["feedback.reply"].subject, new RegExp(marker));
    assert.equal(english.source, "legacy");
    assert.deepEqual(
      english.templates,
      DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE.en.templates,
    );

    const french = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE.fr);
    french.templates["password.reset"].subject = `FR-${marker} {{platformName}}`;
    await db.transaction((tx) =>
      updateEmailTemplateSettings(tx, {
        organizationId,
        actorUserId: actorId,
        source: "api",
        locale: "fr",
        settings: french,
      }),
    );
    const queued = await db.transaction((tx) =>
      queueEmailTemplateTest(tx, {
        organizationId,
        actorUserId: actorId,
        event: "password.reset",
        requestId: randomUUID(),
        source: "api",
        locale: "fr",
      }),
    );
    assert.equal(queued.locale, "fr");
    const [delivery] = await sql<Array<{ payload: string }>>`
      select payload from email_deliveries where id = ${queued.delivery.id}
    `;
    assert.ok(delivery);
    const snapshot = JSON.parse(
      decryptPayload(
        delivery.payload,
        `email-delivery:${queued.delivery.id}`,
      ),
    ) as { locale: string; subject: string };
    assert.equal(snapshot.locale, "fr");
    assert.match(snapshot.subject, new RegExp(`^FR-${marker}`));
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
