import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import postgres from "postgres";

import { getAiAdminCopy } from "../src/lib/i18n/ai-admin";
import { getAiManagerCopy } from "../src/lib/i18n/ai-manager";
import { getAiMemberCopy } from "../src/lib/i18n/ai-member";
import type { AppLocale } from "../src/lib/i18n/model";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(
  page: Page,
  origin: string,
  email: string,
  password: string,
  destination: "admin" | "academy",
) {
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .locator('form:has(input[name="email"]) button[type="submit"]')
    .click();
  await page.waitForURL(`**/${destination}`);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(1);
  expect(dimensions.body).toBeLessThanOrEqual(1);
}

async function createPublishedAgent(
  sql: ReturnType<typeof postgres>,
  input: {
    organizationId: string;
    ownerId: string;
    name: string;
    description: string;
  },
) {
  const agentId = randomUUID();
  const publishedVersionId = randomUUID();
  const draftVersionId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into ai_agents (
        id, organization_id, name, description, system_prompt, active,
        draft_version_id, published_version_id
      ) values (
        ${agentId}, ${input.organizationId}, ${input.name}, ${input.description},
        'User-authored system instruction', true,
        ${publishedVersionId}, null
      )
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, name, description,
        system_prompt, knowledge_mode, access_mode, created_by_id
      ) values (
        ${publishedVersionId}, ${input.organizationId}, ${agentId}, 1,
        'draft', ${input.name}, ${input.description},
        'User-authored system instruction', 'all_accessible_courses', 'open',
        ${input.ownerId}
      )
    `;
    await tx`
      update ai_agent_versions
      set state = 'published',
          published_at = now() - interval '1 day',
          updated_at = now() - interval '1 day'
      where id = ${publishedVersionId}
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, name, description,
        system_prompt, knowledge_mode, access_mode, created_by_id
      ) values (
        ${draftVersionId}, ${input.organizationId}, ${agentId}, 2, 'draft',
        ${input.name}, ${input.description}, 'User-authored system instruction',
        'all_accessible_courses', 'open', ${input.ownerId}
      )
    `;
    await tx`
      update ai_agents
      set draft_version_id = ${draftVersionId},
          published_version_id = ${publishedVersionId}
      where id = ${agentId}
    `;
  });
  return { agentId, publishedVersionId, draftVersionId };
}

test("AI administration and member workspace follow locale on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const desktop = testInfo.project.name === "chromium";
  const locale: AppLocale = desktop ? "en" : "it";
  const role = desktop ? "owner" : "member";
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const organizationSlug = `ai-locale-${locale}-${suffix}`;
  const origin = `http://${organizationSlug}.localhost:3000`;
  const email = `ai-${role}-${suffix}@example.test`;
  const password = `Ai-Locale-${suffix}!`;
  const agentName = `User Agent ${suffix}`;
  const agentDescription = `User-authored agent description ${suffix}`;

  try {
    const passwordHash = await hash(password, 8);
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId}, ${`AI Locale ${suffix}`}, ${organizationSlug},
        ${locale}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${userId}, ${organizationId}, ${email}, ${passwordHash},
        'User', ${`Sentinel ${suffix}`}, ${role}, 'active', ${locale}
      )
    `;

    if (desktop) {
      await createPublishedAgent(sql, {
        organizationId,
        ownerId: userId,
        name: agentName,
        description: agentDescription,
      });
      const copy = getAiAdminCopy(locale);
      const manager = getAiManagerCopy(locale);

      await login(page, origin, email, password, "admin");
      await page.goto(`${origin}/admin/ai`, { waitUntil: "networkidle" });

      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("heading", { name: copy.page.title, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(copy.page.description, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: copy.policy.title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: copy.review.title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: manager.studio.title, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(agentName, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(agentDescription, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: manager.create.button, exact: true }),
      ).toBeVisible();

      await page
        .getByRole("button", { name: manager.create.button, exact: true })
        .click();
      const createDialog = page.getByRole("dialog", {
        name: manager.create.title,
      });
      await expect(createDialog).toBeVisible();
      await expect(
        createDialog.getByPlaceholder(manager.create.namePlaceholder),
      ).toBeVisible();
      await expect(
        createDialog.getByPlaceholder(manager.create.systemPlaceholder),
      ).toBeVisible();
      await expect(createDialog.getByText(manager.create.info)).toBeVisible();
      await createDialog
        .getByRole("button", { name: manager.common.dialogClose })
        .click();

      await page
        .getByRole("button", { name: manager.row.editAria(agentName) })
        .click();
      const editor = page.getByRole("dialog", {
        name: manager.editor.editAria(agentName),
      });
      await expect(editor).toBeVisible();
      await expect(editor.getByText(manager.editor.basics, { exact: true }).last()).toBeVisible();
      await expect(editor.getByText(manager.editor.knowledge, { exact: true }).last()).toBeVisible();
      await expect(editor.getByText(manager.editor.access, { exact: true }).last()).toBeVisible();
      await expect(editor.getByText(manager.editor.actions, { exact: true }).last()).toBeVisible();
      for (const german of [
        "KI-Agenten freigeben",
        "Aktionsfreigaben",
        "Neuer Agent",
        "Basisdaten",
        "Wissensbasis",
        "Dialog schließen",
      ]) {
        await expect(page.locator("body")).not.toContainText(german);
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath("ai-admin-en-desktop.png"),
        fullPage: false,
      });
    } else {
      const memberCopy = getAiMemberCopy(locale);
      const agentId = randomUUID();
      const versionId = randomUUID();
      const conversationId = randomUUID();
      const now = "2026-07-13T10:00:00.000Z";
      const conversationTitle = `User conversation ${suffix}`;
      const userMessage = `User question ${suffix}`;
      const assistantMessage = `User-visible answer ${suffix}`;
      const sourceTitle = `User source ${suffix}`;

      await login(page, origin, email, password, "academy");
      await page.route("**/api/ai**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/ai/actions") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [] }),
          });
          return;
        }
        if (url.pathname === "/api/ai" && route.request().method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              agent: {
                id: agentId,
                name: agentName,
                description: agentDescription,
                color: "#2bb7a9",
                icon: "sparkles",
                type: "learning_coach",
                version: 1,
              },
              agents: [
                {
                  id: agentId,
                  name: agentName,
                  description: agentDescription,
                  color: "#2bb7a9",
                  icon: "sparkles",
                  type: "learning_coach",
                  version: 1,
                },
              ],
              conversations: [
                {
                  id: conversationId,
                  agentId,
                  agentVersionId: versionId,
                  memberId: userId,
                  title: conversationTitle,
                  status: "active",
                  messageCount: 2,
                  lastMessageAt: now,
                  metadata: {},
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              activeConversationId: conversationId,
              messages: [
                {
                  id: randomUUID(),
                  chatId: conversationId,
                  role: "user",
                  content: userMessage,
                  citations: [],
                  createdAt: now,
                },
                {
                  id: randomUUID(),
                  chatId: conversationId,
                  role: "assistant",
                  content: assistantMessage,
                  citations: [
                    { title: sourceTitle, href: "/academy/courses" },
                  ],
                  createdAt: now,
                },
              ],
              transparency: {
                required: false,
                acknowledgedAt: now,
                notice: {
                  version: 1,
                  digest: "fixture-digest",
                  title: "User-configured notice",
                  description: "User-configured description",
                  warning: "User-configured warning",
                  privacyPolicyUrl: null,
                  transparencyPolicyUrl: null,
                },
              },
            }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto(`${origin}/academy/ai`, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("heading", {
          name: memberCopy.workspace.history,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(agentName, { exact: true })).toBeVisible();
      await expect(page.getByText(conversationTitle, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(userMessage, { exact: true })).toBeVisible();
      await expect(page.getByText(assistantMessage, { exact: true })).toBeVisible();
      await expect(page.getByText(sourceTitle, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: memberCopy.workspace.newChat }),
      ).toBeVisible();
      for (const german of [
        "Verlauf wird geladen",
        "Noch keine Konversationen",
        "Neuer Chat",
        "Konversation wird geladen",
        "Nachricht senden",
      ]) {
        await expect(page.locator("body")).not.toContainText(german);
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath("ai-member-it-mobile.png"),
        fullPage: false,
      });
    }
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
