import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoPassword = "Demo123!";

async function login(
  page: Page,
  input: { email: string; organizationSlug: string },
) {
  await page.goto(`http://${input.organizationSlug}.localhost:3000/login`);
  await page.getByLabel("E-Mail-Adresse").fill(input.email);
  await page.getByLabel("Passwort", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: /anmelden$/ }).click();
  await page.waitForURL("**/admin");
}

test("dead letters are sanitized, tenant-bound, permission-safe and responsive", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID();
  const organizationSlug = `dead-letter-${suffix}`;
  const ownerEmail = `dead-letter-owner-${suffix}@example.test`;
  const viewerEmail = `dead-letter-viewer-${suffix}@example.test`;
  const webhookName = `Dead Letter CRM ${suffix.slice(0, 8)}`;
  const payloadSecret = `payload-secret-${suffix}`;
  const responseSecret = `response-secret-${suffix}`;
  const readKey = `qak_dead_read_${randomBytes(28).toString("base64url")}`;
  const writeKey = `qak_dead_write_${randomBytes(28).toString("base64url")}`;
  let organizationId = "";
  let foreignOrganizationId = "";

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    expect(template).toBeTruthy();
    const [organization, foreignOrganization] = await sql<
      Array<{ id: string }>
    >`
      insert into organizations (name, slug)
      values
        (${`Dead Letter QA ${suffix}`}, ${organizationSlug}),
        (${`Foreign Dead Letter QA ${suffix}`}, ${`foreign-dead-letter-${suffix}`})
      returning id
    `;
    organizationId = organization.id;
    foreignOrganizationId = foreignOrganization.id;
    const [owner, viewer] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (${organizationId}, ${ownerEmail}, ${template.password_hash}, 'Delivery', 'Owner', 'owner', 'active'),
        (${organizationId}, ${viewerEmail}, ${template.password_hash}, 'Delivery', 'Viewer', 'admin', 'active')
      returning id
    `;
    const [viewerRole] = await sql<Array<{ id: string }>>`
      insert into team_roles (
        organization_id, name, description, permissions, created_by_id
      ) values (
        ${organizationId}, ${`API viewer ${suffix}`},
        'Read-only access for the dead-letter browser test.',
        array['api.view'], ${owner.id}
      )
      returning id
    `;
    await sql`
      insert into team_role_assignments (
        organization_id, user_id, role_id, assigned_by_id
      ) values (${organizationId}, ${viewer.id}, ${viewerRole.id}, ${owner.id})
    `;
    const [webhook] = await sql<Array<{ id: string }>>`
      insert into webhooks (
        organization_id, name, url, signing_secret_encrypted, events,
        created_by_id
      ) values (
        ${organizationId}, ${webhookName},
        'https://example.test/q-academy-webhook', 'unused-encrypted-secret',
        array['course.published'], ${owner.id}
      )
      returning id
    `;
    const [foreignWebhook] = await sql<Array<{ id: string }>>`
      insert into webhooks (
        organization_id, name, url, signing_secret_encrypted, events
      ) values (
        ${foreignOrganizationId}, 'Foreign dead letter',
        'https://foreign.example.test/webhook', 'unused-encrypted-secret',
        array['course.published']
      )
      returning id
    `;
    const [failed, delivered] = await sql<Array<{ id: string }>>`
      insert into webhook_deliveries (
        organization_id, webhook_id, event, payload, status, attempt,
        response_status, response_body, duration_ms
      ) values
        (
          ${organizationId}, ${webhook.id}, 'course.published',
          ${sql.json({
            id: `evt-${suffix}`,
            type: "course.published",
            createdAt: "2026-07-13T10:00:00.000Z",
            data: { email: "private@example.test", apiToken: payloadSecret },
          })},
          'failed', 6, 500, ${`password=${responseSecret}`}, 840
        ),
        (
          ${organizationId}, ${webhook.id}, 'course.published', '{}',
          'delivered', 1, 204, '', 90
        )
      returning id
    `;
    const [foreignFailed] = await sql<Array<{ id: string }>>`
      insert into webhook_deliveries (
        organization_id, webhook_id, event, status, attempt,
        response_status, response_body
      ) values (
        ${foreignOrganizationId}, ${foreignWebhook.id}, 'course.published',
        'failed', 6, 500, 'foreign secret response'
      )
      returning id
    `;
    await sql`
      insert into webhook_delivery_attempts (
        organization_id, delivery_id, webhook_id, replay_generation,
        attempt, outcome, response_status, failure_kind,
        response_body_redacted, duration_ms, started_at, completed_at
      ) values (
        ${organizationId}, ${failed.id}, ${webhook.id}, 0,
        6, 'failed', 500, 'http', true, 840,
        timestamp with time zone '2026-07-13 09:59:59.160+00',
        timestamp with time zone '2026-07-13 10:00:00+00'
      )
    `;
    await sql`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values
        (
          ${organizationId}, 'Dead-letter read key', ${readKey.slice(0, 17)},
          ${createHash("sha256").update(readKey).digest("hex")},
          array['webhooks:read'], ${owner.id}
        ),
        (
          ${organizationId}, 'Dead-letter write key', ${writeKey.slice(0, 17)},
          ${createHash("sha256").update(writeKey).digest("hex")},
          array['webhooks:write'], ${owner.id}
        )
    `;

    if (testInfo.project.name === "chromium") {
      const listed = await request.get(
        "/api/v1/webhooks/deliveries?status=failed&limit=50",
        { headers: { Authorization: `Bearer ${readKey}` } },
      );
      expect(listed.status()).toBe(200);
      const listedBody = (await listed.json()) as {
        data: Array<Record<string, unknown>>;
      };
      expect(listedBody.data).toHaveLength(1);
      expect(listedBody.data[0]).toMatchObject({
        id: failed.id,
        webhookId: webhook.id,
        status: "failed",
        attempt: 6,
        replayable: true,
      });
      expect(listedBody.data[0]).not.toHaveProperty("payload");
      expect(listedBody.data[0]).not.toHaveProperty("responseBody");
      expect(JSON.stringify(listedBody)).not.toContain(payloadSecret);
      expect(JSON.stringify(listedBody)).not.toContain(responseSecret);

      const detailResponse = await request.get(
        `/api/v1/webhooks/${webhook.id}/deliveries/${failed.id}`,
        { headers: { Authorization: `Bearer ${readKey}` } },
      );
      expect(detailResponse.status()).toBe(200);
      const detailBody = await detailResponse.json();
      expect(detailBody.data.payload.dataKeys).toEqual(["email", "apiToken"]);
      expect(detailBody.data.attempts).toMatchObject([
        {
          replayGeneration: 0,
          attempt: 6,
          outcome: "failed",
          responseStatus: 500,
          responseBodyRedacted: true,
          failureKind: "http",
          durationMs: 840,
        },
      ]);
      expect(JSON.stringify(detailBody)).not.toContain(payloadSecret);
      expect(JSON.stringify(detailBody)).not.toContain(responseSecret);

      const deniedReplay = await request.post(
        `/api/v1/webhooks/deliveries/${failed.id}/replay`,
        {
          headers: {
            Authorization: `Bearer ${readKey}`,
            "Idempotency-Key": randomUUID(),
          },
        },
      );
      expect(deniedReplay.status()).toBe(403);

      const foreignReplay = await request.post(
        `/api/v1/webhooks/deliveries/${foreignFailed.id}/replay`,
        {
          headers: {
            Authorization: `Bearer ${writeKey}`,
            "Idempotency-Key": randomUUID(),
          },
        },
      );
      expect(foreignReplay.status()).toBe(404);

      const deliveredReplay = await request.post(
        `/api/v1/webhooks/deliveries/${delivered.id}/replay`,
        {
          headers: {
            Authorization: `Bearer ${writeKey}`,
            "Idempotency-Key": randomUUID(),
          },
        },
      );
      expect(deliveredReplay.status()).toBe(409);
    }

    await login(page, {
      email: testInfo.project.name === "mobile" ? ownerEmail : viewerEmail,
      organizationSlug,
    });
    await page.goto(`http://${organizationSlug}.localhost:3000/admin/api`);
    await page.getByRole("tab", { name: /^Webhooks/ }).click();
    const deadLetters = page.getByTestId("webhook-dead-letter-section");
    await expect(
      deadLetters.getByRole("heading", { name: "Fehlgeschlagene Zustellungen" }),
    ).toBeVisible();
    await expect(
      deadLetters.getByText(webhookName, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText(payloadSecret, { exact: false })).toHaveCount(0);
    await expect(page.getByText(responseSecret, { exact: false })).toHaveCount(0);
    const detailControl = deadLetters.getByRole("button", {
      name: "Zustellungsdetails anzeigen",
    });
    if (testInfo.project.name === "mobile") {
      await detailControl.focus();
      await page.keyboard.press("Enter");
    } else {
      await detailControl.click();
    }
    const dialog = page.getByRole("dialog", { name: webhookName });
    await expect(dialog.getByText("6 von 6", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("HTTP-Fehler", { exact: true }).first(),
    ).toBeVisible();
    await expect(dialog.getByText("Lauf 1, Versuch 6", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("Antwortinhalt aus Sicherheitsgruenden ausgeblendet.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByText("apiToken", { exact: true })).toBeVisible();
    await expect(dialog.getByText(payloadSecret, { exact: false })).toHaveCount(0);
    await expect(dialog.getByText(responseSecret, { exact: false })).toHaveCount(0);

    if (testInfo.project.name === "mobile") {
      const viewportLayout = await page.evaluate(() => ({
        delta:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        overflow: [...document.querySelectorAll<HTMLElement>("body *")]
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            rect: element.getBoundingClientRect().toJSON(),
          }))
          .filter((item) => item.rect.right > window.innerWidth + 1)
          .sort((left, right) => right.rect.right - left.rect.right)
          .slice(0, 8),
      }));
      expect(
        viewportLayout.delta,
        JSON.stringify(viewportLayout.overflow),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath("webhook-dead-letter-mobile.png"),
        fullPage: true,
      });
      return;
    }

    await expect(dialog.getByRole("button", { name: "Erneut einplanen" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Dialog schliessen" }).click();
    await page.context().clearCookies();
    await login(page, { email: ownerEmail, organizationSlug });
    await page.goto(`http://${organizationSlug}.localhost:3000/admin/api`);
    await page.getByRole("tab", { name: /^Webhooks/ }).click();
    const ownerDeadLetters = page.getByTestId("webhook-dead-letter-section");
    await ownerDeadLetters
      .getByRole("button", { name: "Zustellungsdetails anzeigen" })
      .click();
    const ownerDialog = page.getByRole("dialog", { name: webhookName });
    await ownerDialog.getByRole("button", { name: "Erneut einplanen" }).click();
    await expect(ownerDialog).toHaveCount(0);
    await expect(ownerDeadLetters.getByText(webhookName, { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => {
        const [row] = await sql<
          Array<{ attempt: number; replay_generation: number; status: string }>
        >`
          select status::text, attempt, replay_generation
          from webhook_deliveries
          where id = ${failed.id}
        `;
        return row;
      })
      .toEqual({ status: "pending", attempt: 0, replay_generation: 1 });
    await page.screenshot({
      path: testInfo.outputPath("webhook-dead-letter-desktop.png"),
      fullPage: true,
    });
  } finally {
    if (organizationId) {
      await sql`delete from organizations where id = ${organizationId}`;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end({ timeout: 5 });
  }
});
