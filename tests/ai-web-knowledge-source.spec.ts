import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getAiAdminCopy } from "../src/lib/i18n/ai-admin";
import { getAiManagerCopy } from "../src/lib/i18n/ai-manager";
import { getCoreDictionary } from "../src/lib/i18n/dictionaries";

test.describe.configure({ mode: "serial" });

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const adminCopy = getAiAdminCopy("de");
const managerCopy = getAiManagerCopy("de");
const coreCopy = getCoreDictionary("de");

async function login(page: Page, email: string, organizationSlug: string) {
  await page.goto(`http://${organizationSlug}.localhost:3000/login`);
  await page.getByLabel(coreCopy.auth.email).fill(email);
  await page
    .getByLabel(coreCopy.auth.password, { exact: true })
    .fill("Demo123!");
  await page.getByRole("button", { name: /Bei .* anmelden/ }).click();
  await page.waitForURL("**/admin");
}

test("admin snapshots, previews, edits and publishes a public web source", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The isolated web snapshot lifecycle runs once on desktop Chromium.",
  );
  test.setTimeout(150_000);

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const organizationSlug = `agent-web-ui-${suffix}`;
  const ownerEmail = `agent-web-owner-${suffix}@example.test`;
  const agentName = `Web-Agent ${suffix}`;
  let organizationId = "";

  try {
    const [template] = await client<{ password_hash: string }[]>`
      select password_hash from users where email = 'lea@q-academy.de' limit 1
    `;
    const [organization] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Agent Web UI ${suffix}`}, ${organizationSlug})
      returning id
    `;
    organizationId = organization.id;
    await client`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${ownerEmail}, ${template.password_hash},
        'Web', 'Owner', 'owner', 'active'
      )
    `;

    await login(page, ownerEmail, organizationSlug);
    await page.goto(`http://${organizationSlug}.localhost:3000/admin/ai`);
    const createDialog = page.getByRole("dialog", {
      name: "KI-Agent erstellen",
    });
    await expect(async () => {
      await page.getByRole("button", { name: "Neuer Agent" }).click();
      await expect(createDialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await createDialog.getByLabel("Name").fill(agentName);
    await createDialog
      .getByLabel("Beschreibung")
      .fill("Antwortet aus einem gespeicherten oeffentlichen Web-Snapshot.");
    await createDialog
      .getByLabel("Systemanweisung")
      .fill(
        "Verwende ausschliesslich die freigegebenen gespeicherten Quellen.",
      );
    await createDialog.getByRole("button", { name: "Erstellen" }).click();
    await expect(createDialog.getByText("Erfolgreich erstellt")).toBeVisible();
    await createDialog.getByRole("button", { name: "Fertig" }).click();

    const agent = page
      .locator("article[id^='agent-']")
      .filter({ hasText: agentName });
    await agent
      .getByRole("button", { name: managerCopy.editor.editAria(agentName) })
      .click();
    let editor = page.getByRole("dialog", {
      name: managerCopy.editor.editAria(agentName),
    });
    await editor.getByLabel("Agententyp").selectOption("knowledge_assistant");
    await editor.getByLabel("Wissensmodus").selectOption("selected_sources");
    await editor.getByRole("button", { name: "Webquelle" }).click();
    await editor.getByLabel("Webadresse 1").fill("https://example.com/");
    await editor
      .getByRole("button", { name: managerCopy.editor.saveDraft })
      .click();
    await expect(
      page.getByText(adminCopy.messages.draftSaved, { exact: true }),
    ).toBeVisible();
    await expect(editor).not.toBeVisible();

    await agent
      .getByRole("button", { name: managerCopy.editor.editAria(agentName) })
      .click();
    editor = page.getByRole("dialog", {
      name: managerCopy.editor.editAria(agentName),
    });
    const snapshotPreview = editor.locator("details").filter({
      hasText: "Example Domain",
    });
    await expect(snapshotPreview).toBeVisible();
    await snapshotPreview.locator("summary").click();
    await expect(snapshotPreview).toContainText("SHA-256");
    await expect(snapshotPreview).toContainText(
      "This domain is for use in documentation examples",
    );

    const editedUrl = "https://example.com/?snapshot=2";
    const webUrlInput = editor.getByLabel("Webadresse 1");
    await webUrlInput.fill(editedUrl);
    await expect(webUrlInput).toHaveValue(editedUrl);
    await editor
      .getByRole("button", { name: managerCopy.editor.saveDraft })
      .click();
    await expect(editor).not.toBeVisible();

    const [draftSource] = await client<
      {
        source_url: string;
        title: string;
        content: string;
        content_digest: string;
        fetched_at: Date;
      }[]
    >`
      select source_url, title, content, content_digest, fetched_at
      from ai_agent_version_sources source
      join ai_agents agent on agent.draft_version_id = source.agent_version_id
      where agent.organization_id = ${organizationId}
        and source.source_type = 'web_url'
    `;
    expect(draftSource.source_url).toBe(editedUrl);
    expect(draftSource.title).toBe("Example Domain");
    expect(draftSource.content).toContain(
      "This domain is for use in documentation examples",
    );
    expect(draftSource.content_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(draftSource.fetched_at).toBeInstanceOf(Date);

    await agent
      .getByRole("button", { name: managerCopy.row.publishAria(agentName) })
      .click();
    const publication = page.getByRole("alertdialog", {
      name: managerCopy.publish.aria,
    });
    await publication.getByRole("checkbox").check();
    await publication
      .getByRole("button", { name: managerCopy.publish.submit })
      .click();
    await expect(
      page.getByText(adminCopy.messages.published(1), { exact: true }),
    ).toBeVisible();

    const versionSources = await client<
      {
        state: string;
        source_url: string;
        content_digest: string;
        fetched_at: Date;
      }[]
    >`
      select version.state::text as state, source.source_url,
             source.content_digest, source.fetched_at
      from ai_agent_version_sources source
      join ai_agent_versions version on version.id = source.agent_version_id
      where version.agent_id = (
        select id from ai_agents
        where organization_id = ${organizationId} and name = ${agentName}
      )
      order by version.version
    `;
    expect([...versionSources]).toEqual([
      {
        state: "published",
        source_url: editedUrl,
        content_digest: draftSource.content_digest,
        fetched_at: draftSource.fetched_at,
      },
      {
        state: "draft",
        source_url: editedUrl,
        content_digest: draftSource.content_digest,
        fetched_at: draftSource.fetched_at,
      },
    ]);
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});
