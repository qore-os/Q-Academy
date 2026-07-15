import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getAiAdminCopy } from "../src/lib/i18n/ai-admin";
import { getAiManagerCopy } from "../src/lib/i18n/ai-manager";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const adminCopy = getAiAdminCopy("de");
const managerCopy = getAiManagerCopy("de");

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const editButtonPattern = new RegExp(
  `${escapeRegex(managerCopy.row.editAria(""))}$`,
);
const publishButtonPattern = new RegExp(
  `${escapeRegex(managerCopy.row.publishAria(""))}$`,
);

async function loginAsDemoOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

async function login(page: Page, email: string, organizationSlug: string) {
  await page.goto(`http://${organizationSlug}.localhost:3000/login`);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /Bei .* anmelden/ }).click();
  await page.waitForURL("**/admin");
}

test("agent studio renders structured draft controls and confirmed publication", async ({
  page,
}) => {
  await loginAsDemoOwner(page);
  await page.goto("/admin/ai");

  await expect(
    page.getByRole("heading", { name: managerCopy.studio.title }),
  ).toBeVisible();
  const firstAgent = page.locator("article[id^='agent-']").first();
  await expect(firstAgent).toContainText(managerCopy.row.draft);
  await expect(firstAgent).toContainText(managerCopy.row.live);

  await firstAgent.getByRole("button", { name: editButtonPattern }).click();
  const editor = page.getByRole("dialog", { name: editButtonPattern });
  await expect(editor.getByLabel(managerCopy.editor.agentType)).toBeVisible();
  await editor
    .getByLabel(managerCopy.editor.knowledgeMode)
    .selectOption("selected_sources");
  await expect(
    editor.getByText(managerCopy.editor.publishedCourses, { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByText(managerCopy.editor.manualSources, { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByText(managerCopy.editor.mediaSources, { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByText(managerCopy.editor.webSnapshots, { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: managerCopy.editor.addWebSource }),
  ).toBeVisible();
  await editor
    .getByLabel(managerCopy.editor.accessMode)
    .selectOption("restricted");
  await expect(
    editor.getByText(managerCopy.editor.roles, { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("heading", {
      name: managerCopy.editor.members,
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await editor
    .getByRole("button", { name: managerCopy.common.dialogClose })
    .click();

  await firstAgent.getByRole("button", { name: publishButtonPattern }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: managerCopy.publish.aria,
  });
  const publish = confirmation.getByRole("button", {
    name: managerCopy.publish.submit,
  });
  await expect(publish).toBeDisabled();
  await confirmation.getByRole("checkbox").check();
  await expect(publish).toBeEnabled();
  await confirmation
    .getByRole("button", { name: managerCopy.common.dialogClose })
    .click();
});

test("agent studio persists structured drafts, publishes versions and rolls back", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The isolated version lifecycle runs once on desktop Chromium.",
  );
  test.setTimeout(90_000);

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const organizationSlug = `agent-studio-ui-${suffix}`;
  const organizationOrigin = `http://${organizationSlug}.localhost:3000`;
  const ownerEmail = `agent-studio-owner-${suffix}@example.com`;
  const agentName = `Transfer-Agent ${suffix}`;
  let organizationId = "";

  try {
    const [template] = await client<{ password_hash: string }[]>`
      select password_hash from users where email = 'lea@q-academy.de' limit 1
    `;
    const [organization] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Agent Studio UI ${suffix}`}, ${organizationSlug})
      returning id
    `;
    organizationId = organization.id;
    await client`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${ownerEmail}, ${template.password_hash},
        'Studio', 'Owner', 'owner', 'active'
      )
    `;

    await login(page, ownerEmail, organizationSlug);
    await page.goto(`${organizationOrigin}/admin/ai`);
    const createDialog = page.getByRole("dialog", {
      name: managerCopy.create.title,
    });
    await expect(async () => {
      await page
        .getByRole("button", { name: managerCopy.create.button })
        .click();
      await expect(createDialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await createDialog.getByLabel(managerCopy.create.name).fill(agentName);
    await createDialog
      .getByLabel(managerCopy.common.description)
      .fill("Begleitet den Transfer in die taegliche Praxis.");
    await createDialog
      .getByLabel(managerCopy.create.systemPrompt)
      .fill(
        "Arbeite ausschliesslich mit den kuratierten und freigegebenen Quellen.",
      );
    await createDialog
      .getByRole("button", { name: managerCopy.create.submit })
      .click();
    await expect(
      createDialog.getByText(managerCopy.create.success),
    ).toBeVisible();
    await createDialog
      .getByRole("button", { name: managerCopy.create.done })
      .click();

    let agent = page
      .locator("article[id^='agent-']")
      .filter({ hasText: agentName });
    await expect(agent).toContainText(managerCopy.common.draftOnly);
    await expect(
      agent.getByRole("button", {
        name: managerCopy.row.unavailableToggleAria(agentName),
      }),
    ).toBeDisabled();

    await agent
      .getByRole("button", { name: managerCopy.row.editAria(agentName) })
      .click();
    let editor = page.getByRole("dialog", {
      name: managerCopy.editor.editAria(agentName),
    });
    await editor
      .getByLabel(managerCopy.editor.agentType)
      .selectOption("knowledge_assistant");
    await editor
      .getByLabel(managerCopy.editor.knowledgeMode)
      .selectOption("selected_sources");
    await editor
      .getByRole("button", { name: managerCopy.editor.addTextSource })
      .click();
    await editor
      .getByLabel(managerCopy.editor.sourceTitle(1))
      .fill("Transferleitlinie");
    await editor
      .getByLabel(managerCopy.editor.curatedText)
      .fill(
        "Stelle konkrete Reflexionsfragen und erfinde keine fachlichen Aussagen.",
      );
    await editor
      .getByLabel(managerCopy.editor.accessMode)
      .selectOption("restricted");
    await editor
      .getByRole("checkbox", { name: managerCopy.roles.member, exact: true })
      .check();
    await editor
      .getByRole("button", { name: managerCopy.editor.saveDraft })
      .click();
    await expect(
      page.getByText(adminCopy.messages.draftSaved, { exact: true }),
    ).toBeVisible();
    await expect(editor).not.toBeVisible();

    const [storedDraft] = await client<
      {
        agent_id: string;
        version: number;
        draft_revision: number;
        source_type: string;
        source_title: string;
        source_content: string;
        subject_role: string;
      }[]
    >`
      select
        a.id as agent_id,
        v.version,
        v.draft_revision,
        s.source_type,
        s.title as source_title,
        s.content as source_content,
        g.subject_role
      from ai_agents a
      join ai_agent_versions v on v.id = a.draft_version_id
      join ai_agent_version_sources s on s.agent_version_id = v.id
      join ai_agent_version_access_grants g on g.agent_version_id = v.id
      where a.organization_id = ${organizationId} and a.name = ${agentName}
    `;
    expect(storedDraft).toMatchObject({
      version: 1,
      draft_revision: 2,
      source_type: "manual_text",
      source_title: "Transferleitlinie",
      subject_role: "member",
    });
    expect(storedDraft.source_content).not.toHaveLength(0);

    agent = page.locator(`#agent-${storedDraft.agent_id}`);
    await agent
      .getByRole("button", { name: managerCopy.row.publishAria(agentName) })
      .click();
    let publication = page.getByRole("alertdialog", {
      name: managerCopy.publish.aria,
    });
    await publication.getByRole("checkbox").check();
    await publication
      .getByRole("button", { name: managerCopy.publish.submit })
      .click();
    await expect(
      page.getByText(adminCopy.messages.published(1), { exact: true }),
    ).toBeVisible();
    await expect(agent).toContainText(`${managerCopy.common.version} 2`);
    await expect(agent).toContainText(`${managerCopy.common.version} 1`);

    await agent
      .getByRole("button", { name: managerCopy.row.editAria(agentName) })
      .click();
    editor = page.getByRole("dialog", {
      name: managerCopy.editor.editAria(agentName),
    });
    await editor
      .getByLabel(managerCopy.editor.agentType)
      .selectOption("form_assistant");
    await editor
      .getByRole("button", { name: managerCopy.editor.saveDraft })
      .click();
    await expect(
      page.getByText(adminCopy.messages.draftSaved, { exact: true }),
    ).toBeVisible();
    await agent
      .getByRole("button", { name: managerCopy.row.publishAria(agentName) })
      .click();
    publication = page.getByRole("alertdialog", {
      name: managerCopy.publish.aria,
    });
    await publication.getByRole("checkbox").check();
    await publication
      .getByRole("button", { name: managerCopy.publish.submit })
      .click();
    await expect(
      page.getByText(adminCopy.messages.published(2), { exact: true }),
    ).toBeVisible();

    await agent
      .getByRole("button", { name: managerCopy.row.editAria(agentName) })
      .click();
    editor = page.getByRole("dialog", {
      name: managerCopy.editor.editAria(agentName),
    });
    await editor
      .getByRole("button", { name: managerCopy.editor.restore })
      .click();
    const rollback = page.getByRole("alertdialog", {
      name: managerCopy.rollback.aria,
    });
    await rollback.getByRole("checkbox").check();
    await rollback
      .getByRole("button", { name: managerCopy.rollback.submit })
      .click();
    await expect(
      page.getByText(adminCopy.messages.rolledBack(1), { exact: true }),
    ).toBeVisible();

    const [versionState] = await client<
      {
        published_version: number;
        draft_version: number;
        rollback_events: number;
      }[]
    >`
      select
        published.version as published_version,
        draft.version as draft_version,
        (
          select count(*)::int from activity_events e
          where e.organization_id = a.organization_id
            and e.entity_id = a.id
            and e.type = 'agent.version.rolled_back'
        ) as rollback_events
      from ai_agents a
      join ai_agent_versions published on published.id = a.published_version_id
      join ai_agent_versions draft on draft.id = a.draft_version_id
      where a.id = ${storedDraft.agent_id}
    `;
    expect(versionState).toEqual({
      published_version: 1,
      draft_version: 3,
      rollback_events: 1,
    });
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});
