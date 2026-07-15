import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import postgres from "postgres";

import { describeWebhookDeliveryResponse } from "../src/lib/api/webhook-delivery-model";
import { getApiConsoleCopy } from "../src/lib/i18n/api-console";
import type { AppLocale } from "../src/lib/i18n/model";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(
  page: Page,
  origin: string,
  email: string,
  password: string,
) {
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .locator('form:has(input[name="email"]) button[type="submit"]')
    .click();
  await page.waitForURL("**/admin");
}

function apiConsoleTab(page: Page, tabListLabel: string, tabLabel: string) {
  return page
    .getByRole("tablist", { name: tabListLabel })
    .getByRole("tab")
    .filter({ hasText: tabLabel });
}

async function expectNoGermanCopy(
  page: Page,
  phrases: readonly string[],
) {
  for (const phrase of phrases) {
    await expect(page.locator("body")).not.toContainText(phrase);
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => {
    const initialX = window.scrollX;
    const initialY = window.scrollY;
    window.scrollTo({ left: 100_000, top: initialY, behavior: "instant" });
    const reachableScrollX = window.scrollX;
    window.scrollTo({ left: initialX, top: initialY, behavior: "instant" });

    return {
      bodyDelta: document.body.scrollWidth - document.body.clientWidth,
      reachableScrollX,
    };
  });

  expect(layout.bodyDelta).toBeLessThanOrEqual(1);
  expect(layout.reachableScrollX).toBeLessThanOrEqual(1);
}

async function activateLongDialogButton(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  const hitTest = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    return {
      point,
      containsButton: document.elementsFromPoint(point.x, point.y).includes(element),
    };
  });
  expect(hitTest.containsButton, JSON.stringify(hitTest)).toBe(true);
  await button.focus();
  await button.press("Enter");
}

test("API console follows the owner locale on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const locale: AppLocale = testInfo.project.name === "mobile" ? "it" : "en";
  const copy = getApiConsoleCopy(locale);
  const german = getApiConsoleCopy("de");
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const apiKeyId = randomUUID();
  const webhookId = randomUUID();
  const deliveryId = randomUUID();
  const requestId = randomUUID();
  const slug = `api-console-locale-${suffix}`;
  const origin = `http://${slug}.localhost:3000`;
  const organizationName = `API Console Locale ${suffix}`;
  const ownerEmail = `api-console-owner-${suffix}@example.test`;
  const password = `ApiConsole-${suffix}!`;
  const apiKeyName = `User API key ${suffix}`;
  const apiKeySecret = `qak_live_${randomBytes(32).toString("base64url")}`;
  const apiKeyPrefix = apiKeySecret.slice(0, 17);
  const webhookName = `User webhook ${suffix}`;
  const webhookUrl = `https://hooks.example.test/user-authored/${suffix}`;
  const webhookEvent = `user-authored.event.${suffix}`;
  const requestPath = `/api/v1/user-authored/${suffix}`;
  const createdKeyName = `Created user key ${suffix}`;
  const legacyGermanDeliverySummary = describeWebhookDeliveryResponse({
    responseStatus: 502,
    responseBody: `upstream response ${suffix}`,
  }).summary;

  try {
    const passwordHash = await hash(password, 8);
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId}, ${organizationName}, ${slug}, ${locale}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${ownerId}, ${organizationId}, ${ownerEmail}, ${passwordHash},
        'API', 'Owner', 'owner', 'active', ${locale}
      )
    `;
    await sql`
      insert into api_keys (
        id, organization_id, name, prefix, key_hash, scopes, created_by_id,
        last_used_at
      ) values (
        ${apiKeyId}, ${organizationId}, ${apiKeyName}, ${apiKeyPrefix},
        ${createHash("sha256").update(apiKeySecret).digest("hex")},
        array['courses:read'], ${ownerId}, now() - interval '3 minutes'
      )
    `;
    await sql`
      insert into webhooks (
        id, organization_id, name, url, signing_secret_encrypted, events,
        active, last_delivery_at, created_by_id
      ) values (
        ${webhookId}, ${organizationId}, ${webhookName}, ${webhookUrl},
        ${`fixture-encrypted-secret-${suffix}`}, array[${webhookEvent}],
        true, now() - interval '2 minutes', ${ownerId}
      )
    `;
    await sql`
      insert into webhook_deliveries (
        id, organization_id, webhook_id, event, payload, status, attempt,
        response_status, response_body, duration_ms, created_at, updated_at
      ) values (
        ${deliveryId}, ${organizationId}, ${webhookId}, ${webhookEvent},
        ${sql.json({
          id: `user-payload-${suffix}`,
          type: webhookEvent,
          createdAt: "2026-07-13T10:00:00.000Z",
          data: { userField: suffix, sourceLabel: "User authored payload" },
        })},
        'failed', 6, 502, ${`upstream response ${suffix}`}, 731,
        now() - interval '2 minutes', now() - interval '2 minutes'
      )
    `;
    await sql`
      insert into webhook_delivery_attempts (
        organization_id, delivery_id, webhook_id, replay_generation,
        attempt, outcome, response_status, failure_kind,
        response_body_redacted, duration_ms, started_at, completed_at
      ) values (
        ${organizationId}, ${deliveryId}, ${webhookId}, 0,
        6, 'failed', 502, 'http', true, 731,
        now() - interval '2 minutes 731 milliseconds',
        now() - interval '2 minutes'
      )
    `;
    await sql`
      insert into api_audit_logs (
        organization_id, actor_user_id, api_key_id, request_id, method, path,
        action, resource_type, response_status, duration_ms, ip_address,
        user_agent, metadata, created_at
      ) values (
        ${organizationId}, ${ownerId}, ${apiKeyId}, ${requestId}, 'GET',
        ${requestPath}, 'fixture.user_authored_request', 'fixture', 503, 731,
        '192.0.2.42', 'API console localization fixture',
        ${sql.json({ source: "user-authored-fixture" })},
        now() - interval '1 minute'
      )
    `;

    await login(page, origin, ownerEmail, password);
    await page.goto(`${origin}/admin/api`, { waitUntil: "networkidle" });

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: copy.page.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(copy.page.description, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: copy.header.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(copy.header.eyebrow, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(copy.header.development, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(organizationName, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: copy.tabs.ariaLabel }),
    ).toBeVisible();
    for (const tabLabel of [
      copy.tabs.access,
      copy.tabs.endpoints,
      copy.tabs.webhooks,
      copy.tabs.requests,
    ]) {
      await expect(
        apiConsoleTab(page, copy.tabs.ariaLabel, tabLabel),
      ).toBeVisible();
    }

    await expect(
      page.getByRole("heading", { name: copy.access.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(copy.access.search)).toBeVisible();
    await expect(page.getByLabel(copy.access.filterAria)).toBeVisible();
    await expect(
      page
        .getByText(apiKeyName, { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByText(`${apiKeyPrefix}_********`, { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expectNoGermanCopy(page, [
      german.page.description,
      german.header.title,
      german.header.development,
      german.tabs.access,
      german.tabs.requests,
      german.access.title,
    ]);
    await expectNoHorizontalOverflow(page);

    await page
      .getByRole("button", { name: copy.header.apiKey, exact: true })
      .click();
    const createDialog = page.getByRole("dialog", {
      name: copy.createKey.title,
    });
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByText(copy.createKey.eyebrow)).toBeVisible();
    await expect(createDialog.getByLabel(copy.createKey.name)).toHaveAttribute(
      "placeholder",
      copy.createKey.namePlaceholder,
    );
    await expect(createDialog.getByLabel(copy.createKey.expiration)).toBeVisible();
    await expect(
      createDialog.getByRole("group", { name: copy.createKey.scopes }),
    ).toBeVisible();
    await expect(createDialog.getByText(copy.createKey.scopesHint)).toBeVisible();
    await expect(
      createDialog.getByRole("button", { name: copy.common.cancel, exact: true }),
    ).toBeVisible();
    await expect(
      createDialog.getByRole("button", { name: copy.createKey.submit, exact: true }),
    ).toBeVisible();
    await expectNoGermanCopy(page, [
      german.createKey.title,
      german.createKey.namePlaceholder,
      german.createKey.scopesHint,
    ]);

    await createDialog.getByLabel(copy.createKey.name).fill(createdKeyName);
    const courseReadScope = createDialog.locator(
      'input[name="scopes"][value="courses:read"]',
    );
    await courseReadScope.focus();
    await courseReadScope.press("Space");
    await expect(courseReadScope).toBeChecked();
    const createKeySubmit = createDialog.getByRole("button", {
      name: copy.createKey.submit,
      exact: true,
    });
    await activateLongDialogButton(createKeySubmit);

    await expect(
      page.getByText(copy.actionMessages["apiKey.created"](), { exact: true }),
    ).toBeVisible();
    await expect(createDialog.getByText(copy.secret.once, { exact: true })).toBeVisible();
    await expect(
      createDialog.getByText(copy.secret.description, { exact: true }),
    ).toBeVisible();
    await expect(
      createDialog.getByRole("button", {
        name: copy.secret.copy(copy.secret.apiKey),
      }),
    ).toBeVisible();
    await expect(createDialog.locator("code")).toHaveText(/^qak_live_[A-Za-z0-9_-]+$/);
    await expectNoGermanCopy(page, [
      german.secret.once,
      german.secret.description,
      german.actionMessages["apiKey.created"](),
    ]);
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ count: number }>>`
          select count(*)::int as count
          from api_keys
          where organization_id = ${organizationId}
            and name = ${createdKeyName}
            and scopes = array['courses:read']::text[]
        `;
        return row?.count ?? 0;
      })
      .toBe(1);
    await expectNoHorizontalOverflow(page);
    await activateLongDialogButton(
      createDialog.getByRole("button", { name: copy.common.done, exact: true }),
    );

    await apiConsoleTab(
      page,
      copy.tabs.ariaLabel,
      copy.tabs.endpoints,
    ).click();
    await expect(page.getByPlaceholder(copy.endpoints.search)).toBeVisible();
    await expect(page.getByLabel(copy.endpoints.filterAria)).toBeVisible();
    await expect(page.getByText(copy.endpoints.requiredScopes).first()).toBeVisible();
    await expect(page.getByText(copy.endpoints.requestContract).first()).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: copy.endpoints.codeLanguageAria }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: copy.endpoints.copyPath }).first(),
    ).toBeVisible();
    await expectNoGermanCopy(page, [
      german.endpoints.search,
      german.endpoints.requiredScopes,
      german.endpoints.requestContract,
      german.endpoints.codeLanguageAria,
    ]);
    await expectNoHorizontalOverflow(page);

    await apiConsoleTab(
      page,
      copy.tabs.ariaLabel,
      copy.tabs.webhooks,
    ).click();
    await expect(
      page.getByRole("heading", { name: copy.webhooks.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(webhookName, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(webhookUrl, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(webhookEvent, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    const deadLetters = page.getByTestId("webhook-dead-letter-section");
    await expect(
      deadLetters.getByRole("heading", {
        name: copy.deadLetters.title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(deadLetters.getByPlaceholder(copy.deadLetters.search)).toBeVisible();
    await expect(
      deadLetters.getByRole("button", { name: copy.deadLetters.refresh }),
    ).toBeVisible();
    await expectNoGermanCopy(page, [
      german.webhooks.description,
      german.deadLetters.title,
      german.deadLetters.description,
      german.deadLetters.search,
    ]);

    await deadLetters
      .getByRole("button", { name: copy.deadLetters.showDetails })
      .click();
    const deliveryDialog = page.getByRole("dialog", { name: webhookName });
    await expect(deliveryDialog).toBeVisible();
    await expect(
      deliveryDialog.getByText(webhookEvent, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      deliveryDialog.getByText(copy.deadLetters.attemptOf(6, 6), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      deliveryDialog.getByText(copy.deadLetters.failureKinds.http, {
        exact: true,
      }).first(),
    ).toBeVisible();
    const attemptHistory = deliveryDialog.getByTestId("webhook-attempt-history");
    await expect(
      attemptHistory.getByText(copy.deadLetters.history, { exact: true }),
    ).toBeVisible();
    await expect(
      attemptHistory.getByText(copy.deadLetters.entries(1), { exact: true }),
    ).toBeVisible();
    await expect(
      attemptHistory.getByText(copy.deadLetters.runAttempt(1, 6), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      attemptHistory.getByText(copy.deadLetters.outcomes.failed, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      attemptHistory.getByText(copy.deadLetters.responseRedacted, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      deliveryDialog.getByText(copy.deadLetters.safePayload, { exact: true }),
    ).toBeVisible();
    await expect(deliveryDialog.getByText("userField", { exact: true })).toBeVisible();
    await expect(deliveryDialog.getByText("sourceLabel", { exact: true })).toBeVisible();
    if (legacyGermanDeliverySummary) {
      await expect(deliveryDialog).not.toContainText(legacyGermanDeliverySummary);
    }
    await expectNoGermanCopy(page, [
      german.deadLetters.detailEyebrow,
      german.deadLetters.history,
      german.deadLetters.responseRedacted,
      german.deadLetters.safePayload,
    ]);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `api-console-dlq-${locale}-${testInfo.project.name}.png`,
      ),
      fullPage: testInfo.project.name !== "mobile",
    });
    await activateLongDialogButton(
      deliveryDialog.getByRole("button", {
        name: copy.deadLetters.close,
        exact: true,
      }),
    );

    await apiConsoleTab(
      page,
      copy.tabs.ariaLabel,
      copy.tabs.requests,
    ).click();
    await expect(
      page.getByRole("heading", { name: copy.requests.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(copy.requests.description, { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder(copy.requests.search)).toBeVisible();
    for (const heading of Object.values(copy.requests.columns)) {
      await expect(
        page.getByRole("columnheader", { name: heading, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByText(requestPath, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(apiKeyName, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(requestId, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoGermanCopy(page, [
      german.requests.title,
      german.requests.description,
      german.requests.search,
      german.requests.columns.time,
      german.requests.columns.requestId,
    ]);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `api-console-${locale}-${testInfo.project.name}.png`,
      ),
      fullPage: testInfo.project.name !== "mobile",
    });
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
