import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

import { getAiAdminCopy } from "../src/lib/i18n/ai-admin";
import { getAiMemberCopy } from "../src/lib/i18n/ai-member";
import { getAiManagerCopy } from "../src/lib/i18n/ai-manager";
import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import { acknowledgeAiTransparency } from "./helpers/ai-transparency";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const managerCopy = getAiManagerCopy("de");
const adminCopy = getAiAdminCopy("de");
const memberCopy = getAiMemberCopy("de");
const coreCopy = getCoreDictionary("de");

type SqlClient = ReturnType<typeof postgres>;

type TenantFixture = {
  organizationId: string;
  slug: string;
  ownerId: string;
  ownerEmail: string;
  memberId: string;
  memberEmail: string;
};

type CourseFixture = {
  id: string;
  versionId: string;
  slug: string;
  title: string;
};

async function login(
  page: Page,
  input: {
    origin: string;
    email: string;
    destination: "admin" | "academy";
  },
) {
  await page.goto(`${input.origin}/login`);
  await page.getByLabel(coreCopy.auth.email).fill(input.email);
  await page
    .getByLabel(coreCopy.auth.password, { exact: true })
    .fill("Demo123!");
  await page.getByRole("button", { name: /Bei .* anmelden/ }).click();
  await page.waitForURL(
    input.destination === "admin"
      ? new RegExp(
          `${input.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/admin(?:/.*)?$`,
        )
      : new RegExp(
          `${input.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/academy(?:/.*)?$`,
        ),
  );
  if (input.destination === "academy") {
    await completeMemberWelcomeIfVisible(page);
  }
}

async function createTenant(
  client: SqlClient,
  input: { suffix: string; prefix: string; passwordHash: string },
): Promise<TenantFixture> {
  const slug = `${input.prefix}-${input.suffix}`;
  const ownerEmail = `${input.prefix}-owner-${input.suffix}@example.test`;
  const memberEmail = `${input.prefix}-member-${input.suffix}@example.test`;
  const [organization] = await client<Array<{ id: string }>>`
    insert into organizations (name, slug, description)
    values (
      ${`AI action UI ${input.prefix} ${input.suffix}`},
      ${slug},
      'Isolierter Mandant fuer den UI-Test freigabepflichtiger Agentenaktionen.'
    )
    returning id
  `;
  if (!organization) throw new Error("Test organization could not be created.");
  const users = await client<
    Array<{ id: string; email: string; role: "owner" | "member" }>
  >`
    insert into users (
      organization_id, email, password_hash, first_name, last_name, role, status
    ) values
      (
        ${organization.id}, ${ownerEmail}, ${input.passwordHash},
        'Action', 'Owner', 'owner', 'active'
      ),
      (
        ${organization.id}, ${memberEmail}, ${input.passwordHash},
        'Mira', 'Freigabe', 'member', 'active'
      )
    returning id, email, role
  `;
  const owner = users.find((candidate) => candidate.role === "owner");
  const member = users.find((candidate) => candidate.role === "member");
  if (!owner || !member) throw new Error("Test users could not be created.");
  return {
    organizationId: organization.id,
    slug,
    ownerId: owner.id,
    ownerEmail,
    memberId: member.id,
    memberEmail,
  };
}

async function createPublishedCourse(
  client: SqlClient,
  tenant: TenantFixture,
  input: { suffix: string; prefix: string },
): Promise<CourseFixture> {
  const id = randomUUID();
  const versionId = randomUUID();
  const slug = `${input.prefix}-course-${input.suffix}`;
  const title = `${input.prefix} Kurszugang ${input.suffix}`;
  const capturedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt,
    course: {
      id,
      organizationId: tenant.organizationId,
      categoryId: null,
      title,
      slug,
      shortDescription:
        "Ein Kurs, dessen Zugriff eine explizite Freigabe erfordert.",
      description:
        "Der Kurs prueft den vollstaendigen Agentenaktions-Workflow.",
      coverImage: null,
      status: "published",
      difficulty: "Grundlagen",
      estimatedMinutes: 30,
      certificateEnabled: true,
      featured: false,
      visibleInCatalog: true,
      showProgressPercentage: true,
      publishedVersionId: versionId,
      createdById: tenant.ownerId,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      firstPublishedAt: capturedAt,
    },
    learningGoals: [],
    authors: [],
    widgets: [],
    modules: [],
  };
  await client.begin(async (tx) => {
    await tx`
      insert into courses (
        id, organization_id, title, slug, short_description, description,
        status, difficulty, estimated_minutes, certificate_enabled,
        visible_in_catalog, show_progress_percentage, first_published_at,
        created_by_id
      ) values (
        ${id}, ${tenant.organizationId}, ${title}, ${slug},
        'Ein Kurs, dessen Zugriff eine explizite Freigabe erfordert.',
        'Der Kurs prueft den vollstaendigen Agentenaktions-Workflow.',
        'published', 'Grundlagen', 30, true, true, true, ${capturedAt},
        ${tenant.ownerId}
      )
    `;
    await tx`
      insert into course_versions (
        id, organization_id, course_id, version, snapshot, changelog,
        published_at, created_by_id
      ) values (
        ${versionId}, ${tenant.organizationId}, ${id}, 1,
        ${tx.json(snapshot)}, 'Initialer Aktionszielkurs.', ${capturedAt},
        ${tenant.ownerId}
      )
    `;
    await tx`
      update courses
      set published_version_id = ${versionId}
      where id = ${id} and organization_id = ${tenant.organizationId}
    `;
  });
  return { id, versionId, slug, title };
}

async function createDraftAgent(
  client: SqlClient,
  tenant: TenantFixture,
  input: { name: string },
) {
  const agentId = randomUUID();
  const draftVersionId = randomUUID();
  await client.begin(async (tx) => {
    await tx`set constraints all deferred`;
    await tx`
      insert into ai_agents (
        id, organization_id, name, description, system_prompt, color, icon,
        active, draft_version_id, published_version_id
      ) values (
        ${agentId}, ${tenant.organizationId}, ${input.name},
        'Bietet ausschliesslich explizit freigegebene Kursaktionen an.',
        'Erklaere die konfigurierte Kursaktion, aber fuehre niemals selbst eine Freigabe aus.',
        '#2b9188', 'bot', true, ${draftVersionId}, null
      )
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, draft_revision, state, type,
        name, description, system_prompt, color, icon, knowledge_mode,
        access_mode, created_by_id
      ) values (
        ${draftVersionId}, ${tenant.organizationId}, ${agentId}, 1, 1,
        'draft', 'learning_coach', ${input.name},
        'Bietet ausschliesslich explizit freigegebene Kursaktionen an.',
        'Erklaere die konfigurierte Kursaktion, aber fuehre niemals selbst eine Freigabe aus.',
        '#2b9188', 'bot', 'all_accessible_courses', 'open', ${tenant.ownerId}
      )
    `;
  });
  return { agentId, draftVersionId };
}

async function createPublishedActionAgent(
  client: SqlClient,
  tenant: TenantFixture,
  course: CourseFixture,
  input: { name: string; label: string },
) {
  const agentId = randomUUID();
  const publishedVersionId = randomUUID();
  const draftVersionId = randomUUID();
  const actionConfigurationId = randomUUID();
  await client.begin(async (tx) => {
    await tx`set constraints all deferred`;
    await tx`
      insert into ai_agents (
        id, organization_id, name, description, system_prompt, color, icon,
        active, draft_version_id, published_version_id
      ) values (
        ${agentId}, ${tenant.organizationId}, ${input.name},
        'Fremdmandanten-Agent fuer den Isolationstest.',
        'Fuehre keine Aktion ohne explizite Freigabe aus.',
        '#325d7d', 'bot', true, ${publishedVersionId}, null
      )
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, type, name,
        description, system_prompt, color, icon, knowledge_mode, access_mode,
        created_by_id
      ) values (
        ${publishedVersionId}, ${tenant.organizationId}, ${agentId}, 1,
        'draft', 'learning_coach', ${input.name},
        'Fremdmandanten-Agent fuer den Isolationstest.',
        'Fuehre keine Aktion ohne explizite Freigabe aus.', '#325d7d', 'bot',
        'all_accessible_courses', 'open', ${tenant.ownerId}
      )
    `;
    await tx`
      insert into ai_agent_version_actions (
        id, organization_id, agent_version_id, action_type, target_type, course_id,
        label, description, sort_order
      ) values (
        ${actionConfigurationId}, ${tenant.organizationId},
        ${publishedVersionId}, 'course_enrollment', 'course', ${course.id},
        ${input.label}, 'Nur fuer den fremden Isolationstest sichtbar.', 0
      )
    `;
    await tx`
      update ai_agent_versions
      set state = 'published', published_at = statement_timestamp(),
          updated_at = statement_timestamp()
      where id = ${publishedVersionId}
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, type, name,
        description, system_prompt, color, icon, knowledge_mode, access_mode,
        created_by_id
      ) values (
        ${draftVersionId}, ${tenant.organizationId}, ${agentId}, 2,
        'draft', 'learning_coach', ${input.name},
        'Fremdmandanten-Agent fuer den Isolationstest.',
        'Fuehre keine Aktion ohne explizite Freigabe aus.', '#325d7d', 'bot',
        'all_accessible_courses', 'open', ${tenant.ownerId}
      )
    `;
    await tx`
      update ai_agents
      set draft_version_id = ${draftVersionId},
          published_version_id = ${publishedVersionId}
      where id = ${agentId} and organization_id = ${tenant.organizationId}
    `;
  });
  return { agentId, actionConfigurationId };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

async function openAgentEditor(page: Page, agentName: string) {
  const editor = page.getByRole("dialog", {
    name: managerCopy.editor.editAria(agentName),
  });
  await expect(async () => {
    if (!(await editor.isVisible())) {
      await page
        .getByRole("button", {
          name: managerCopy.editor.editAria(agentName),
        })
        .click();
    }
    await expect(editor).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  return editor;
}

test("approval-gated agent action publishes, stays tenant-bound and grants course access", async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The complete action approval UI flow runs once in serial Chromium.",
  );
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);

  const client = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const actionLabel = `Sicherheitskurs ${suffix} anfragen`;
  const foreignActionLabel = `Fremde Aktion ${suffix}`;
  const agentName = `Freigabe-Agent ${suffix}`;
  let memberContext: BrowserContext | null = null;
  let foreignMemberContext: BrowserContext | null = null;
  let mobileAdminContext: BrowserContext | null = null;

  try {
    const [passwordTemplate] = await client<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'lea@q-academy.de' limit 1
    `;
    if (!passwordTemplate)
      throw new Error("Seeded password fixture is missing.");

    const tenant = await createTenant(client, {
      suffix,
      prefix: "agent-action-ui",
      passwordHash: passwordTemplate.password_hash,
    });
    const foreignTenant = await createTenant(client, {
      suffix,
      prefix: "foreign-agent-action-ui",
      passwordHash: passwordTemplate.password_hash,
    });
    const [course, foreignCourse] = await Promise.all([
      createPublishedCourse(client, tenant, { suffix, prefix: "Freigabe" }),
      createPublishedCourse(client, foreignTenant, { suffix, prefix: "Fremd" }),
    ]);
    const draftAgent = await createDraftAgent(client, tenant, {
      name: agentName,
    });
    const foreignAgent = await createPublishedActionAgent(
      client,
      foreignTenant,
      foreignCourse,
      { name: `Fremd-Agent ${suffix}`, label: foreignActionLabel },
    );
    const origin = `http://${tenant.slug}.localhost:3000`;
    const foreignOrigin = `http://${foreignTenant.slug}.localhost:3000`;

    await login(page, {
      origin,
      email: tenant.ownerEmail,
      destination: "admin",
    });
    await page.goto(`${origin}/admin/ai`);
    const agent = page.locator(`#agent-${draftAgent.agentId}`);
    await expect(agent).toContainText(agentName);
    const editor = await openAgentEditor(page, agentName);
    const actionTarget = editor.locator(
      `input[name="actionCourseIds"][value="${course.id}"]`,
    );
    await actionTarget.check();
    await editor.locator('input[name^="actionLabel:"]').fill(actionLabel);
    await editor
      .locator('input[name^="actionDescription:"]')
      .fill(
        "Beantragt den Kurszugriff und wartet auf eine explizite Admin-Freigabe.",
      );
    await editor
      .getByRole("button", { name: managerCopy.editor.saveDraft })
      .click();
    await expect(
      page.getByText(adminCopy.messages.draftSaved, { exact: true }),
    ).toBeVisible();
    await expect(editor).not.toBeVisible();

    const [storedDraftAction] = await client<
      Array<{
        action_type: string;
        target_type: string;
        course_id: string;
        label: string;
      }>
    >`
      select action.action_type, action.target_type, action.course_id, action.label
      from ai_agents agent
      join ai_agent_version_actions action
        on action.agent_version_id = agent.draft_version_id
       and action.organization_id = agent.organization_id
      where agent.id = ${draftAgent.agentId}
        and agent.organization_id = ${tenant.organizationId}
    `;
    expect(storedDraftAction).toEqual({
      action_type: "course_enrollment",
      target_type: "course",
      course_id: course.id,
      label: actionLabel,
    });

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

    const [publishedAction] = await client<
      Array<{ id: string; agent_version_id: string; target_type: string }>
    >`
      select action.id, action.agent_version_id, action.target_type
      from ai_agents agent
      join ai_agent_version_actions action
        on action.agent_version_id = agent.published_version_id
       and action.organization_id = agent.organization_id
      where agent.id = ${draftAgent.agentId}
        and agent.organization_id = ${tenant.organizationId}
        and action.course_id = ${course.id}
    `;
    if (!publishedAction)
      throw new Error("Published action configuration is missing.");
    expect(publishedAction.target_type).toBe("course");

    foreignMemberContext = await browser.newContext();
    const foreignMemberPage = await foreignMemberContext.newPage();
    await login(foreignMemberPage, {
      origin: foreignOrigin,
      email: foreignTenant.memberEmail,
      destination: "academy",
    });
    await foreignMemberPage.goto(`${foreignOrigin}/academy/ai`);
    await acknowledgeAiTransparency(foreignMemberPage);
    await foreignMemberPage.reload();
    const foreignActions = foreignMemberPage.getByRole("region", {
      name: memberCopy.actions.aria,
    });
    await expect(
      foreignActions.getByText(foreignActionLabel, { exact: true }),
    ).toBeVisible();
    await foreignActions
      .getByRole("button", { name: memberCopy.actions.request })
      .click();
    await expect(
      foreignActions.getByText(memberCopy.actions.pending, { exact: true }),
    ).toBeVisible();

    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await login(memberPage, {
      origin,
      email: tenant.memberEmail,
      destination: "academy",
    });
    await memberPage.goto(`${origin}/academy/ai`);
    await acknowledgeAiTransparency(memberPage);
    await memberPage.reload();
    const memberActions = memberPage.getByRole("region", {
      name: memberCopy.actions.aria,
    });
    await expect(
      memberActions.getByText(actionLabel, { exact: true }),
    ).toBeVisible();

    const foreignRead = await memberPage.evaluate(async (agentId) => {
      const response = await fetch(
        `/api/ai/actions?agentId=${encodeURIComponent(agentId)}`,
        { cache: "no-store" },
      );
      return response.status;
    }, foreignAgent.agentId);
    expect(foreignRead).toBe(404);
    const foreignMutation = await memberPage.evaluate(
      async ({ agentId, actionConfigurationId }) => {
        const response = await fetch("/api/ai/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, actionConfigurationId }),
        });
        return response.status;
      },
      {
        agentId: draftAgent.agentId,
        actionConfigurationId: foreignAgent.actionConfigurationId,
      },
    );
    expect(foreignMutation).toBe(404);

    await memberActions
      .getByRole("button", { name: memberCopy.actions.request })
      .click();
    await expect(
      memberActions.getByText(memberCopy.actions.pending, { exact: true }),
    ).toBeVisible();
    const memberPendingScreenshot = testInfo.outputPath(
      "ai-agent-action-member-pending-desktop.png",
    );
    await memberActions.screenshot({ path: memberPendingScreenshot });
    await testInfo.attach("Member action pending desktop", {
      path: memberPendingScreenshot,
      contentType: "image/png",
    });

    const [requestRow] = await client<
      Array<{ id: string; status: string; revision: number }>
    >`
      select id, status, revision
      from ai_agent_action_requests
      where organization_id = ${tenant.organizationId}
        and requested_by_id = ${tenant.memberId}
        and action_configuration_id = ${publishedAction.id}
    `;
    expect(requestRow).toMatchObject({ status: "pending", revision: 1 });
    if (!requestRow)
      throw new Error("Member action request was not persisted.");

    mobileAdminContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true,
    });
    const mobileAdminPage = await mobileAdminContext.newPage();
    await login(mobileAdminPage, {
      origin,
      email: tenant.ownerEmail,
      destination: "admin",
    });
    await mobileAdminPage.goto(`${origin}/admin/ai`);
    const mobileReview = mobileAdminPage.getByRole("region", {
      name: adminCopy.review.title,
    });
    await expect(
      mobileReview.getByText(actionLabel, { exact: true }),
    ).toBeVisible();
    await expect(
      mobileReview.getByText(foreignActionLabel, { exact: true }),
    ).toHaveCount(0);
    await mobileReview.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(mobileAdminPage);
    const mobileScreenshot = testInfo.outputPath(
      "ai-agent-action-admin-queue-mobile.png",
    );
    await mobileAdminPage.screenshot({
      path: mobileScreenshot,
      fullPage: false,
    });
    await testInfo.attach("Admin action queue mobile", {
      path: mobileScreenshot,
      contentType: "image/png",
    });
    await mobileAdminContext.close();
    mobileAdminContext = null;

    await page.goto(`${origin}/admin/ai`);
    const review = page.getByRole("region", {
      name: adminCopy.review.title,
    });
    await expect(review.getByText(actionLabel, { exact: true })).toBeVisible();
    await expect(
      review.getByText(tenant.memberEmail, { exact: false }),
    ).toBeVisible();
    await expect(
      review.getByText(foreignActionLabel, { exact: true }),
    ).toHaveCount(0);
    const adminQueueScreenshot = testInfo.outputPath(
      "ai-agent-action-admin-queue-desktop.png",
    );
    await review.screenshot({ path: adminQueueScreenshot });
    await testInfo.attach("Admin action queue desktop", {
      path: adminQueueScreenshot,
      contentType: "image/png",
    });

    const requestReview = review
      .locator("article")
      .filter({ hasText: actionLabel });
    const approvalConfirmation = requestReview.getByRole("checkbox", {
      name: adminCopy.review.confirmAssignment,
    });
    await expect(async () => {
      if (!(await approvalConfirmation.isVisible())) {
        await requestReview
          .getByRole("button", { name: adminCopy.review.approve })
          .click();
      }
      await expect(approvalConfirmation).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await approvalConfirmation.check();
    await requestReview
      .getByRole("button", { name: adminCopy.review.saveDecision })
      .click();
    await expect(
      requestReview.getByText(adminCopy.review.statuses.approved, {
        exact: true,
      }),
    ).toBeVisible();

    const [storedDecision] = await client<
      Array<{
        status: string;
        revision: number;
        decided_by_id: string;
        executed: boolean;
        enrollment_count: number;
        grant_count: number;
        event_count: number;
      }>
    >`
      select request.status,
             request.revision,
             request.decided_by_id,
             (request.executed_at is not null) as executed,
             (
               select count(*)::int from enrollments enrollment
               where enrollment.user_id = ${tenant.memberId}
                 and enrollment.course_id = ${course.id}
                 and enrollment.access_active = true
             ) as enrollment_count,
             (
               select count(*)::int from course_access_grants access_grant
               where access_grant.organization_id = ${tenant.organizationId}
                 and access_grant.user_id = ${tenant.memberId}
                 and access_grant.course_id = ${course.id}
                 and access_grant.source = ${`ai_action:${requestRow.id}`}
             ) as grant_count,
             (
               select count(*)::int from ai_agent_action_events event
               where event.organization_id = request.organization_id
                 and event.request_id = request.id
             ) as event_count
      from ai_agent_action_requests request
      where request.id = ${requestRow.id}
        and request.organization_id = ${tenant.organizationId}
    `;
    expect(storedDecision).toEqual({
      status: "approved",
      revision: 2,
      decided_by_id: tenant.ownerId,
      executed: true,
      enrollment_count: 1,
      grant_count: 1,
      event_count: 2,
    });

    await memberPage.reload();
    await expect(
      memberActions.getByText(actionLabel, { exact: true }),
    ).toBeVisible();
    await expect(
      memberActions.getByText(memberCopy.actions.courseActive, { exact: true }),
    ).toBeVisible();
    const grantedScreenshot = testInfo.outputPath(
      "ai-agent-action-member-granted-desktop.png",
    );
    await memberActions.screenshot({ path: grantedScreenshot });
    await testInfo.attach("Member action granted desktop", {
      path: grantedScreenshot,
      contentType: "image/png",
    });

    await memberPage.goto(`${origin}/academy/courses`);
    const courseLink = memberPage.getByRole("link", {
      name: new RegExp(course.title),
    });
    await expect(courseLink).toBeVisible();
    await expect(courseLink).toHaveAttribute(
      "href",
      `/academy/courses/${course.slug}`,
    );

    await page.goto(`${origin}/admin/ai`);
    const nextEditor = await openAgentEditor(page, agentName);
    const revocationLabel = `Direkten Zugriff entfernen ${suffix}`;
    const revocationTarget = nextEditor.locator(
      `input[name="actionUnenrollmentCourseIds"][value="${course.id}"]`,
    );
    await revocationTarget.check();
    await nextEditor
      .locator(`input[name="actionLabel:course_unenrollment:${course.id}"]`)
      .fill(revocationLabel);
    await nextEditor
      .locator(
        `input[name="actionDescription:course_unenrollment:${course.id}"]`,
      )
      .fill(
        "Entfernt direkte Freigaben erst nach einer expliziten Admin-Entscheidung.",
      );
    await nextEditor
      .getByRole("button", { name: managerCopy.editor.saveDraft })
      .click();
    await expect(
      page.getByText(adminCopy.messages.draftSaved, { exact: true }),
    ).toBeVisible();
    await expect(nextEditor).not.toBeVisible();
    await agent
      .getByRole("button", { name: managerCopy.row.publishAria(agentName) })
      .click();
    const secondPublication = page.getByRole("alertdialog", {
      name: managerCopy.publish.aria,
    });
    await secondPublication.getByRole("checkbox").check();
    await secondPublication
      .getByRole("button", { name: managerCopy.publish.submit })
      .click();
    await expect(
      page.getByText(adminCopy.messages.published(2), { exact: true }),
    ).toBeVisible();

    await memberPage.goto(`${origin}/academy/ai`);
    await expect(
      memberActions.getByText(revocationLabel, { exact: true }),
    ).toBeVisible();
    const revocationRow = memberActions
      .getByText(revocationLabel, { exact: true })
      .locator("..")
      .locator("..");
    await revocationRow
      .getByRole("button", { name: memberCopy.actions.request })
      .click();
    await expect(
      revocationRow.getByText(memberCopy.actions.pending, { exact: true }),
    ).toBeVisible();

    await page.goto(`${origin}/admin/ai`);
    const revocationReview = page
      .getByRole("region", { name: adminCopy.review.title })
      .locator("article")
      .filter({ hasText: revocationLabel });
    await revocationReview
      .getByRole("button", { name: adminCopy.review.approve })
      .click();
    await revocationReview
      .getByRole("checkbox", {
        name: adminCopy.review.confirmRemoval,
      })
      .check();
    await revocationReview
      .getByRole("button", { name: adminCopy.review.saveDecision })
      .click();
    await expect(
      revocationReview.getByText(adminCopy.review.statuses.approved, {
        exact: true,
      }),
    ).toBeVisible();

    await memberPage.goto(`${origin}/academy/ai`);
    await expect(
      memberActions.getByText(memberCopy.actions.courseRemoved, {
        exact: true,
      }),
    ).toBeVisible();
    await memberPage.goto(`${origin}/academy/courses`);
    await expect(
      memberPage.getByRole("link", { name: new RegExp(course.title) }),
    ).toHaveCount(0);
  } finally {
    const contexts = [
      memberContext,
      foreignMemberContext,
      mobileAdminContext,
    ].filter((context): context is BrowserContext => context !== null);
    await Promise.all(
      contexts.map((context) => context.close().catch(() => undefined)),
    );
    // Action decision events are intentionally append-only. Their isolated tenants
    // stay in the test database so cleanup cannot erase the audit evidence.
    await client.end();
  }
});
