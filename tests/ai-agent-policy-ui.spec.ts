import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { acknowledgeAiTransparency } from "./helpers/ai-transparency";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const rateLimitSecret =
  process.env.AUTH_RATE_LIMIT_SECRET?.trim() ||
  process.env.SESSION_SECRET?.trim() ||
  "q-academy-local-development-secret-change-me";

function creditKeyHash(action: string, identifier: string) {
  return createHmac("sha256", rateLimitSecret)
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL(/\/admin(?:\/.*)?$/);
}

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL(/\/academy(?:\/.*)?$/);
}

test("AI policy is accessible, responsive and blocks member provider egress", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Policy lifecycle runs once.");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const startedAt = new Date();
  let fixture!: { organizationId: string; memberId: string; adminId: string };
  let originalPolicy: { value: unknown; updatedAt: Date } | undefined;
  let originalCreditRows: Array<{
    action: string;
    keyHash: string;
    attempts: number;
    resetAt: Date;
    updatedAt: Date;
  }> = [];
  let creditKeys: Array<{ action: string; keyHash: string }> = [];
  let conversationsBefore = new Set<string>();
  let persistenceBefore!: { conversations: number; messages: number };
  let mobileContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let memberContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;

  try {
    const [loadedFixture] = await sql<
      Array<{ organizationId: string; memberId: string; adminId: string }>
    >`
      select organization.id as "organizationId", member.id as "memberId",
             administrator.id as "adminId"
      from organizations as organization
      join users as member
        on member.organization_id = organization.id
       and member.role = 'member'
       and member.status = 'active'
       and member.email = 'lea@q-academy.de'
      join users as administrator
        on administrator.organization_id = organization.id
       and administrator.status = 'active'
       and administrator.email = 'admin@q-academy.de'
      where organization.slug = 'q-academy'
      limit 1
    `;
    if (!loadedFixture) throw new Error("Demo policy fixture is missing.");
    fixture = loadedFixture;
    [originalPolicy] = await sql<
      Array<{ value: unknown; updatedAt: Date }>
    >`
      select value, updated_at as "updatedAt"
      from platform_settings
      where organization_id = ${fixture.organizationId}
        and key = 'ai_agent_policy'
    `;
    const conversationRows = await sql<Array<{ id: string }>>`
      select id from ai_conversations
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.memberId}
    `;
    conversationsBefore = new Set(conversationRows.map((row) => row.id));
    [persistenceBefore] = await sql<
      Array<{ conversations: number; messages: number }>
    >`
      select
        count(distinct conversation.id)::int as conversations,
        count(message.id)::int as messages
      from ai_conversations as conversation
      left join ai_messages as message
        on message.conversation_id = conversation.id
       and message.organization_id = conversation.organization_id
      where conversation.organization_id = ${fixture.organizationId}
        and conversation.user_id = ${fixture.memberId}
    `;
    creditKeys = [
      {
        action: "ai_agent_monthly_credits",
        keyHash: creditKeyHash(
          "ai_agent_monthly_credits",
          fixture.organizationId,
        ),
      },
      {
        action: "ai_agent_member_hourly",
        keyHash: creditKeyHash(
          "ai_agent_member_hourly",
          `${fixture.organizationId}\0${fixture.memberId}`,
        ),
      },
    ];
    originalCreditRows = await sql<
      typeof originalCreditRows
    >`
      select action, key_hash as "keyHash", attempts,
             reset_at as "resetAt", updated_at as "updatedAt"
      from auth_rate_limits
      where (action, key_hash) in (
        (${creditKeys[0]!.action}, ${creditKeys[0]!.keyHash}),
        (${creditKeys[1]!.action}, ${creditKeys[1]!.keyHash})
      )
    `;
    await sql`
      delete from auth_rate_limits
      where (action, key_hash) in (
        (${creditKeys[0]!.action}, ${creditKeys[0]!.keyHash}),
        (${creditKeys[1]!.action}, ${creditKeys[1]!.keyHash})
      )
    `;
  } catch (error) {
    await sql.end();
    throw error;
  }

  try {
    await loginAsAdmin(page);
    await page.goto("/admin/ai");
    await expect(
      page.getByRole("heading", { name: "KI-Policy und Credits" }),
    ).toBeVisible();

    const enabled = page.locator('input[name="enabled"]');
    const monthly = page.getByLabel("Credits pro Monat");
    const hourlyToggle = page.locator('input[name="hourlyEnabled"]');
    const hourly = page.getByLabel("Credits pro Mitglied und Stunde");
    await monthly.fill("99");
    await expect
      .poll(() => monthly.evaluate((input) => (input as HTMLInputElement).checkValidity()))
      .toBe(false);

    await monthly.fill("12300");
    await hourlyToggle.check();
    await expect(hourly).toBeEnabled();
    await hourly.fill("1");
    await enabled.check();
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(
      page.getByText(/KI-Policy (?:gespeichert|ist bereits aktuell)\./),
    ).toBeVisible();

    await page.reload();
    await expect(enabled).toBeChecked();
    await expect(monthly).toHaveValue("12300");
    await expect(hourlyToggle).toBeChecked();
    await expect(hourly).toHaveValue("1");
    await expect(page.getByText("Nutzung", { exact: true })).toBeVisible();
    const visibleText = await page.locator("main").innerText();
    expect(visibleText).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );

    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAsMember(memberPage);
    await acknowledgeAiTransparency(memberPage);
    const completed = await memberPage.request.post("/api/ai", {
      data: { message: "Gib mir einen kurzen Lerntipp." },
    });
    expect(completed.status()).toBe(200);
    const limited = await memberPage.request.post("/api/ai", {
      data: { message: "Diese zweite Anfrage muss am Stundenlimit stoppen." },
    });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    const [persistenceAfterLimit] = await sql<
      Array<{ conversations: number; messages: number }>
    >`
      select
        count(distinct conversation.id)::int as conversations,
        count(message.id)::int as messages
      from ai_conversations as conversation
      left join ai_messages as message
        on message.conversation_id = conversation.id
       and message.organization_id = conversation.organization_id
      where conversation.organization_id = ${fixture.organizationId}
        and conversation.user_id = ${fixture.memberId}
    `;
    expect(persistenceAfterLimit).toEqual({
      conversations: persistenceBefore.conversations + 1,
      messages: persistenceBefore.messages + 2,
    });

    await page.goto("/admin/ai");
    await enabled.uncheck();
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("KI-Policy gespeichert.")).toBeVisible();
    await page.reload();
    await expect(enabled).not.toBeChecked();
    const desktopScreenshot = testInfo.outputPath("ai-policy-desktop.png");
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    await testInfo.attach("AI policy desktop", {
      path: desktopScreenshot,
      contentType: "image/png",
    });

    const blocked = await memberPage.request.post("/api/ai", {
      data: { message: "Diese Anfrage darf keinen Provider erreichen." },
    });
    expect(blocked.status()).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      code: "forbidden",
    });
    const [persistenceAfter] = await sql<
      Array<{ conversations: number; messages: number }>
    >`
      select
        count(distinct conversation.id)::int as conversations,
        count(message.id)::int as messages
      from ai_conversations as conversation
      left join ai_messages as message
        on message.conversation_id = conversation.id
       and message.organization_id = conversation.organization_id
      where conversation.organization_id = ${fixture.organizationId}
        and conversation.user_id = ${fixture.memberId}
    `;
    expect(persistenceAfter).toEqual(persistenceAfterLimit);

    mobileContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    await loginAsAdmin(mobilePage);
    await mobilePage.goto("/admin/ai");
    await expect(
      mobilePage.getByRole("heading", { name: "KI-Policy und Credits" }),
    ).toBeVisible();
    await expect(
      mobilePage.getByLabel("Credits pro Mitglied und Stunde"),
    ).toBeVisible();
    expect(
      await mobilePage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    const mobileScreenshot = testInfo.outputPath("ai-policy-mobile.png");
    await mobilePage.screenshot({ path: mobileScreenshot, fullPage: true });
    await testInfo.attach("AI policy mobile", {
      path: mobileScreenshot,
      contentType: "image/png",
    });
  } finally {
    await memberContext?.close();
    await mobileContext?.close();
    if (originalPolicy) {
      await sql`
        insert into platform_settings (
          organization_id, key, value, updated_at
        ) values (
          ${fixture.organizationId}, 'ai_agent_policy',
          ${sql.json(originalPolicy.value as never)}, ${originalPolicy.updatedAt}
        )
        on conflict (organization_id, key) do update set
          value = excluded.value,
          updated_at = excluded.updated_at
      `;
    } else {
      await sql`
        delete from platform_settings
        where organization_id = ${fixture.organizationId}
          and key = 'ai_agent_policy'
      `;
    }
    await sql`
      delete from activity_events
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.adminId}
        and type = 'ai.agent_policy.updated'
        and created_at >= ${startedAt}
    `;
    const conversationsAfter = await sql<Array<{ id: string }>>`
      select id from ai_conversations
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.memberId}
    `;
    const addedConversationIds = conversationsAfter
      .map((row) => row.id)
      .filter((id) => !conversationsBefore.has(id));
    if (addedConversationIds.length) {
      await sql`
        delete from ai_conversations
        where id = any(${addedConversationIds}::uuid[])
      `;
    }
    if (creditKeys.length === 2) {
      await sql`
        delete from auth_rate_limits
        where (action, key_hash) in (
          (${creditKeys[0]!.action}, ${creditKeys[0]!.keyHash}),
          (${creditKeys[1]!.action}, ${creditKeys[1]!.keyHash})
        )
      `;
      for (const row of originalCreditRows) {
        await sql`
          insert into auth_rate_limits (
            action, key_hash, attempts, reset_at, updated_at
          ) values (
            ${row.action}, ${row.keyHash}, ${row.attempts},
            ${row.resetAt}, ${row.updatedAt}
          )
          on conflict (action, key_hash) do update set
            attempts = excluded.attempts,
            reset_at = excluded.reset_at,
            updated_at = excluded.updated_at
        `;
      }
    }
    await sql.end();
  }
});
