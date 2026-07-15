import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const adminCopy = getCommunityAdminCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("admin approves a pending submission through the versioned moderation queue", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 360, height: 800 });
  }
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const content = `Freigabe-Testbeitrag ${suffix}`;
  let organizationId = "";
  let authorId = "";
  let spaceId = "";
  let postId = "";
  let caseId = "";

  try {
    const [member] = await client<{ organization_id: string }[]>`
      select organization_id from users where email = 'lea@q-academy.de' limit 1
    `;
    organizationId = member.organization_id;
    const [author] = await client<{ id: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values (
        ${organizationId}, ${`queue-author-${suffix}@example.invalid`},
        'not-a-login', 'Queue', 'Autor'
      )
      returning id
    `;
    authorId = author.id;
    const area = await ensureCommunityAreaFixture(client, organizationId);
    const [space] = await client<{ id: string }[]>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Queue ${suffix}`},
        ${`queue-${suffix}`}, 'Isolierter Moderationswarteschlangen-Test',
        '#4f7cac', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [post] = await client<{ id: string }[]>`
      insert into posts (
        organization_id, space_id, author_id, title, content,
        moderation_state, moderation_version, published_at
      ) values (
        ${organizationId}, ${spaceId}, ${authorId}, 'Freigabe erforderlich',
        ${content}, 'pending', 1, null
      )
      returning id
    `;
    postId = post.id;
    const [moderationCase] = await client<{ id: string }[]>`
      insert into community_moderation_cases (
        organization_id, target_type, target_id, target_author_id,
        content_version, policy_version, reason, priority, status,
        decision_version
      ) values (
        ${organizationId}, 'post', ${postId}, ${authorId},
        1, 1, 'approval_required', 60, 'open', 1
      )
      returning id
    `;
    caseId = moderationCase.id;

    await loginAsAdmin(page);
    await page.goto("/admin/community");
    const item = page.locator(`#moderation-case-${caseId}`);
    await expect(item.getByText(content, { exact: true })).toBeVisible();
    await expect(
      item
        .getByText(adminCopy.queue.reasons.approval_required, { exact: true })
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await item.getByRole("button", { name: adminCopy.queue.claim }).click();
    await expect(
      item.getByText(adminCopy.queue.claimedByYou, { exact: true }),
    ).toBeVisible();
    await item.getByRole("button", { name: adminCopy.queue.approve }).click();
    const dialog = page.getByRole("dialog", {
      name: adminCopy.queue.decisionTitles.approve,
    });
    await dialog
      .getByLabel(adminCopy.queue.note)
      .fill("Inhalt entspricht den Community-Regeln.");
    await dialog
      .getByRole("button", { name: adminCopy.queue.saveDecision })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`#moderation-case-${caseId}`)).toHaveCount(0);

    const [stored] = await client<
      {
        moderation_state: string;
        moderation_version: number;
        published_at: Date | null;
        status: string;
        decision_version: number;
      }[]
    >`
      select p.moderation_state, p.moderation_version, p.published_at,
             c.status, c.decision_version
      from posts p
      inner join community_moderation_cases c
        on c.target_id = p.id and c.organization_id = p.organization_id
      where p.id = ${postId} and c.id = ${caseId}
    `;
    expect(stored).toMatchObject({
      moderation_state: "published",
      moderation_version: 2,
      status: "resolved",
      decision_version: 3,
    });
    expect(stored.published_at).toBeInstanceOf(Date);

    await page.context().clearCookies();
    await loginAsMember(page);
    await page.goto("/academy/community");
    await expect(
      page.locator(`#post-${postId}`).getByText(content),
    ).toBeVisible();
  } finally {
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
      await client`delete from community_reports where case_id = ${caseId}`;
      await client`delete from community_moderation_cases where id = ${caseId}`;
    }
    if (postId || caseId) {
      await client`
        delete from activity_events
        where entity_id = any(${[postId, caseId].filter(Boolean)}::uuid[])
      `;
    }
    if (spaceId)
      await client`delete from community_spaces where id = ${spaceId}`;
    if (authorId) await client`delete from users where id = ${authorId}`;
    await client.end();
  }
});
