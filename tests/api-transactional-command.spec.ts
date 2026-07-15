import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function demoIdentity(client: postgres.Sql) {
  const [identity] = await client<
    Array<{ api_key_id: string; organization_id: string }>
  >`
    select id as api_key_id, organization_id
    from api_keys
    where key_hash = ${hashSecret(demoSecret)}
      and status = 'active'
    limit 1
  `;
  if (!identity) throw new Error("Demo API identity was not found.");
  return identity;
}

async function createWebhook(
  client: postgres.Sql,
  organizationId: string,
  event: string,
) {
  const [webhook] = await client<Array<{ id: string }>>`
    insert into webhooks (
      organization_id,
      name,
      url,
      signing_secret_encrypted,
      events,
      active
    ) values (
      ${organizationId},
      ${`Transactional command test ${randomUUID()}`},
      'https://hooks.invalid/transactional-command-test',
      'test-only-not-deliverable',
      ${[event]},
      true
    )
    returning id
  `;
  return webhook.id;
}

test("member command commits one member, activity and outboxes under parallel retry", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused command-kernel test");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const email = `transaction-member-${suffix}@example.test`;
  const key = `command-member-${suffix}`;
  const requestIds = [randomUUID(), randomUUID()];
  let webhookId: string | null = null;
  let memberId: string | null = null;

  try {
    const identity = await demoIdentity(client);
    webhookId = await createWebhook(
      client,
      identity.organization_id,
      "member.created",
    );
    const data = {
      email,
      firstName: "Transactional",
      lastName: "Member",
      role: "member",
      status: "invited",
    };
    const responses = await Promise.all(
      requestIds.map((requestId) =>
        request.post("/api/v1/members", {
          headers: {
            Authorization: `Bearer ${demoSecret}`,
            "Idempotency-Key": key,
            "X-Request-Id": requestId,
          },
          data,
        }),
      ),
    );

    expect(responses.map((response) => response.status())).toEqual([201, 201]);
    const responseTexts = await Promise.all(
      responses.map((response) => response.text()),
    );
    expect(responseTexts[1]).toBe(responseTexts[0]);
    expect(
      responses.filter(
        (response) => response.headers()["idempotent-replayed"] === "true",
      ),
    ).toHaveLength(1);
    const body = JSON.parse(responseTexts[0]) as {
      data: { id: string; invitation: { token: string } };
    };
    memberId = body.data.id;

    const [state] = await client<
      Array<{
        activity_count: number;
        audit_count: number;
        delivery_count: number;
        email_count: number;
        idempotency_count: number;
        invitation_count: number;
        member_count: number;
        response_body: string;
      }>
    >`
      select
        (select count(*)::int from users where id = ${memberId}) as member_count,
        (select count(*)::int from invitations where user_id = ${memberId}) as invitation_count,
        (select count(*)::int from email_deliveries where user_id = ${memberId}) as email_count,
        (select count(*)::int from activity_events where entity_id = ${memberId} and type = 'member.invited') as activity_count,
        (select count(*)::int from webhook_deliveries where webhook_id = ${webhookId} and event = 'member.created') as delivery_count,
        (select count(*)::int from api_audit_logs where request_id = any(${requestIds}::uuid[]) and action = 'member.create') as audit_count,
        (select count(*)::int from api_idempotency_keys where api_key_id = ${identity.api_key_id} and key = ${key} and status = 'completed') as idempotency_count,
        coalesce((select response_body::text from api_idempotency_keys where api_key_id = ${identity.api_key_id} and key = ${key}), '') as response_body
    `;
    expect(state).toMatchObject({
      activity_count: 1,
      audit_count: 2,
      delivery_count: 1,
      email_count: 1,
      idempotency_count: 1,
      invitation_count: 1,
      member_count: 1,
    });
    expect(state.response_body).toContain('"alg": "A256GCM"');
    expect(state.response_body).not.toContain(email);
    expect(state.response_body).not.toContain(body.data.invitation.token);
  } finally {
    await client`delete from api_audit_logs where request_id = any(${requestIds}::uuid[])`;
    await client`delete from api_idempotency_keys where key = ${key}`;
    if (memberId) {
      await client`delete from activity_events where entity_id = ${memberId}`;
      await client`delete from users where id = ${memberId}`;
    } else {
      const members = await client<Array<{ id: string }>>`
        select id from users where email = ${email}
      `;
      for (const member of members) {
        await client`delete from activity_events where entity_id = ${member.id}`;
      }
      await client`delete from users where email = ${email}`;
    }
    if (webhookId) await client`delete from webhooks where id = ${webhookId}`;
    await client.end();
  }
});

test("event command rolls back mutation and outboxes when audit persistence fails", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused command-kernel test");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const title = `Transactional event ${suffix}`;
  const key = `command-event-${suffix}`;
  const requestId = randomUUID();
  let webhookId: string | null = null;
  let eventId: string | null = null;

  const removeFault = async () => {
    await client.unsafe(
      "drop trigger if exists q_academy_test_fail_command_audit on api_audit_logs",
    );
    await client.unsafe(
      "drop function if exists q_academy_test_fail_command_audit()",
    );
  };

  try {
    const identity = await demoIdentity(client);
    webhookId = await createWebhook(
      client,
      identity.organization_id,
      "event.created",
    );
    await removeFault();
    await client.unsafe(`
      create function q_academy_test_fail_command_audit()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'test audit persistence failure';
      end;
      $$
    `);
    await client.unsafe(`
      create trigger q_academy_test_fail_command_audit
      before insert on api_audit_logs
      for each row
      when (new.request_id = '${requestId}'::uuid)
      execute function q_academy_test_fail_command_audit()
    `);

    const startsAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const data = {
      title,
      description: "Transaction rollback verification",
      type: "workshop",
      startsAt,
      endsAt,
      audience: { mode: "tenant", userIds: [], groupIds: [], bundleIds: [] },
    };
    const headers = {
      Authorization: `Bearer ${demoSecret}`,
      "Idempotency-Key": key,
      "X-Request-Id": requestId,
    };
    const failed = await request.post("/api/v1/events", { headers, data });
    expect(failed.status()).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      code: "internal_error",
      requestId,
    });
    await removeFault();

    const [rolledBack] = await client<
      Array<{
        activity_count: number;
        delivery_count: number;
        event_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from events where title = ${title}) as event_count,
        (select count(*)::int from activity_events where metadata ->> 'title' = ${title} and type = 'event.created') as activity_count,
        (select count(*)::int from webhook_deliveries where webhook_id = ${webhookId} and event = 'event.created') as delivery_count,
        (select count(*)::int from api_idempotency_keys where api_key_id = ${identity.api_key_id} and key = ${key}) as idempotency_count
    `;
    expect(rolledBack).toEqual({
      activity_count: 0,
      delivery_count: 0,
      event_count: 0,
      idempotency_count: 0,
    });

    const retried = await request.post("/api/v1/events", { headers, data });
    expect(retried.status()).toBe(201);
    const retriedBody = (await retried.json()) as { data: { id: string } };
    eventId = retriedBody.data.id;
    const [committed] = await client<
      Array<{
        activity_count: number;
        audit_count: number;
        delivery_count: number;
        event_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from events where id = ${eventId}) as event_count,
        (select count(*)::int from activity_events where entity_id = ${eventId} and type = 'event.created') as activity_count,
        (select count(*)::int from webhook_deliveries where webhook_id = ${webhookId} and event = 'event.created') as delivery_count,
        (select count(*)::int from api_audit_logs where request_id = ${requestId} and action = 'event.create' and response_status = 201) as audit_count,
        (select count(*)::int from api_idempotency_keys where api_key_id = ${identity.api_key_id} and key = ${key} and status = 'completed') as idempotency_count
    `;
    expect(committed).toEqual({
      activity_count: 1,
      audit_count: 1,
      delivery_count: 1,
      event_count: 1,
      idempotency_count: 1,
    });
  } finally {
    await removeFault();
    await client`delete from api_audit_logs where request_id = ${requestId}`;
    await client`delete from api_idempotency_keys where key = ${key}`;
    if (!eventId) {
      const eventRows = await client<Array<{ id: string }>>`
        select event.id
        from events event
        where event.title = ${title}
          and not exists (
            select 1 from event_lifecycle_history history
            where history.event_id = event.id
          )
      `;
      for (const event of eventRows) {
        await client`delete from activity_events where entity_id = ${event.id}`;
      }
      await client`
        delete from events event
        where event.title = ${title}
          and not exists (
            select 1 from event_lifecycle_history history
            where history.event_id = event.id
          )
      `;
    }
    // Successful event lifecycle evidence is append-only and intentionally retained.
    if (webhookId) await client`delete from webhooks where id = ${webhookId}`;
    await client.end();
  }
});

test("feedback command releases a failed pre-mutation claim and commits the retry", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused command-kernel test");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const userId = randomUUID();
  const email = `transaction-feedback-${suffix}@example.test`;
  const content = `Transactional feedback ${suffix}`;
  const key = `command-feedback-${suffix}`;
  const requestId = randomUUID();
  let webhookId: string | null = null;
  let feedbackId: string | null = null;

  try {
    const identity = await demoIdentity(client);
    webhookId = await createWebhook(
      client,
      identity.organization_id,
      "feedback.created",
    );
    const headers = {
      Authorization: `Bearer ${demoSecret}`,
      "Idempotency-Key": key,
      "X-Request-Id": requestId,
    };
    const data = {
      userId,
      type: "platform",
      rating: 5,
      content,
      testimonialConsent: false,
    };

    const missingMember = await request.post("/api/v1/feedback", {
      headers,
      data,
    });
    expect(missingMember.status()).toBe(404);
    await expect(missingMember.json()).resolves.toMatchObject({
      code: "not_found",
      requestId,
    });
    const [beforeRetry] = await client<
      Array<{
        activity_count: number;
        delivery_count: number;
        feedback_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from feedback_entries where content = ${content}) as feedback_count,
        (select count(*)::int from activity_events where entity_id = ${userId} and type = 'feedback.created') as activity_count,
        (select count(*)::int from webhook_deliveries where webhook_id = ${webhookId} and event = 'feedback.created') as delivery_count,
        (select count(*)::int from api_idempotency_keys where api_key_id = ${identity.api_key_id} and key = ${key}) as idempotency_count
    `;
    expect(beforeRetry).toEqual({
      activity_count: 0,
      delivery_count: 0,
      feedback_count: 0,
      idempotency_count: 0,
    });

    await client`
      insert into users (
        id,
        organization_id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        status
      ) values (
        ${userId},
        ${identity.organization_id},
        ${email},
        'test-only-disabled-login-hash',
        'Transactional',
        'Feedback',
        'member',
        'active'
      )
    `;
    const retried = await request.post("/api/v1/feedback", { headers, data });
    expect(retried.status()).toBe(201);
    const retriedBody = (await retried.json()) as { data: { id: string } };
    feedbackId = retriedBody.data.id;

    const [committed] = await client<
      Array<{
        activity_count: number;
        audit_count: number;
        delivery_count: number;
        feedback_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from feedback_entries where id = ${feedbackId}) as feedback_count,
        (select count(*)::int from activity_events where entity_id = ${feedbackId} and type = 'feedback.created') as activity_count,
        (select count(*)::int from webhook_deliveries where webhook_id = ${webhookId} and event = 'feedback.created') as delivery_count,
        (select count(*)::int from api_audit_logs where request_id = ${requestId} and action = 'feedback.create') as audit_count,
        (select count(*)::int from api_idempotency_keys where api_key_id = ${identity.api_key_id} and key = ${key} and status = 'completed') as idempotency_count
    `;
    expect(committed).toEqual({
      activity_count: 1,
      audit_count: 2,
      delivery_count: 1,
      feedback_count: 1,
      idempotency_count: 1,
    });
  } finally {
    await client`delete from api_audit_logs where request_id = ${requestId}`;
    await client`delete from api_idempotency_keys where key = ${key}`;
    if (feedbackId) {
      await client`delete from activity_events where entity_id = ${feedbackId}`;
    }
    await client`delete from users where id = ${userId}`;
    if (webhookId) await client`delete from webhooks where id = ${webhookId}`;
    await client.end();
  }
});
