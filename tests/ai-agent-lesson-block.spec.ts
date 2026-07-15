import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { getAiMemberCopy } from "../src/lib/i18n/ai-member";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };
const memberCopy = getAiMemberCopy("de");

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

test("AI lesson block API accepts only active published tenant agents", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused block authorization flow runs once.",
  );
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const requestIds: string[] = [];
  let blockId: string | null = null;
  let agentId: string | null = null;

  try {
    const [fixture] = await sql<
      Array<{ lesson_id: string; agent_id: string; agent_name: string }>
    >`
      select lesson.id as lesson_id, agent.id as agent_id,
             version.name as agent_name
      from organizations as organization
      join modules as module
        on module.organization_id = organization.id
      join lessons as lesson on lesson.module_id = module.id
      join ai_agents as agent
        on agent.organization_id = organization.id
       and agent.active = true
       and agent.published_version_id is not null
      join ai_agent_versions as version
        on version.id = agent.published_version_id
       and version.agent_id = agent.id
       and version.organization_id = organization.id
       and version.state = 'published'
      where organization.slug = 'q-academy'
      order by lesson.created_at, agent.created_at
      limit 1
    `;
    expect(fixture).toBeTruthy();
    agentId = fixture.agent_id;

    const invalid = await request.post(
      `/api/v1/lessons/${fixture.lesson_id}/blocks`,
      {
        headers: authorization,
        data: {
          type: "ai_agent",
          title: "Unbekannter Agent",
          data: { agentId: "11111111-1111-4111-8111-111111111111" },
        },
      },
    );
    requestIds.push(invalid.headers()["x-request-id"]);
    expect(invalid.status()).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "validation_error",
    });

    const created = await request.post(
      `/api/v1/lessons/${fixture.lesson_id}/blocks`,
      {
        headers: authorization,
        data: {
          type: "ai_agent",
          title: fixture.agent_name,
          data: { agentId: fixture.agent_id },
        },
      },
    );
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    const body = await created.json();
    blockId = body.data.id;
    expect(body.data).toMatchObject({
      type: "ai_agent",
      data: { agentId: fixture.agent_id },
    });
    expect(JSON.stringify(body.data)).not.toContain("systemPrompt");

    await sql`update ai_agents set active = false where id = ${fixture.agent_id}`;
    const revoked = await request.patch(`/api/v1/blocks/${blockId}`, {
      headers: authorization,
      data: { revision: 1, title: "Darf nicht gespeichert werden" },
    });
    requestIds.push(revoked.headers()["x-request-id"]);
    expect(revoked.status()).toBe(422);
    await expect(revoked.json()).resolves.toMatchObject({
      code: "validation_error",
    });
  } finally {
    if (agentId) {
      await sql`update ai_agents set active = true where id = ${agentId}`;
    }
    if (blockId) {
      await sql`delete from content_blocks where id = ${blockId}`;
    }
    const filteredRequestIds = requestIds.filter(Boolean);
    if (filteredRequestIds.length) {
      await sql`
        delete from api_audit_logs
        where request_id = any(${filteredRequestIds}::uuid[])
      `;
    }
    await sql.end();
  }
});

test("course builder embeds a selected published agent in a lesson", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused builder flow runs once.",
  );
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let courseId: string | null = null;
  let moduleId: string | null = null;
  let embeddedAgentId: string | null = null;

  try {
    const [fixture] = await sql<
      Array<{
        owner_id: string;
        organization_id: string;
        agent_id: string;
        agent_name: string;
        system_prompt: string;
      }>
    >`
      select owner.id as owner_id, owner.organization_id,
             agent.id as agent_id, version.name as agent_name,
             version.system_prompt
      from users as owner
      join ai_agents as agent
        on agent.organization_id = owner.organization_id
       and agent.active = true
       and agent.published_version_id is not null
      join ai_agent_versions as version
        on version.id = agent.published_version_id
       and version.state = 'published'
      where owner.email = 'admin@q-academy.de'
      order by version.name, agent.id
      limit 1
    `;
    expect(fixture).toBeTruthy();
    embeddedAgentId = fixture.agent_id;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${fixture.organization_id}, ${`Agent Embed ${suffix}`},
        ${`agent-embed-${suffix}`}, 'Fokussierter KI-Agent-Blocktest.',
        'Fokussierter Kurs fuer die Einbettung eines veroeffentlichten KI-Agenten.',
        'draft', ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (organization_id, title, kind, is_reusable)
      values (
        ${fixture.organization_id}, ${`Agent Modul ${suffix}`}, 'learning',
        false
      )
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (organization_id, course_id, module_id)
      values (${fixture.organization_id}, ${course.id}, ${learningModule.id})
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, status, visibility
      ) values (
        ${fixture.organization_id}, ${learningModule.id},
        ${`Agent Lektion ${suffix}`}, ${`agent-lesson-${suffix}`},
        'published', 'visible'
      )
      returning id
    `;

    await loginAsOwner(page);
    await page.goto(`/admin/courses/${course.id}`);
    await page.getByRole("button", { name: "KI-Agent", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "KI-Agent einbetten" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("KI-Agent").selectOption(fixture.agent_id);
    await dialog.getByRole("button", { name: "Agent einbetten" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(fixture.agent_name, { exact: true }),
    ).toBeVisible();

    const [stored] = await sql<
      Array<{ type: string; agent_id: string | null }>
    >`
      select type, data ->> 'agentId' as agent_id
      from content_blocks
      where lesson_id = ${lesson.id}
      order by sort_order desc
      limit 1
    `;
    expect(stored).toEqual({ type: "ai_agent", agent_id: fixture.agent_id });

    await page.goto(`/admin/courses/${course.id}/preview?lesson=${lesson.id}`);
    await expect(
      page.getByLabel(`Nachricht an ${fixture.agent_name}`),
    ).toBeVisible();
    expect(await page.content()).not.toContain(fixture.system_prompt);

    await sql`update ai_agents set active = false where id = ${fixture.agent_id}`;
    await page.reload();
    await expect(
      page.getByText(memberCopy.embedded.unavailable, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.agent_name, { exact: true }),
    ).toBeHidden();
  } finally {
    if (embeddedAgentId) {
      await sql`update ai_agents set active = true where id = ${embeddedAgentId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    if (courseId) await sql`delete from courses where id = ${courseId}`;
    await sql.end();
  }
});
