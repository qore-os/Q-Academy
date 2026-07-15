import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const adminCopy = getCommunityAdminCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

test("member reports foreign content and admin resolves it through the moderation queue", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "moderation lifecycle runs once on desktop",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const startedAt = new Date();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const content = `Unzulaessiger Testbeitrag ${suffix}`;
  let organizationId = "";
  let reporterId = "";
  let authorId = "";
  let spaceId = "";
  let postId = "";
  let reportId = "";
  let caseId = "";

  try {
    const [reporter] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id from users where email = 'lea@q-academy.de' limit 1
    `;
    const [author] = await client<{ id: string }[]>`
      select id from users
      where organization_id = ${reporter.organization_id}
        and email = 'jonas@q-academy.de'
      limit 1
    `;
    organizationId = reporter.organization_id;
    reporterId = reporter.id;
    authorId = author.id;

    const area = await ensureCommunityAreaFixture(client, organizationId);

    const [space] = await client<{ id: string }[]>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Reports ${suffix}`},
        ${`reports-${suffix}`}, 'Isolierter Meldungstest', '#4f7cac',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [post] = await client<{ id: string }[]>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${organizationId}, ${spaceId}, ${authorId}, ${content})
      returning id
    `;
    postId = post.id;

    await loginAsMember(page);
    await page.goto("/academy/community");
    const postArticle = page.locator(`#post-${postId}`);
    await expect(postArticle.getByText(content, { exact: true })).toBeVisible();
    await postArticle.getByRole("button", { name: "Beitrag melden" }).click();

    const reportDialog = page.getByRole("dialog", { name: "Beitrag melden" });
    await reportDialog.getByLabel("Grund").selectOption("spam");
    await reportDialog
      .getByLabel("Beschreibung (optional)")
      .fill("Wiederholte externe Werbung im Lernbereich.");
    await reportDialog.getByRole("button", { name: "Meldung senden" }).click();
    await expect(reportDialog).toBeHidden();
    await expect(
      postArticle.getByRole("button", { name: "Beitrag bereits gemeldet" }),
    ).toBeDisabled();

    const [storedReport] = await client<
      {
        id: string;
        status: string;
        reason: string;
        reporter_id: string;
        target_author_id: string;
        case_id: string;
      }[]
    >`
      select id, status, reason, reporter_id, target_author_id, case_id
      from community_reports
      where organization_id = ${organizationId}
        and reporter_id = ${reporterId}
        and target_type = 'post'
        and target_id = ${postId}
    `;
    reportId = storedReport.id;
    caseId = storedReport.case_id;
    expect(storedReport).toMatchObject({
      status: "open",
      reason: "spam",
      reporter_id: reporterId,
      target_author_id: authorId,
    });

    await page.context().clearCookies();
    await loginAsOwner(page);
    await page.goto("/admin/community");
    let reportArticle = page.locator(`#report-${reportId}`);
    await expect(
      reportArticle.getByText(content, { exact: true }),
    ).toBeVisible();
    await expect(
      reportArticle.getByText(adminCopy.moderation.reportReasons.spam, {
        exact: true,
      }),
    ).toBeVisible();
    await reportArticle
      .getByRole("button", { name: adminCopy.moderation.startReview })
      .click();
    await expect(
      reportArticle.getByText(adminCopy.moderation.reportStatuses.reviewing, {
        exact: true,
      }),
    ).toBeVisible();

    await reportArticle
      .getByRole("button", { name: adminCopy.moderation.removeContentButton })
      .click();
    const decisionDialog = page.getByRole("dialog", {
      name: adminCopy.moderation.removeContent,
    });
    await decisionDialog
      .getByLabel(adminCopy.moderation.internalReason)
      .fill("Werbung verstoesst gegen die Community-Regeln.");
    await decisionDialog
      .getByRole("button", { name: adminCopy.moderation.removeContent })
      .click();
    await expect(decisionDialog).toBeHidden();
    await expect(page.locator(`#report-${reportId}`)).toHaveCount(0);

    await page
      .getByRole("button", { name: adminCopy.moderation.closedView })
      .click();
    reportArticle = page.locator(`#report-${reportId}`);
    await expect(
      reportArticle.getByText(adminCopy.moderation.reportStatuses.resolved, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(reportArticle.getByText(/Werbung verstoesst/)).toBeVisible();

    const [storedPost] = await client<
      {
        count: number;
        moderation_state: string;
        moderation_version: number;
      }[]
    >`
      select count(*)::int as count,
             max(moderation_state::text) as moderation_state,
             max(moderation_version)::int as moderation_version
      from posts where id = ${postId}
    `;
    const [resolved] = await client<
      { status: string; outcome: string; handled_by_id: string | null }[]
    >`
      select status, outcome, handled_by_id from community_reports where id = ${reportId}
    `;
    expect(storedPost.count).toBe(1);
    expect(storedPost.moderation_state).toBe("rejected");
    expect(storedPost.moderation_version).toBe(2);
    expect(resolved.status).toBe("resolved");
    expect(resolved.outcome).toBe("content_removed");
    expect(resolved.handled_by_id).toBeTruthy();

    const activity = await client<{ type: string }[]>`
      select type from activity_events
      where organization_id = ${organizationId}
        and entity_id = any(${[reportId, caseId]}::uuid[])
        and created_at >= ${startedAt}
    `;
    expect(activity.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "community_report.created",
        "community_moderation.case_claimed",
      ]),
    );
    const moderationEvents = await client<{ action: string }[]>`
      select action from community_moderation_events
      where organization_id = ${organizationId}
        and case_id = ${caseId}
    `;
    expect(moderationEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["flagged", "rejected"]),
    );

    await page.context().clearCookies();
    await loginAsMember(page);
    await page.goto("/academy/community");
    await expect(page.locator(`#post-${postId}`)).toHaveCount(0);
  } finally {
    if (reportId)
      await client`delete from community_reports where id = ${reportId}`;
    if (caseId) {
      await client.begin(async (sqlClient) => {
        await sqlClient`set local session_replication_role = 'replica'`;
        await sqlClient`
          delete from community_moderation_events where case_id = ${caseId}
        `;
      });
      await client`
        delete from community_moderation_assessments where case_id = ${caseId}
      `;
      await client`
        delete from community_moderation_appeals where case_id = ${caseId}
      `;
      await client`delete from community_moderation_cases where id = ${caseId}`;
    }
    if (spaceId)
      await client`delete from community_spaces where id = ${spaceId}`;
    if (reportId || caseId) {
      await client`
        delete from activity_events
        where entity_id = any(${[reportId, caseId].filter(Boolean)}::uuid[])
      `;
    }
    if (reporterId || authorId) {
      await client`
        delete from notifications
        where user_id = any(${[reporterId, authorId].filter(Boolean)}::uuid[])
          and title in ('Community-Meldung geprueft', 'Community-Inhalt moderiert')
          and created_at >= ${startedAt}
      `;
    }
    await client`
      delete from auth_rate_limits
      where action in ('community_report', 'community_report_tenant')
    `;
    await client.end();
  }
});

test("community reporting and moderation layouts fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout audit");

  await loginAsMember(page);
  await page.goto("/academy/community");
  const reportButton = page
    .getByRole("button", { name: /^(Beitrag|Antwort) melden$/ })
    .first();
  await expect(reportButton).toBeVisible();
  await reportButton.click();
  const dialog = page.getByRole("dialog", { name: /(Beitrag|Antwort) melden/ });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "Dialog schliessen" }).click();

  await page.context().clearCookies();
  await loginAsOwner(page);
  await page.goto("/admin/community");
  await expect(
    page.getByRole("heading", { name: adminCopy.moderation.reportsHeading }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("community report constraints reject cross-tenant actors and invalid resolution states", async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "database invariant runs once",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let foreignOrganizationId = "";
  let reportId = "";
  try {
    const [reporter] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id from users where email = 'lea@q-academy.de' limit 1
    `;
    const [author] = await client<{ id: string }[]>`
      select id from users where email = 'jonas@q-academy.de' limit 1
    `;
    const [foreignOrganization] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Report isolation ${suffix}`}, ${`report-isolation-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await client<{ id: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values (
        ${foreignOrganizationId}, ${`foreign-${suffix}@example.test`},
        'not-a-real-login-hash', 'Foreign', 'User'
      )
      returning id
    `;

    await expect(
      client`
        insert into community_reports (
          organization_id, reporter_id, target_type, target_id,
          target_author_id, content_excerpt, reason
        ) values (
          ${reporter.organization_id}, ${reporter.id}, 'post', ${randomUUID()},
          ${foreignUser.id}, 'Cross tenant', 'other'
        )
      `,
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      client`
        insert into community_reports (
          organization_id, reporter_id, target_type, target_id,
          target_author_id, content_excerpt, reason, status, outcome
        ) values (
          ${reporter.organization_id}, ${reporter.id}, 'post', ${randomUUID()},
          ${author.id}, 'Invalid resolution', 'other', 'resolved', 'content_removed'
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });

    const targetId = randomUUID();
    const [created] = await client<{ id: string }[]>`
      insert into community_reports (
        organization_id, reporter_id, target_type, target_id,
        target_author_id, content_excerpt, reason
      ) values (
        ${reporter.organization_id}, ${reporter.id}, 'post', ${targetId},
        ${author.id}, 'Duplicate guard', 'spam'
      )
      returning id
    `;
    reportId = created.id;
    await expect(
      client`
        insert into community_reports (
          organization_id, reporter_id, target_type, target_id,
          target_author_id, content_excerpt, reason
        ) values (
          ${reporter.organization_id}, ${reporter.id}, 'post', ${targetId},
          ${author.id}, 'Duplicate guard', 'spam'
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
  } finally {
    if (reportId)
      await client`delete from community_reports where id = ${reportId}`;
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end();
  }
});
