import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function environmentValue(name: string) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

test("email center isolates tenants, snapshots templates and retries safely", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted email center flow");

  const sql = postgres(databaseUrl, { max: 3, prepare: false });
  const startedAt = new Date();
  const suffix = randomUUID();
  const requestIds: string[] = [];
  const idempotencyKeys: string[] = [];
  const deliveryIds: string[] = [];
  let createdMemberId: string | null = null;
  let isolatedOrganizationId: string | null = null;
  let actorlessApiKeyId: string | null = null;
  let originalTemplateRow:
    | { value: postgres.JSONValue; updated_at: Date }
    | undefined;
  let originalLocalizedTemplateRows: Array<{
    key: string;
    value: postgres.JSONValue;
    updated_at: Date;
  }> = [];

  function headers(idempotencyKey?: string) {
    const requestId = randomUUID();
    requestIds.push(requestId);
    if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
    return {
      Authorization: `Bearer ${demoKey}`,
      "X-Request-Id": requestId,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    };
  }

  async function patchTemplates(
    api: APIRequestContext,
    subjectMarker: string,
    bodyMarker: string,
    locale?: "de" | "en" | "it" | "es" | "fr",
  ) {
    const response = await api.patch("/api/v1/email-templates", {
      headers: headers(`email-template-patch-${randomUUID()}`),
      data: {
        ...(locale ? { locale } : {}),
        version: 1,
        templates: {
          "feedback.reply": {
            subject: `${subjectMarker} {{firstName}}`,
            body: `${bodyMarker}\n\n{{defaultMessage}}`,
          },
          "lesson.available": {
            subject: `${subjectMarker} {{lessonTitle}}`,
            body: `${bodyMarker}\n\n{{lessonUrl}}`,
          },
          "course.modules.released": {
            subject: `${subjectMarker} {{courseTitle}}`,
            body: `${bodyMarker}\n\n{{moduleList}}\n\n{{courseUrl}}`,
          },
          "invitation.created": {
            subject: `${subjectMarker} Einladung {{platformName}}`,
            body: `${bodyMarker}\n\n{{invitationUrl}}\n\n{{expiresIn}}`,
          },
          "password.reset": {
            subject: `${subjectMarker} Passwort {{platformName}}`,
            body: `${bodyMarker}\n\n{{resetUrl}}\n\n{{expiresIn}}`,
          },
        },
      },
    });
    expect(response.status()).toBe(200);
    return response;
  }

  try {
    const [fixture] = await sql<
      Array<{ organization_id: string; user_id: string; email: string }>
    >`
      select organizations.id as organization_id, users.id as user_id,
             users.email
      from organizations
      join users on users.organization_id = organizations.id
      where organizations.slug = 'q-academy'
        and users.email = 'admin@q-academy.de'
      limit 1
    `;
    if (!fixture) throw new Error("Default email center fixture is missing.");

    [originalTemplateRow] = await sql<
      Array<{ value: postgres.JSONValue; updated_at: Date }>
    >`
      select value, updated_at
      from platform_settings
      where organization_id = ${fixture.organization_id}
        and key = 'email_templates'
    `;
    originalLocalizedTemplateRows = await sql`
      select key, value, updated_at
      from platform_settings
      where organization_id = ${fixture.organization_id}
        and key like 'email_templates.%'
    `;

    await patchTemplates(request, `Snapshot-A-${suffix}`, "Body-A");
    await patchTemplates(
      request,
      `ES-${suffix}`,
      "Cuerpo-ES",
      "es",
    );
    const spanishTemplates = await request.get(
      "/api/v1/email-templates?locale=es",
      { headers: headers() },
    );
    expect(spanishTemplates.status()).toBe(200);
    await expect(spanishTemplates.json()).resolves.toMatchObject({
      data: {
        locale: "es",
        source: "localized",
        templates: {
          "feedback.reply": { subject: `ES-${suffix} {{firstName}}` },
        },
      },
    });
    const unsupportedLocale = await request.get(
      "/api/v1/email-templates?locale=nl",
      { headers: headers() },
    );
    expect(unsupportedLocale.status()).toBe(422);
    await expect(unsupportedLocale.json()).resolves.toMatchObject({
      code: "validation_error",
    });
    const templateRequestId = randomUUID();
    const queued = await request.post(
      "/api/v1/email-templates/test-deliveries",
      {
        headers: headers(`email-test-${randomUUID()}`),
        data: {
          event: "invitation.created",
          requestId: templateRequestId,
          locale: "es",
        },
      },
    );
    expect(queued.status()).toBe(202);
    const queuedBody = (await queued.json()) as {
      data: { id: string; changed: boolean; status: string; locale: string };
    };
    deliveryIds.push(queuedBody.data.id);
    expect(queuedBody.data).toMatchObject({
      changed: true,
      status: "pending",
      locale: "es",
    });

    const duplicate = await request.post(
      "/api/v1/email-templates/test-deliveries",
      {
        headers: headers(`email-test-domain-replay-${randomUUID()}`),
        data: {
          event: "invitation.created",
          requestId: templateRequestId,
          locale: "es",
        },
      },
    );
    expect(duplicate.status()).toBe(202);
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { id: queuedBody.data.id, changed: false },
    });

    const history = await request.get(
      `/api/v1/email-deliveries?event=email.template.test&search=${encodeURIComponent(fixture.email)}`,
      { headers: headers() },
    );
    expect(history.status()).toBe(200);
    const historyBody = (await history.json()) as {
      data: Array<{
        id: string;
        recipient: { name: string; email: string };
      }>;
    };
    const historyRow = historyBody.data.find(
      (item) => item.id === queuedBody.data.id,
    );
    expect(historyRow?.recipient.email).toBe("a***@q-academy.de");
    expect(JSON.stringify(historyRow)).not.toContain(fixture.email);

    await patchTemplates(request, `Snapshot-B-${suffix}`, "Body-B");
    await patchTemplates(
      request,
      `ES-B-${suffix}`,
      "Cuerpo-ES-B",
      "es",
    );
    const detail = await request.get(
      `/api/v1/email-deliveries/${queuedBody.data.id}`,
      { headers: headers() },
    );
    expect(detail.status()).toBe(200);
    const detailText = await detail.text();
    expect(detailText).toContain(`ES-${suffix}`);
    expect(detailText).not.toContain(`ES-B-${suffix}`);
    expect(detailText).not.toContain(`Snapshot-B-${suffix}`);
    expect(detailText).not.toContain("https://academy.example");
    expect(detailText).toContain("[Link ausgeblendet]");
    expect(detailText).not.toContain("ciphertext");

    const pendingRetry = await request.post(
      `/api/v1/email-deliveries/${queuedBody.data.id}/retry`,
      { headers: headers(`email-pending-retry-${randomUUID()}`), data: {} },
    );
    expect(pendingRetry.status()).toBe(409);

    await sql`
      update email_deliveries
      set status = 'failed', attempt = 4, response_status = null,
          response_body = ${`provider-secret-code=${suffix}`},
          next_retry_at = null, claimed_at = null, updated_at = now()
      where id = ${queuedBody.data.id}
    `;
    const failedDetail = await request.get(
      `/api/v1/email-deliveries/${queuedBody.data.id}`,
      { headers: headers() },
    );
    const failedDetailText = await failedDetail.text();
    expect(failedDetail.status()).toBe(200);
    expect(failedDetailText).toContain("Die E-Mail-Zustellung ist fehlgeschlagen.");
    expect(failedDetailText).not.toContain(`provider-secret-code=${suffix}`);

    const retryResponses = await Promise.all(
      [randomUUID(), randomUUID()].map((key) =>
        request.post(`/api/v1/email-deliveries/${queuedBody.data.id}/retry`, {
          headers: headers(`email-retry-${key}`),
          data: {},
        }),
      ),
    );
    expect(retryResponses.map((response) => response.status())).toEqual([
      202, 202,
    ]);
    const retryBodies = await Promise.all(
      retryResponses.map((response) => response.json()),
    );
    expect(
      retryBodies.map((body) => body.data.changed).sort(),
    ).toEqual([false, true]);
    const [retryState] = await sql<
      Array<{ status: string; attempt: number; events: number }>
    >`
      select email_deliveries.status, email_deliveries.attempt,
        (
          select count(*)::int from activity_events
          where type = 'email.delivery.retried'
            and entity_id = ${queuedBody.data.id}
        ) as events
      from email_deliveries
      where id = ${queuedBody.data.id}
    `;
    expect(retryState).toEqual({ status: "pending", attempt: 0, events: 1 });

    const memberEmail = `email-center-${suffix}@example.test`;
    const memberResponse = await request.post("/api/v1/members", {
      headers: headers(`email-center-member-${randomUUID()}`),
      data: {
        email: memberEmail,
        firstName: "Mail",
        lastName: "Security",
      },
    });
    expect(memberResponse.status()).toBe(201);
    const memberBody = (await memberResponse.json()) as {
      data: { id: string; invitation: { token: string; link: string } };
    };
    createdMemberId = memberBody.data.id;
    const [authDelivery] = await sql<Array<{ id: string }>>`
      select id from email_deliveries
      where user_id = ${createdMemberId} and event = 'invitation.created'
      order by created_at desc limit 1
    `;
    if (!authDelivery) throw new Error("Invitation delivery is missing.");
    deliveryIds.push(authDelivery.id);
    const authDetail = await request.get(
      `/api/v1/email-deliveries/${authDelivery.id}`,
      { headers: headers() },
    );
    const authDetailText = await authDetail.text();
    expect(authDetail.status()).toBe(200);
    expect(authDetailText).toContain('"reason":"authentication_link"');
    expect(authDetailText).not.toContain(memberBody.data.invitation.token);
    expect(authDetailText).not.toContain(memberBody.data.invitation.link);
    expect(authDetailText).not.toContain("ciphertext");

    await sql`
      update email_deliveries
      set status = 'failed', attempt = 8, claimed_at = null, updated_at = now()
      where id = ${authDelivery.id}
    `;
    const authRetry = await request.post(
      `/api/v1/email-deliveries/${authDelivery.id}/retry`,
      { headers: headers(`email-auth-retry-${randomUUID()}`), data: {} },
    );
    expect(authRetry.status()).toBe(409);

    const [isolatedOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('Isolated Mail Tenant', ${`isolated-mail-${suffix}`})
      returning id
    `;
    isolatedOrganizationId = isolatedOrganization!.id;
    const [isolatedUser] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${isolatedOrganizationId}, ${`admin-${suffix}@isolated.test`},
        'unused-test-password', 'Isolated', 'Admin', 'admin', 'active'
      ) returning id
    `;
    const isolatedDeliveryId = randomUUID();
    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload, status
      ) values (
        ${isolatedDeliveryId}, ${isolatedOrganizationId}, ${isolatedUser!.id},
        'invitation.created', ${`admin-${suffix}@isolated.test`},
        ${sql.json({ visible_fixture_secret: suffix })}, 'failed'
      )
    `;
    const isolatedDetail = await request.get(
      `/api/v1/email-deliveries/${isolatedDeliveryId}`,
      { headers: headers() },
    );
    const isolatedText = await isolatedDetail.text();
    expect(isolatedDetail.status()).toBe(404);
    expect(isolatedText).not.toContain(suffix);

    const actorlessSecret = `qak_actorless_email_${suffix.replaceAll("-", "")}`;
    const [actorlessKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${fixture.organization_id}, 'Actorless email test',
        ${actorlessSecret.slice(0, 17)}, ${hash(actorlessSecret)},
        array['email:write'], null
      ) returning id
    `;
    actorlessApiKeyId = actorlessKey!.id;
    const actorlessRequestId = randomUUID();
    requestIds.push(actorlessRequestId);
    const actorlessSend = await request.post(
      "/api/v1/email-templates/test-deliveries",
      {
        headers: {
          Authorization: `Bearer ${actorlessSecret}`,
          "X-Request-Id": actorlessRequestId,
          "Idempotency-Key": `actorless-${randomUUID()}`,
        },
        data: { event: "feedback.reply", requestId: randomUUID() },
      },
    );
    expect(actorlessSend.status()).toBe(403);

    const invalidId = await request.get(
      "/api/v1/email-deliveries/not-a-uuid",
      { headers: headers() },
    );
    expect(invalidId.status()).toBe(400);
  } finally {
    await sql`
      delete from platform_settings
      where organization_id = (
        select id from organizations where slug = 'q-academy'
      ) and key like 'email_templates.%'
    `;
    for (const row of originalLocalizedTemplateRows) {
      await sql`
        insert into platform_settings (organization_id, key, value, updated_at)
        values (
          (select id from organizations where slug = 'q-academy'),
          ${row.key}, ${sql.json(row.value)}, ${row.updated_at}
        )
      `;
    }
    if (originalTemplateRow) {
      await sql`
        insert into platform_settings (organization_id, key, value, updated_at)
        values (
          (select id from organizations where slug = 'q-academy'),
          'email_templates', ${sql.json(originalTemplateRow.value)},
          ${originalTemplateRow.updated_at}
        )
        on conflict (organization_id, key) do update
        set value = excluded.value, updated_at = excluded.updated_at
      `;
    } else {
      await sql`
        delete from platform_settings
        where organization_id = (
          select id from organizations where slug = 'q-academy'
        ) and key = 'email_templates'
      `;
    }
    if (requestIds.length) {
      await sql`delete from api_audit_logs where request_id = any(${requestIds})`;
    }
    if (idempotencyKeys.length) {
      await sql`delete from api_idempotency_keys where key = any(${idempotencyKeys})`;
    }
    if (deliveryIds.length) {
      await sql`delete from activity_events where entity_id = any(${deliveryIds})`;
      await sql`delete from email_deliveries where id = any(${deliveryIds})`;
    }
    await sql`
      delete from activity_events
      where created_at >= ${startedAt}
        and type = 'platform.email_templates.updated'
        and organization_id = (
          select id from organizations where slug = 'q-academy'
        )
    `;
    if (createdMemberId) {
      await sql`delete from api_audit_logs where resource_id = ${createdMemberId}`;
      await sql`delete from activity_events where entity_id = ${createdMemberId}`;
      await sql`delete from users where id = ${createdMemberId}`;
    }
    if (actorlessApiKeyId) {
      await sql`delete from api_audit_logs where api_key_id = ${actorlessApiKeyId}`;
      await sql`delete from api_idempotency_keys where api_key_id = ${actorlessApiKeyId}`;
      await sql`delete from api_keys where id = ${actorlessApiKeyId}`;
    }
    if (isolatedOrganizationId) {
      await sql`delete from organizations where id = ${isolatedOrganizationId}`;
    }
    await sql.end();
  }
});

test("email worker terminally fails an invalid recipient join", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted email worker race");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const deliveryId = randomUUID();
  try {
    const [fixture] = await sql<
      Array<{ organization_id: string; user_id: string }>
    >`
      select organizations.id as organization_id, users.id as user_id
      from organizations
      join users on users.organization_id = organizations.id
      where organizations.slug = 'q-academy'
        and users.email = 'admin@q-academy.de'
      limit 1
    `;
    if (!fixture) throw new Error("Default worker fixture is missing.");
    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload,
        status, created_at, updated_at
      ) values (
        ${deliveryId}, ${fixture.organization_id}, ${fixture.user_id},
        'email.template.test', 'stale-recipient@example.test',
        ${sql.json({ intentionally_invalid: true })}, 'pending',
        '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'
      )
    `;
    const dispatched = await request.post(
      "/api/internal/jobs/dispatch?limit=100",
      {
        headers: environmentValue("CRON_SECRET")
          ? { Authorization: `Bearer ${environmentValue("CRON_SECRET")}` }
          : undefined,
      },
    );
    expect(dispatched.status()).toBe(200);
    const [processed] = await sql<
      Array<{
        status: string;
        attempt: number;
        claimed_at: Date | null;
        response_body: string | null;
      }>
    >`
      select status, attempt, claimed_at, response_body
      from email_deliveries where id = ${deliveryId}
    `;
    expect(processed).toEqual({
      status: "failed",
      attempt: 1,
      claimed_at: null,
      response_body:
        "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist.",
    });
  } finally {
    await sql`delete from email_deliveries where id = ${deliveryId}`;
    await sql.end();
  }
});

test("admin email center is responsive and completes retry and test-send flows", async ({
  page,
  request,
}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const startedAt = new Date();
  const requestId = randomUUID();
  const apiRequestId = randomUUID();
  const apiIdempotencyKey = `email-ui-seed-${randomUUID()}`;
  let initialDeliveryId: string | null = null;
  try {
    const queued = await request.post(
      "/api/v1/email-templates/test-deliveries",
      {
        headers: {
          Authorization: `Bearer ${demoKey}`,
          "X-Request-Id": apiRequestId,
          "Idempotency-Key": apiIdempotencyKey,
        },
        data: { event: "feedback.reply", requestId },
      },
    );
    expect(queued.status()).toBe(202);
    const queuedBody = (await queued.json()) as { data: { id: string } };
    initialDeliveryId = queuedBody.data.id;
    await sql`
      update email_deliveries
      set status = 'failed', attempt = 3, response_status = null,
          response_body = 'ui-provider-secret', claimed_at = null,
          next_retry_at = null, updated_at = now()
      where id = ${initialDeliveryId}
    `;

    await page.goto("/login");
    await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
    await page.waitForURL("**/admin");

    await page.goto("/admin/email");
    await expect(page.getByRole("heading", { name: "E-Mail-Center" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Versand", exact: true })).toBeVisible();
    await expect(
      page.getByText("a***@q-academy.de").filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("email-history.png"),
      fullPage: true,
    });

    await page.goto(`/admin/email/${initialDeliveryId}`);
    await expect(page.getByRole("heading", { name: "Versanddetails" })).toBeVisible();
    await expect(page.getByText("Die E-Mail-Zustellung ist fehlgeschlagen.")).toBeVisible();
    await expect(page.getByText("ui-provider-secret")).toHaveCount(0);
    const retryButton = page.getByRole("button", { name: "Erneut senden" });
    await expect(retryButton).toBeVisible();
    await retryButton.click();
    await expect(
      page
        .getByText("Erneuter Versand wurde vorgemerkt.")
        .or(page.getByText("Vorgemerkt", { exact: true })),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("email-detail.png"),
      fullPage: false,
    });

    await page.goto("/admin/email/templates");
    await expect(page.getByRole("heading", { name: "E-Mail-Center" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Textvorschau" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("admin@q-academy.de"),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Einladung" }).click();
    await expect(
      page.getByRole("button", { name: "{{invitationUrl}}", exact: true }),
    ).toBeVisible();
    const testButton = page.getByRole("button", { name: "Test senden" });
    await expect(testButton).toBeEnabled();
    await testButton.click();
    await expect(
      page.getByText("Test-E-Mail wurde zum Versand eingeplant."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("email-templates.png"),
      fullPage: false,
    });
  } finally {
    const testDeliveries = await sql<Array<{ id: string }>>`
      select id from email_deliveries
      where event = 'email.template.test'
        and recipient_email = 'admin@q-academy.de'
        and created_at >= ${startedAt}
    `;
    const ids = testDeliveries.map((delivery) => delivery.id);
    if (ids.length) {
      await sql`delete from activity_events where entity_id = any(${ids})`;
      await sql`delete from email_deliveries where id = any(${ids})`;
    }
    await sql`
      delete from api_audit_logs
      where request_id = ${apiRequestId}
    `;
    await sql`
      delete from api_idempotency_keys
      where key = ${apiIdempotencyKey}
    `;
    await sql.end();
  }
});
