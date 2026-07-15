import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import {
  getAiAdminCopy,
  localizeAiAdminMessage,
} from "../src/lib/i18n/ai-admin";
import { getAiManagerCopy } from "../src/lib/i18n/ai-manager";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const adminCopy = getAiAdminCopy("de");
const managerCopy = getAiManagerCopy("de");

async function createVersionedAgent(
  client: ReturnType<typeof postgres>,
  input: {
    organizationId: string;
    createdById: string;
    name: string;
    active?: boolean;
    published?: boolean;
  },
) {
  const agentId = randomUUID();
  const firstVersionId = randomUUID();
  const nextDraftId = input.published === false ? null : randomUUID();
  await client.begin(async (tx) => {
    await tx`
      insert into ai_agents (
        id, organization_id, name, description, system_prompt, active,
        draft_version_id, published_version_id
      ) values (
        ${agentId}, ${input.organizationId}, ${input.name},
        'Versionierter Agent fuer den Integritaetstest.',
        'Arbeite nachvollziehbar mit den freigegebenen Lerninhalten.', false,
        ${firstVersionId}, null
      )
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, name, description,
        system_prompt, knowledge_mode, access_mode, created_by_id
      ) values (
        ${firstVersionId}, ${input.organizationId}, ${agentId}, 1, 'draft',
        ${input.name}, 'Versionierter Agent fuer den Integritaetstest.',
        'Arbeite nachvollziehbar mit den freigegebenen Lerninhalten.',
        'all_accessible_courses', 'open', ${input.createdById}
      )
    `;
    if (!nextDraftId) return;
    await tx`
      update ai_agent_versions
      set state = 'published', published_at = statement_timestamp(),
          updated_at = statement_timestamp()
      where id = ${firstVersionId}
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, name, description,
        system_prompt, knowledge_mode, access_mode, created_by_id
      ) values (
        ${nextDraftId}, ${input.organizationId}, ${agentId}, 2, 'draft',
        ${input.name}, 'Versionierter Agent fuer den Integritaetstest.',
        'Arbeite nachvollziehbar mit den freigegebenen Lerninhalten.',
        'all_accessible_courses', 'open', ${input.createdById}
      )
    `;
    await tx`
      update ai_agents
      set active = ${input.active !== false},
          draft_version_id = ${nextDraftId},
          published_version_id = ${firstVersionId}
      where id = ${agentId} and organization_id = ${input.organizationId}
    `;
  });
  return {
    id: agentId,
    publishedVersionId: nextDraftId ? firstVersionId : null,
    draftVersionId: nextDraftId ?? firstVersionId,
  };
}

async function login(
  page: Page,
  email: string,
  organizationSlug: string,
  destination: "/admin" | "/admin/courses" = "/admin",
) {
  await page.goto(`http://${organizationSlug}.localhost:3000/login`);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /Bei .* anmelden/ }).click();
  await page.waitForURL(
    `http://${organizationSlug}.localhost:3000${destination}`,
  );
}

async function loginAsDemoOwner(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function waitForAgentStudioHydration(page: Page, agentName: string) {
  const editor = page.getByRole("dialog", {
    name: `${agentName} bearbeiten`,
  });
  await expect(async () => {
    if (!(await editor.isVisible())) {
      await page
        .getByRole("button", { name: `${agentName} bearbeiten` })
        .click();
    }
    await expect(editor).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 10_000 });
  await editor
    .getByRole("button", { name: managerCopy.common.dialogClose })
    .click();
  await expect(editor).not.toBeVisible();
}

test("agent REST mutations preserve active coverage and conversation history", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused agent API integrity flow runs once",
  );
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const secret = `qak_test_${randomBytes(32).toString("base64url")}`;
  let organizationId = "";

  try {
    const [organization] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Agent API E2E ${suffix}`}, ${`agent-api-e2e-${suffix}`})
      returning id
    `;
    organizationId = organization.id;
    const [owner, member] = await client<{ id: string; role: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values
        (
          ${organizationId}, ${`agent-api-owner-${suffix}@example.com`}, 'unused',
          'API', 'Owner', 'owner', 'active'
        ),
        (
          ${organizationId}, ${`agent-api-member-${suffix}@example.com`}, 'unused',
          'API', 'Member', 'member', 'active'
        )
      returning id, role
    `;
    await client`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      )
      values (
        ${organizationId}, ${owner.id}, 'Agent integrity test', ${secret.slice(0, 20)},
        ${createHash("sha256").update(secret).digest("hex")},
        array['agents:write']
      )
    `;
    const soleAgent = await createVersionedAgent(client, {
      organizationId,
      createdById: owner.id,
      name: `API Sole ${suffix}`,
    });
    const historyAgent = await createVersionedAgent(client, {
      organizationId,
      createdById: owner.id,
      name: `API History ${suffix}`,
      active: false,
    });
    await client`
      insert into ai_conversations (
        organization_id, agent_id, agent_version_id, user_id, title
      ) values (
        ${organizationId}, ${historyAgent.id}, ${historyAgent.publishedVersionId},
        ${member.id}, 'API history'
      )
    `;
    const headers = {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    };

    const pauseLast = await request.patch(`/api/v1/agents/${soleAgent.id}`, {
      headers: { ...headers, "Idempotency-Key": `pause-${suffix}` },
      data: { active: false },
    });
    expect(pauseLast.status()).toBe(409);
    await expect(pauseLast.json()).resolves.toMatchObject({
      code: "conflict",
      errors: { reason: "last_active_agent" },
    });

    const deleteHistory = await request.delete(
      `/api/v1/agents/${historyAgent.id}`,
      { headers: { ...headers, "Idempotency-Key": `history-${suffix}` } },
    );
    expect(deleteHistory.status()).toBe(409);
    await expect(deleteHistory.json()).resolves.toMatchObject({
      code: "conflict",
      errors: { reason: "agent_in_use", conversationCount: 1 },
    });

    const safeAgent = await createVersionedAgent(client, {
      organizationId,
      createdById: owner.id,
      name: `API Draft ${suffix}`,
      published: false,
    });
    const deleteSafe = await request.delete(`/api/v1/agents/${safeAgent.id}`, {
      headers: { ...headers, "Idempotency-Key": `safe-${suffix}` },
    });
    expect(deleteSafe.status()).toBe(200);
    await expect(deleteSafe.json()).resolves.toMatchObject({
      data: { id: safeAgent.id, deleted: true },
    });

    const [stored] = await client<
      { sole_active: boolean; history_count: number; safe_count: number }[]
    >`
      select
        (select active from ai_agents where id = ${soleAgent.id}) as sole_active,
        (select count(*)::int from ai_conversations where agent_id = ${historyAgent.id}) as history_count,
        (select count(*)::int from ai_agents where id = ${safeAgent.id}) as safe_count
    `;
    expect(stored).toEqual({
      sole_active: true,
      history_count: 1,
      safe_count: 0,
    });
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});

test("owner manages agents while usage and availability remain protected", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused AI-agent lifecycle runs once on desktop Chromium",
  );
  test.setTimeout(90_000);

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ownerEmail = `ai-owner-${suffix}@example.com`;
  const trainerEmail = `ai-trainer-${suffix}@example.com`;
  const organizationSlug = `ai-agent-e2e-${suffix}`;
  const organizationOrigin = `http://${organizationSlug}.localhost:3000`;
  const soleName = `Sole Coach ${suffix}`;
  const historyName = `History Coach ${suffix}`;
  const alternativeName = `Transfer Coach ${suffix}`;
  let organizationId = "";
  let alternativeId = "";

  try {
    const [template] = await client<{ password_hash: string }[]>`
      select password_hash
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    expect(template).toBeTruthy();

    const [organization] = await client<{ id: string }[]>`
      insert into organizations (name, slug, description)
      values (
        ${`AI Agent E2E ${suffix}`},
        ${organizationSlug},
        'Isolierter Mandant fuer die Agentenverwaltung.'
      )
      returning id
    `;
    organizationId = organization.id;

    const createdUsers = await client<{ id: string; role: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values
        (
          ${organizationId}, ${ownerEmail}, ${template.password_hash},
          'Owner', 'Agententest', 'owner', 'active'
        ),
        (
          ${organizationId}, ${trainerEmail}, ${template.password_hash},
          'Trainer', 'Agententest', 'trainer', 'active'
        ),
        (
          ${organizationId}, ${`ai-member-${suffix}@example.com`}, ${template.password_hash},
          'Member', 'Agententest', 'member', 'active'
        )
      returning id, role
    `;
    const memberId = createdUsers.find((user) => user.role === "member")?.id;
    const ownerId = createdUsers.find((user) => user.role === "owner")?.id;
    expect(memberId).toBeTruthy();
    expect(ownerId).toBeTruthy();
    if (!memberId || !ownerId) {
      throw new Error("Owner/member fixture could not be created.");
    }

    await createVersionedAgent(client, {
      organizationId,
      createdById: ownerId,
      name: soleName,
    });
    const historyAgent = await createVersionedAgent(client, {
      organizationId,
      createdById: ownerId,
      name: historyName,
      active: false,
    });

    await client`
      insert into ai_conversations (
        organization_id, agent_id, agent_version_id, user_id, title, status,
        message_count
      ) values (
        ${organizationId}, ${historyAgent.id}, ${historyAgent.publishedVersionId},
        ${memberId},
        'Geschuetzter E2E-Verlauf', 'archived', 0
      )
    `;

    await login(page, ownerEmail, organizationSlug);
    await page.goto(`${organizationOrigin}/admin/ai`);
    await expect(
      page.getByRole("heading", { name: adminCopy.page.title }),
    ).toBeVisible();
    await waitForAgentStudioHydration(page, soleName);

    await page.getByRole("button", { name: `${soleName} pausieren` }).click();
    await expect(
      page.getByText(
        localizeAiAdminMessage("de", {
          ok: false,
          messageCode: "lastActivePause",
        }),
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByRole("button", { name: managerCopy.row.deleteAria(soleName) })
      .click();
    let deleteDialog = page.getByRole("alertdialog", {
      name: managerCopy.deletion.aria,
    });
    await deleteDialog
      .getByLabel(managerCopy.deletion.confirmation)
      .fill(soleName);
    await deleteDialog
      .getByRole("button", { name: managerCopy.deletion.submit })
      .click();
    await expect(
      deleteDialog.getByText(
        localizeAiAdminMessage("de", {
          ok: false,
          messageCode: "publishedDelete",
        }),
        { exact: true },
      ),
    ).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: managerCopy.common.dialogClose })
      .click();

    await page
      .getByRole("button", { name: managerCopy.row.deleteAria(historyName) })
      .click();
    deleteDialog = page.getByRole("alertdialog", {
      name: managerCopy.deletion.aria,
    });
    await deleteDialog
      .getByLabel(managerCopy.deletion.confirmation)
      .fill(historyName);
    await deleteDialog
      .getByRole("button", { name: managerCopy.deletion.submit })
      .click();
    await expect(
      deleteDialog.getByText(/hat 1 gespeicherte Konversation/),
    ).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: managerCopy.common.dialogClose })
      .click();

    const alternative = await createVersionedAgent(client, {
      organizationId,
      createdById: ownerId,
      name: alternativeName,
    });
    alternativeId = alternative.id;
    await page.reload();

    const row = page.locator(`#agent-${alternativeId}`);
    await expect(row).toContainText(alternativeName);
    await waitForAgentStudioHydration(page, alternativeName);
    await row.getByRole("button", { name: `${alternativeName} pausieren` }).click();
    await expect(
      page.getByText(
        localizeAiAdminMessage("de", {
          ok: true,
          messageCode: "agentStatusChanged",
          messageParams: { name: alternativeName, active: false },
        }),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(row).toContainText(managerCopy.common.livePaused);

    await row.getByRole("button", { name: `${alternativeName} aktivieren` }).click();
    await expect(
      page.getByText(
        localizeAiAdminMessage("de", {
          ok: true,
          messageCode: "agentStatusChanged",
          messageParams: { name: alternativeName, active: true },
        }),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(row).toContainText(managerCopy.common.liveActive);

    await row
      .getByRole("button", {
        name: managerCopy.row.deleteAria(alternativeName),
      })
      .click();
    deleteDialog = page.getByRole("alertdialog", {
      name: managerCopy.deletion.aria,
    });
    const deleteButton = deleteDialog.getByRole("button", {
      name: managerCopy.deletion.submit,
    });
    await expect(deleteButton).toBeDisabled();
    await deleteDialog
      .getByLabel(managerCopy.deletion.confirmation)
      .fill(alternativeName);
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect(
      deleteDialog.getByText(
        localizeAiAdminMessage("de", {
          ok: false,
          messageCode: "publishedDelete",
        }),
        { exact: true },
      ),
    ).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: managerCopy.common.dialogClose })
      .click();
    await expect(page.locator(`#agent-${alternativeId}`)).toHaveCount(1);

    const [storedAlternative] = await client<{ value: number }[]>`
      select count(*)::int as value from ai_agents where id = ${alternativeId}
    `;
    expect(storedAlternative.value).toBe(1);
    const lifecycleEvents = await client<{ type: string }[]>`
      select type from activity_events
      where organization_id = ${organizationId}
        and entity_id = ${alternativeId}
      order by created_at
    `;
    expect(lifecycleEvents.map((event) => event.type)).toEqual([
      "agent.deactivated",
      "agent.activated",
    ]);

    await page.context().clearCookies();
    await login(page, trainerEmail, organizationSlug, "/admin/courses");
    await page.goto(`${organizationOrigin}/admin/ai`);
    await expect(page).toHaveURL(`${organizationOrigin}/admin/courses`);
    await expect(
      page.getByRole("button", { name: managerCopy.create.button }),
    ).toHaveCount(0);
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});

test("AI-agent management dialogs fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only layout assertion");
  await loginAsDemoOwner(page);
  await page.goto("/admin/ai");

  const editButton = page.getByRole("button", { name: / bearbeiten$/ }).first();
  await editButton.click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const editBox = await editDialog.boundingBox();
  expect(editBox).toBeTruthy();
  expect(editBox!.x).toBeGreaterThanOrEqual(0);
  expect(editBox!.x + editBox!.width).toBeLessThanOrEqual(413);
  await page.screenshot({
    path: testInfo.outputPath("ai-agent-edit-mobile.png"),
    fullPage: false,
  });
  await editDialog
    .getByRole("button", { name: managerCopy.common.dialogClose })
    .click();

  await page.getByRole("button", { name: / löschen$/ }).first().click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: managerCopy.deletion.aria,
  });
  await expect(deleteDialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const deleteBox = await deleteDialog.boundingBox();
  expect(deleteBox).toBeTruthy();
  expect(deleteBox!.x).toBeGreaterThanOrEqual(0);
  expect(deleteBox!.x + deleteBox!.width).toBeLessThanOrEqual(413);
});
