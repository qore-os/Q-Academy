import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { getAiMemberCopy } from "../src/lib/i18n/ai-member";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("hub embeds only a published tenant agent and fails closed after revocation", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused Hub agent lifecycle runs once on desktop.",
  );
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { max: 3, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const widgetTitle = `Hub Coach ${suffix}`;
  const hubSlug = `agent-hub-${suffix}`;
  const apiSlug = `agent-hub-api-${suffix}`;
  const cloneKey = `agent-hub-clone-${suffix}`;
  const createKey = `agent-hub-create-${suffix}`;
  const invalidKey = `agent-hub-invalid-${suffix}`;
  const patchKey = `agent-hub-patch-${suffix}`;
  const requestIds = Array.from({ length: 4 }, () => randomUUID());
  const hubIds: string[] = [];
  let agentId = "";
  let memberContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;

  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        agentId: string;
        agentName: string;
        systemPrompt: string;
      }>
    >`
      select organization.id as "organizationId", agent.id as "agentId",
             version.name as "agentName", version.system_prompt as "systemPrompt"
      from organizations as organization
      join ai_agents as agent
        on agent.organization_id = organization.id
       and agent.active = true
       and agent.published_version_id is not null
      join ai_agent_versions as version
        on version.id = agent.published_version_id
       and version.agent_id = agent.id
       and version.organization_id = organization.id
       and version.state = 'published'
       and version.access_mode = 'open'
      where organization.slug = 'q-academy'
      order by version.name, agent.id
      limit 1
    `;
    expect(fixture).toBeTruthy();
    agentId = fixture.agentId;

    const [hub] = await sql<Array<{ id: string }>>`
      insert into hubs (
        organization_id, title, slug, description, status, layout
      ) values (
        ${fixture.organizationId}, ${`Agent Hub ${suffix}`}, ${hubSlug},
        'Sicher eingebetteter Lernbegleiter.', 'draft', '[]'::jsonb
      )
      returning id
    `;
    hubIds.push(hub.id);

    const headers = (key: string, requestId: string) => ({
      Authorization: `Bearer ${demoKey}`,
      "Idempotency-Key": key,
      "X-Request-Id": requestId,
    });
    const apiWidget = {
      type: "ai_agent",
      title: widgetTitle,
      description: "API Agent Widget",
      color: "#2bb7a9",
      agentId: fixture.agentId,
    };
    const created = await request.post("/api/v1/hubs", {
      headers: headers(createKey, requestIds[0]!),
      data: {
        title: `API Agent Hub ${suffix}`,
        slug: apiSlug,
        status: "draft",
        layout: [{ id: "agent-row", columns: [apiWidget] }],
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; layout: unknown };
    };
    hubIds.push(createdBody.data.id);
    expect(createdBody.data.layout).toEqual([
      { id: "agent-row", columns: [apiWidget] },
    ]);
    expect(JSON.stringify(createdBody)).not.toContain(fixture.systemPrompt);

    const invalid = await request.post("/api/v1/hubs", {
      headers: headers(invalidKey, requestIds[1]!),
      data: {
        title: `Invalid Agent Hub ${suffix}`,
        slug: `invalid-agent-hub-${suffix}`,
        layout: [
          {
            id: "invalid-row",
            columns: [
              { type: "ai_agent", title: "Unbekannt", agentId: randomUUID() },
            ],
          },
        ],
      },
    });
    expect(invalid.status()).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "validation_error",
    });

    await sql`
      update hubs
      set layout = ${sql.json([
        {
          id: "agent-row",
          columns: [
            {
              ...apiWidget,
              systemPrompt: fixture.systemPrompt,
              sources: [{ content: "PRIVILEGED SOURCE" }],
              accessGrants: [{ subjectRole: "owner" }],
            },
          ],
        },
      ])}
      where id = ${createdBody.data.id}
    `;
    const safeRead = await request.get(`/api/v1/hubs/${createdBody.data.id}`, {
      headers: { Authorization: `Bearer ${demoKey}` },
    });
    expect(safeRead.status()).toBe(200);
    const safeReadText = await safeRead.text();
    expect(safeReadText).not.toContain(fixture.systemPrompt);
    expect(safeReadText).not.toContain("PRIVILEGED SOURCE");
    expect(safeReadText).not.toContain("accessGrants");

    const cloned = await request.post(
      `/api/v1/hubs/${createdBody.data.id}/clone`,
      {
        headers: headers(cloneKey, requestIds[2]!),
        data: { title: `Safe Agent Hub Clone ${suffix}` },
      },
    );
    expect(cloned.status()).toBe(201);
    const clonedBody = (await cloned.json()) as {
      data: { id: string; layout: unknown };
    };
    hubIds.push(clonedBody.data.id);
    expect(clonedBody.data.layout).toEqual([
      { id: "agent-row", columns: [apiWidget] },
    ]);
    expect(JSON.stringify(clonedBody)).not.toContain(fixture.systemPrompt);

    await loginAsAdmin(page);
    await page.goto(`/admin/hubs/${hub.id}`);
    await page.getByRole("button", { name: "Zeile hinzufuegen" }).click();
    await page.getByRole("button", { name: "Widget hinzufuegen" }).click();
    const dialog = page.getByRole("dialog", { name: "Widget hinzufuegen" });
    await dialog.getByLabel("Typ").selectOption("ai_agent");
    await dialog
      .locator('select[name="agentId"]')
      .selectOption(fixture.agentId);
    await dialog.getByLabel("Titel").fill(widgetTitle);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Persoenlicher Lernbegleiter im Hub.");
    await dialog.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(dialog).not.toBeVisible();

    await page.locator('select[name="status"]').selectOption("published");
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(
      page.getByText("Hub-Einstellungen gespeichert.", { exact: true }),
    ).toBeVisible();

    const [stored] = await sql<Array<{ layout: unknown }>>`
      select layout from hubs where id = ${hub.id}
    `;
    expect(stored.layout).toEqual([
      {
        id: expect.any(String),
        columns: [
          {
            type: "ai_agent",
            title: widgetTitle,
            description: "Persoenlicher Lernbegleiter im Hub.",
            color: "#2bb7a9",
            agentId: fixture.agentId,
          },
        ],
      },
    ]);

    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAsMember(memberPage);
    await memberPage.goto(`/academy/hub?hub=${hubSlug}`);
    await expect(
      memberPage.getByText(fixture.agentName, { exact: true }),
    ).toBeVisible();
    const memberText = await memberPage.locator("body").innerText();
    expect(memberText).not.toContain(fixture.systemPrompt);
    expect(memberText).not.toContain(fixture.agentId);

    await sql`update ai_agents set active = false where id = ${fixture.agentId}`;
    await memberPage.reload();
    await expect(
      memberPage.getByText(getAiMemberCopy("de").embedded.unavailable, {
        exact: true,
      }),
    ).toBeVisible();
    const revokedText = await memberPage.locator("body").innerText();
    expect(revokedText).not.toContain(fixture.systemPrompt);
    expect(revokedText).not.toContain(fixture.agentId);

    const revokedPatch = await request.patch(`/api/v1/hubs/${hub.id}`, {
      headers: headers(patchKey, requestIds[3]!),
      data: { description: "Darf bei entzogenem Agenten nicht schreiben." },
    });
    expect(revokedPatch.status()).toBe(422);
    const revokedBody = await revokedPatch.text();
    expect(revokedBody).not.toContain(fixture.systemPrompt);
    expect(revokedBody).not.toContain(fixture.agentId);
  } finally {
    if (agentId) {
      await sql`update ai_agents set active = true where id = ${agentId}`;
    }
    await memberContext?.close();
    if (hubIds.length) {
      await sql`
        delete from activity_events
        where entity_id = any(${hubIds}::uuid[])
      `;
      await sql`
        delete from webhook_deliveries
        where payload #>> '{data,id}' = any(${hubIds})
      `;
      await sql`delete from hubs where id = any(${hubIds}::uuid[])`;
    }
    await sql`
      delete from api_audit_logs
      where request_id = any(${requestIds}::uuid[])
    `;
    await sql`
      delete from api_idempotency_keys
      where key = any(${[createKey, invalidKey, cloneKey, patchKey]})
    `;
    await sql.end({ timeout: 5 });
  }
});
