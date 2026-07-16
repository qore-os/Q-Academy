import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { testEnvironmentValue as environmentValue } from "./helpers/test-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("job dispatcher previews and deletes only expired operational data", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted cleanup flow");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const ids = {
    expiredSession: randomUUID(),
    activeSession: randomUUID(),
    expiredInvitation: randomUUID(),
    activeInvitation: randomUUID(),
    expiredToken: randomUUID(),
    activeToken: randomUUID(),
    expiredIdempotency: randomUUID(),
    activeIdempotency: randomUUID(),
    oldEmail: randomUUID(),
    recentEmail: randomUUID(),
    activeEmail: randomUUID(),
    webhook: randomUUID(),
    oldWebhook: randomUUID(),
    heldWebhook: randomUUID(),
    recentWebhook: randomUUID(),
    activeWebhook: randomUUID(),
    webhookHold: randomUUID(),
    activity: randomUUID(),
    audit: randomUUID(),
    auditRequest: randomUUID(),
    expiredBoost: randomUUID(),
    activeBoost: randomUUID(),
    expiredBoostAuthor: randomUUID(),
    activeBoostAuthor: randomUUID(),
    heldBoost: randomUUID(),
    heldBoostAuthor: randomUUID(),
    boostHold: randomUUID(),
  };
  const suffix = randomUUID();
  const expiredRateHash = sha256(`expired-rate-${suffix}`);
  const activeRateHash = sha256(`active-rate-${suffix}`);
  const oldDate = new Date("2000-01-01T00:00:00.000Z");
  const futureDate = new Date("2100-01-01T00:00:00.000Z");

  try {
    const [fixture] = await sql<
      Array<{ organization_id: string; user_id: string; api_key_id: string }>
    >`
      select
        organizations.id as organization_id,
        users.id as user_id,
        api_keys.id as api_key_id
      from organizations
      join users on users.organization_id = organizations.id
      join api_keys on api_keys.organization_id = organizations.id
      where organizations.slug = 'q-academy'
        and users.email = 'admin@q-academy.de'
      order by api_keys.created_at asc
      limit 1
    `;
    if (!fixture) throw new Error("Default cleanup test fixture is missing.");

    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name
      ) values
        (${ids.expiredBoostAuthor}, ${fixture.organization_id},
          ${`expired-boost-${suffix}@example.test`}, 'unusable', 'Expired', 'Boost'),
        (${ids.activeBoostAuthor}, ${fixture.organization_id},
          ${`active-boost-${suffix}@example.test`}, 'unusable', 'Active', 'Boost'),
        (${ids.heldBoostAuthor}, ${fixture.organization_id},
          ${`held-boost-${suffix}@example.test`}, 'unusable', 'Held', 'Boost')
    `;
    await sql`
      insert into community_author_boosts (
        id, organization_id, author_id, strength, starts_at, ends_at, reason,
        created_by_id, created_at, updated_at
      ) values
        (${ids.expiredBoost}, ${fixture.organization_id},
          ${ids.expiredBoostAuthor}, 'light', '1999-11-01', '2000-01-01',
          'Expired cleanup fixture', ${fixture.user_id}, ${oldDate}, ${oldDate}),
        (${ids.activeBoost}, ${fixture.organization_id},
          ${ids.activeBoostAuthor}, 'medium', now(), now() + interval '30 days',
          'Active cleanup fixture', ${fixture.user_id}, now(), now()),
        (${ids.heldBoost}, ${fixture.organization_id},
          ${ids.heldBoostAuthor}, 'high', '1999-11-01', '2000-01-01',
          'Held cleanup fixture', ${fixture.user_id}, ${oldDate}, ${oldDate})
    `;
    await sql`
      insert into privacy_legal_holds (
        id, organization_id, subject_user_id, subject_reference, scope,
        reference, reason, legal_basis, created_by_id, starts_at,
        created_at, updated_at
      ) values (
        ${ids.boostHold}, ${fixture.organization_id}, ${ids.heldBoostAuthor},
        ${sha256(`held-boost-subject-${suffix}`)}, 'community',
        ${`BOOST-HOLD-${suffix}`}, 'Active community boost evidence hold',
        'Art. 6 Abs. 1 lit. c DSGVO', ${fixture.user_id}, ${oldDate},
        ${oldDate}, ${oldDate}
      )
    `;
    await sql`
      insert into privacy_legal_holds (
        id, organization_id, subject_user_id, subject_reference, scope,
        reference, reason, legal_basis, created_by_id, starts_at,
        created_at, updated_at
      ) values (
        ${ids.webhookHold}, ${fixture.organization_id}, ${fixture.user_id},
        ${sha256(`held-webhook-subject-${suffix}`)}, 'integrations',
        ${`WEBHOOK-HOLD-${suffix}`}, 'Active webhook evidence hold',
        'Art. 6 Abs. 1 lit. c DSGVO', ${fixture.user_id}, ${oldDate},
        ${oldDate}, ${oldDate}
      )
    `;

    await sql`
      insert into user_sessions (
        id, organization_id, user_id, jti_hash, expires_at, created_at
      ) values
        (${ids.expiredSession}, ${fixture.organization_id}, ${fixture.user_id},
          ${sha256(`expired-session-${suffix}`)}, ${oldDate}, ${oldDate}),
        (${ids.activeSession}, ${fixture.organization_id}, ${fixture.user_id},
          ${sha256(`active-session-${suffix}`)}, ${futureDate}, now())
    `;
    await sql`
      insert into invitations (
        id, organization_id, user_id, email, token_hash, expires_at, created_at
      ) values
        (${ids.expiredInvitation}, ${fixture.organization_id}, ${fixture.user_id},
          ${`expired-${suffix}@example.test`},
          ${sha256(`expired-invitation-${suffix}`)}, ${oldDate}, ${oldDate}),
        (${ids.activeInvitation}, ${fixture.organization_id}, ${fixture.user_id},
          ${`active-${suffix}@example.test`},
          ${sha256(`active-invitation-${suffix}`)}, ${futureDate}, now())
    `;
    await sql`
      insert into password_reset_tokens (
        id, user_id, token_hash, expires_at, created_at
      ) values
        (${ids.expiredToken}, ${fixture.user_id},
          ${sha256(`expired-token-${suffix}`)}, ${oldDate}, ${oldDate}),
        (${ids.activeToken}, ${fixture.user_id},
          ${sha256(`active-token-${suffix}`)}, ${futureDate}, now())
    `;
    await sql`
      insert into auth_rate_limits (action, key_hash, attempts, reset_at, updated_at)
      values
        ('login', ${expiredRateHash}, 1, ${oldDate}, ${oldDate}),
        ('login', ${activeRateHash}, 1, ${futureDate}, now())
    `;
    await sql`
      insert into api_idempotency_keys (
        id, organization_id, api_key_id, key, method, path, request_hash,
        status, claim_token, expires_at, created_at
      ) values
        (${ids.expiredIdempotency}, ${fixture.organization_id},
          ${fixture.api_key_id}, ${`expired-${suffix}`}, 'POST', '/cleanup-test',
          ${sha256(`expired-request-${suffix}`)}, 'processing', ${randomUUID()},
          ${oldDate}, ${oldDate}),
        (${ids.activeIdempotency}, ${fixture.organization_id},
          ${fixture.api_key_id}, ${`active-${suffix}`}, 'POST', '/cleanup-test',
          ${sha256(`active-request-${suffix}`)}, 'processing', ${randomUUID()},
          ${futureDate}, now())
    `;
    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload, status,
        attempt, claimed_at, delivered_at, created_at, updated_at
      ) values
        (${ids.oldEmail}, ${fixture.organization_id}, ${fixture.user_id},
          'cleanup.test', ${`old-${suffix}@example.test`},
          ${sql.json({ fixture: suffix })}, 'delivered', 1, null, ${oldDate},
          ${oldDate}, ${oldDate}),
        (${ids.recentEmail}, ${fixture.organization_id}, ${fixture.user_id},
          'cleanup.test', ${`recent-${suffix}@example.test`},
          ${sql.json({ fixture: suffix })}, 'failed', 8, null, null, now(), now()),
        (${ids.activeEmail}, ${fixture.organization_id}, ${fixture.user_id},
          'cleanup.test', ${`active-${suffix}@example.test`},
          ${sql.json({ fixture: suffix })}, 'processing', 1, now(), null,
          ${oldDate}, ${oldDate})
    `;
    await sql`
      insert into webhooks (
        id, organization_id, name, url, signing_secret_encrypted, events,
        active, created_at, updated_at
      ) values (
        ${ids.webhook}, ${fixture.organization_id}, ${`Cleanup ${suffix}`},
        'https://example.com/cleanup', 'unused-cleanup-secret',
        array['cleanup.test'], false, ${oldDate}, ${oldDate}
      )
    `;
    await sql`
      insert into webhook_deliveries (
        id, organization_id, webhook_id, event, payload, status, attempt,
        claimed_at, claim_token, delivered_at, created_at, updated_at
      ) values
        (${ids.oldWebhook}, ${fixture.organization_id}, ${ids.webhook},
          'cleanup.test', ${sql.json({ fixture: suffix })}, 'failed', 6, null, null,
          null, ${oldDate}, ${oldDate}),
        (${ids.heldWebhook}, ${fixture.organization_id}, ${ids.webhook},
          'cleanup.test', ${sql.json({ data: { userId: fixture.user_id } })},
          'failed', 6, null, null, null, ${oldDate}, ${oldDate}),
        (${ids.recentWebhook}, ${fixture.organization_id}, ${ids.webhook},
          'cleanup.test', ${sql.json({ fixture: suffix })}, 'delivered', 1, null, null,
          now(), now(), now()),
        (${ids.activeWebhook}, ${fixture.organization_id}, ${ids.webhook},
          'cleanup.test', ${sql.json({ fixture: suffix })}, 'processing', 1,
          now(), ${randomUUID()}, null, ${oldDate}, ${oldDate})
    `;
    await sql`
      insert into webhook_delivery_attempts (
        organization_id, delivery_id, webhook_id, replay_generation,
        attempt, outcome, response_status, failure_kind,
        response_body_redacted, duration_ms, started_at, completed_at
      ) values
        (${fixture.organization_id}, ${ids.oldWebhook}, ${ids.webhook}, 0,
          6, 'failed', 500, 'http', true, 20,
          ${oldDate}, ${oldDate}),
        (${fixture.organization_id}, ${ids.heldWebhook}, ${ids.webhook}, 0,
          6, 'failed', 500, 'http', true, 20,
          ${oldDate}, ${oldDate}),
        (${fixture.organization_id}, ${ids.recentWebhook}, ${ids.webhook}, 0,
          1, 'delivered', 204, null, false, 10,
          now() - interval '10 milliseconds', now())
    `;
    await sql`
      insert into activity_events (
        id, organization_id, user_id, type, entity_type, entity_id, metadata,
        created_at
      ) values (
        ${ids.activity}, ${fixture.organization_id}, ${fixture.user_id},
        'cleanup.test', 'fixture', ${ids.activity},
        ${sql.json({ fixture: suffix })}, ${oldDate}
      )
    `;
    await sql`
      insert into api_audit_logs (
        id, organization_id, actor_user_id, api_key_id, request_id, method,
        path, action, resource_type, resource_id, response_status, duration_ms,
        metadata, created_at
      ) values (
        ${ids.audit}, ${fixture.organization_id}, ${fixture.user_id},
        ${fixture.api_key_id}, ${ids.auditRequest}, 'POST', '/cleanup-test',
        'cleanup.test', 'fixture', ${suffix}, 200, 1,
        ${sql.json({ fixture: suffix })}, ${oldDate}
      )
    `;

    const cronSecret = environmentValue("CRON_SECRET");
    const headers = cronSecret
      ? { Authorization: `Bearer ${cronSecret}` }
      : undefined;
    const queueOnly = await request.post(
      "/api/internal/jobs/dispatch?limit=1",
      { headers },
    );
    expect(queueOnly.status()).toBe(200);
    await expect(queueOnly.json()).resolves.toMatchObject({
      data: { cleanup: { mode: "skipped" } },
    });

    const preview = await request.post(
      "/api/internal/jobs/dispatch?cleanup=dry-run&cleanupLimit=500",
      { headers },
    );
    expect(preview.status()).toBe(200);
    const previewBody = (await preview.json()) as {
      data: {
        processed: number;
        cleanup: {
          mode: string;
          counts: Record<string, number>;
          retentionDays: Record<string, number>;
        };
      };
    };
    expect(previewBody.data.processed).toBe(0);
    expect(previewBody.data.cleanup).toMatchObject({
      mode: "dry-run",
      retentionDays: {
        emailDeliveries: 90,
        webhookDeliveries: 90,
        communityAuthorBoosts: 90,
      },
    });
    for (const category of [
      "expiredSessions",
      "expiredInvitations",
      "expiredPasswordResetTokens",
      "expiredRateLimits",
      "expiredIdempotencyKeys",
      "oldEmailDeliveries",
      "oldWebhookDeliveries",
      "expiredCommunityAuthorBoosts",
    ]) {
      expect(
        previewBody.data.cleanup.counts[category],
        `expected cleanup preview for ${category}`,
      ).toBeGreaterThanOrEqual(1);
    }
    const [afterPreview] = await sql<Array<{ present: number }>>`
      select count(*)::int as present
      from user_sessions
      where id = ${ids.expiredSession}
    `;
    expect(afterPreview.present).toBe(1);

    const cleaned = await request.post(
      "/api/internal/jobs/dispatch?limit=1&cleanup=run&cleanupLimit=500",
      { headers },
    );
    expect(cleaned.status()).toBe(200);
    const cleanedBody = (await cleaned.json()) as {
      data: { cleanup: { mode: string; counts: Record<string, number> } };
    };
    expect(cleanedBody.data.cleanup.mode).toBe("delete");

    const [remaining] = await sql<
      Array<{
        expired_sessions: number;
        active_sessions: number;
        expired_invitations: number;
        active_invitations: number;
        expired_tokens: number;
        active_tokens: number;
        expired_rates: number;
        active_rates: number;
        expired_idempotency: number;
        active_idempotency: number;
        old_emails: number;
        retained_emails: number;
        old_webhooks: number;
        retained_webhooks: number;
        old_webhook_attempts: number;
        retained_webhook_attempts: number;
        activity_events: number;
        audit_logs: number;
        expired_boosts: number;
        active_boosts: number;
        held_boosts: number;
      }>
    >`
      select
        (select count(*)::int from user_sessions where id = ${ids.expiredSession}) as expired_sessions,
        (select count(*)::int from user_sessions where id = ${ids.activeSession}) as active_sessions,
        (select count(*)::int from invitations where id = ${ids.expiredInvitation}) as expired_invitations,
        (select count(*)::int from invitations where id = ${ids.activeInvitation}) as active_invitations,
        (select count(*)::int from password_reset_tokens where id = ${ids.expiredToken}) as expired_tokens,
        (select count(*)::int from password_reset_tokens where id = ${ids.activeToken}) as active_tokens,
        (select count(*)::int from auth_rate_limits where key_hash = ${expiredRateHash}) as expired_rates,
        (select count(*)::int from auth_rate_limits where key_hash = ${activeRateHash}) as active_rates,
        (select count(*)::int from api_idempotency_keys where id = ${ids.expiredIdempotency}) as expired_idempotency,
        (select count(*)::int from api_idempotency_keys where id = ${ids.activeIdempotency}) as active_idempotency,
        (select count(*)::int from email_deliveries where id = ${ids.oldEmail}) as old_emails,
        (select count(*)::int from email_deliveries where id in (${ids.recentEmail}, ${ids.activeEmail})) as retained_emails,
        (select count(*)::int from webhook_deliveries where id = ${ids.oldWebhook}) as old_webhooks,
        (select count(*)::int from webhook_deliveries where id in (${ids.heldWebhook}, ${ids.recentWebhook}, ${ids.activeWebhook})) as retained_webhooks,
        (select count(*)::int from webhook_delivery_attempts where delivery_id = ${ids.oldWebhook}) as old_webhook_attempts,
        (select count(*)::int from webhook_delivery_attempts where delivery_id in (${ids.heldWebhook}, ${ids.recentWebhook})) as retained_webhook_attempts,
        (select count(*)::int from activity_events where id = ${ids.activity}) as activity_events,
        (select count(*)::int from api_audit_logs where id = ${ids.audit}) as audit_logs,
        (select count(*)::int from community_author_boosts where id = ${ids.expiredBoost}) as expired_boosts,
        (select count(*)::int from community_author_boosts where id = ${ids.activeBoost}) as active_boosts,
        (select count(*)::int from community_author_boosts where id = ${ids.heldBoost}) as held_boosts
    `;
    expect(remaining).toEqual({
      expired_sessions: 0,
      active_sessions: 1,
      expired_invitations: 0,
      active_invitations: 1,
      expired_tokens: 0,
      active_tokens: 1,
      expired_rates: 0,
      active_rates: 1,
      expired_idempotency: 0,
      active_idempotency: 1,
      old_emails: 0,
      retained_emails: 2,
      old_webhooks: 0,
      retained_webhooks: 3,
      old_webhook_attempts: 0,
      retained_webhook_attempts: 2,
      activity_events: 1,
      audit_logs: 1,
      expired_boosts: 0,
      active_boosts: 1,
      held_boosts: 1,
    });
  } finally {
    await sql`
      delete from privacy_legal_holds
      where id in (${ids.boostHold}, ${ids.webhookHold})
    `;
    await sql`
      delete from community_author_boosts
      where id in (${ids.expiredBoost}, ${ids.activeBoost}, ${ids.heldBoost})
    `;
    await sql`
      delete from users
      where id in (${ids.expiredBoostAuthor}, ${ids.activeBoostAuthor}, ${ids.heldBoostAuthor})
    `;
    await sql`delete from api_audit_logs where id = ${ids.audit}`;
    await sql`delete from activity_events where id = ${ids.activity}`;
    await sql`
      delete from webhook_deliveries
      where id in (${ids.oldWebhook}, ${ids.heldWebhook}, ${ids.recentWebhook}, ${ids.activeWebhook})
    `;
    await sql`delete from webhooks where id = ${ids.webhook}`;
    await sql`
      delete from email_deliveries
      where id in (${ids.oldEmail}, ${ids.recentEmail}, ${ids.activeEmail})
    `;
    await sql`
      delete from api_idempotency_keys
      where id in (${ids.expiredIdempotency}, ${ids.activeIdempotency})
    `;
    await sql`
      delete from auth_rate_limits
      where key_hash in (${expiredRateHash}, ${activeRateHash})
    `;
    await sql`
      delete from password_reset_tokens
      where id in (${ids.expiredToken}, ${ids.activeToken})
    `;
    await sql`
      delete from invitations
      where id in (${ids.expiredInvitation}, ${ids.activeInvitation})
    `;
    await sql`
      delete from user_sessions
      where id in (${ids.expiredSession}, ${ids.activeSession})
    `;
    await sql.end();
  }
});

test("email cleanup honors communication holds and referenced deliveries", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted cleanup hold flow");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const ids = {
    heldEmail: randomUUID(),
    referencedEmail: randomUUID(),
    deletableEmail: randomUUID(),
    hold: randomUUID(),
    subscription: randomUUID(),
    notification: randomUUID(),
    heldSession: randomUUID(),
    deletableSession: randomUUID(),
    authenticationHold: randomUUID(),
  };
  const suffix = randomUUID();
  const oldDate = new Date("2000-01-01T00:00:00.000Z");
  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        user_id: string;
        unheld_user_id: string;
        course_id: string;
        lesson_id: string;
        version_id: string;
      }>
    >`
      select organizations.id as organization_id, users.id as user_id,
             (
               select candidate.id from users candidate
               where candidate.organization_id = organizations.id
                 and candidate.id <> users.id
               order by candidate.created_at asc
               limit 1
             ) as unheld_user_id,
             courses.id as course_id, lessons.id as lesson_id,
             course_versions.id as version_id
      from organizations
      join users on users.organization_id = organizations.id
      join courses on courses.organization_id = organizations.id
      join course_versions
        on course_versions.organization_id = organizations.id
       and course_versions.course_id = courses.id
      join lessons on lessons.organization_id = organizations.id
      where organizations.slug = 'q-academy'
        and users.email = 'admin@q-academy.de'
      order by course_versions.version desc
      limit 1
    `;
    if (!fixture) throw new Error("Cleanup hold fixture is missing.");

    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload,
        status, attempt, created_at, updated_at
      ) values
        (${ids.heldEmail}, ${fixture.organization_id}, ${fixture.user_id},
          'cleanup.held', ${`held-${suffix}@example.test`},
          ${sql.json({ fixture: suffix })}, 'failed', 8, ${oldDate}, ${oldDate}),
        (${ids.referencedEmail}, ${fixture.organization_id}, ${fixture.user_id},
          'cleanup.referenced', ${`referenced-${suffix}@example.test`},
          ${sql.json({ fixture: suffix })}, 'delivered', 1, ${oldDate}, ${oldDate}),
        (${ids.deletableEmail}, ${fixture.organization_id}, ${fixture.unheld_user_id},
          'cleanup.deletable', ${`deletable-${suffix}@example.test`},
          ${sql.json({ fixture: suffix })}, 'failed', 8, ${oldDate}, ${oldDate})
    `;
    await sql`
      insert into privacy_legal_holds (
        id, organization_id, subject_user_id, subject_reference, scope,
        reference, reason, legal_basis, created_by_id, starts_at,
        created_at, updated_at
      ) values (
        ${ids.hold}, ${fixture.organization_id}, ${fixture.user_id},
        ${sha256(`held-subject-${suffix}`)}, 'communications',
        ${`MAIL-HOLD-${suffix}`}, 'Active communication evidence hold',
        'Art. 6 Abs. 1 lit. c DSGVO', ${fixture.user_id}, ${oldDate},
        ${oldDate}, ${oldDate}
      )
    `;
    await sql`
      insert into privacy_legal_holds (
        id, organization_id, subject_user_id, subject_reference, scope,
        reference, reason, legal_basis, created_by_id, starts_at,
        created_at, updated_at
      ) values (
        ${ids.authenticationHold}, ${fixture.organization_id}, ${fixture.user_id},
        ${sha256(`held-auth-subject-${suffix}`)}, 'authentication',
        ${`AUTH-HOLD-${suffix}`}, 'Active authentication evidence hold',
        'Art. 6 Abs. 1 lit. c DSGVO', ${fixture.user_id}, ${oldDate},
        ${oldDate}, ${oldDate}
      )
    `;
    await sql`
      insert into user_sessions (
        id, organization_id, user_id, jti_hash, expires_at, created_at
      ) values
        (${ids.heldSession}, ${fixture.organization_id}, ${fixture.user_id},
          ${sha256(`held-session-${suffix}`)}, ${oldDate}, ${oldDate}),
        (${ids.deletableSession}, ${fixture.organization_id}, ${fixture.unheld_user_id},
          ${sha256(`deletable-session-${suffix}`)}, ${oldDate}, ${oldDate})
    `;
    await sql`
      insert into notifications (id, user_id, title, body, type, created_at)
      values (
        ${ids.notification}, ${fixture.user_id}, 'Cleanup reference',
        'Referenced delivery fixture', 'lesson_available', ${oldDate}
      )
    `;
    await sql`
      insert into lesson_availability_subscriptions (
        id, organization_id, user_id, course_id, lesson_id,
        subscribed_version_id, fulfilled_version_id, notification_id,
        email_delivery_id, subscribed_at, fulfilled_at, updated_at
      ) values (
        ${ids.subscription}, ${fixture.organization_id}, ${fixture.user_id},
        ${fixture.course_id}, ${fixture.lesson_id}, ${fixture.version_id},
        ${fixture.version_id}, ${ids.notification}, ${ids.referencedEmail},
        ${oldDate}, ${oldDate}, ${oldDate}
      )
    `;

    const cronSecret = environmentValue("CRON_SECRET");
    const cleaned = await request.post(
      "/api/internal/jobs/dispatch?limit=1&cleanup=run&cleanupLimit=500",
      {
        headers: cronSecret
          ? { Authorization: `Bearer ${cronSecret}` }
          : undefined,
      },
    );
    expect(cleaned.status()).toBe(200);
    const [remaining] = await sql<
      Array<{
        held: number;
        referenced: number;
        deletable: number;
        heldSession: number;
        deletableSession: number;
      }>
    >`
      select
        (select count(*)::int from email_deliveries where id = ${ids.heldEmail}) as held,
        (select count(*)::int from email_deliveries where id = ${ids.referencedEmail}) as referenced,
        (select count(*)::int from email_deliveries where id = ${ids.deletableEmail}) as deletable,
        (select count(*)::int from user_sessions where id = ${ids.heldSession}) as "heldSession",
        (select count(*)::int from user_sessions where id = ${ids.deletableSession}) as "deletableSession"
    `;
    expect(remaining).toEqual({
      held: 1,
      referenced: 1,
      deletable: 0,
      heldSession: 1,
      deletableSession: 0,
    });
  } finally {
    await sql`
      delete from lesson_availability_subscriptions
      where id = ${ids.subscription}
    `;
    await sql`delete from notifications where id = ${ids.notification}`;
    await sql`
      delete from privacy_legal_holds
      where id in (${ids.hold}, ${ids.authenticationHold})
    `;
    await sql`
      delete from user_sessions
      where id in (${ids.heldSession}, ${ids.deletableSession})
    `;
    await sql`
      delete from email_deliveries
      where id in (${ids.heldEmail}, ${ids.referencedEmail}, ${ids.deletableEmail})
    `;
    await sql.end();
  }
});
