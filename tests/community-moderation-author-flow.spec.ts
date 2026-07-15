import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { ensureCommunityAreaFixture } from "./helpers/community-area";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("member sees only own moderation submissions and can appeal at 360px", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 360, height: 800 });
  }

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ownContent = `Eigene verborgene Einreichung ${suffix}`;
  const foreignContent = `Fremde verborgene Einreichung ${suffix}`;
  const appealStatement = `Die Entscheidung zu ${suffix} sollte erneut geprueft werden.`;
  let organizationId = "";
  let spaceId = "";
  let ownCaseId = "";
  let foreignCaseId = "";

  try {
    const [member] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    const [foreignAuthor] = await client<{ id: string }[]>`
      select id
      from users
      where organization_id = ${member.organization_id}
        and email = 'jonas@q-academy.de'
      limit 1
    `;
    const [reviewer] = await client<{ id: string }[]>`
      select id
      from users
      where organization_id = ${member.organization_id}
        and role in ('owner', 'admin')
        and status = 'active'
      order by case when email = 'admin@q-academy.de' then 0 else 1 end, id
      limit 1
    `;
    organizationId = member.organization_id;
    const area = await ensureCommunityAreaFixture(client, organizationId);
    const [space] = await client<{ id: string }[]>`
      insert into community_spaces (
        organization_id,
        area_id,
        title,
        slug,
        description,
        color,
        sort_order
      ) values (
        ${organizationId},
        ${area.id},
        ${`Author Flow ${suffix}`},
        ${`author-flow-${suffix}`},
        'Isolierter Autoren-Moderationstest',
        '#2b9188',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [ownPost] = await client<{ id: string }[]>`
      insert into posts (
        organization_id,
        space_id,
        author_id,
        title,
        content,
        moderation_state,
        moderation_version,
        published_at,
        moderated_at,
        moderated_by_id
      ) values (
        ${organizationId},
        ${spaceId},
        ${member.id},
        'Eigener Prueffall',
        ${ownContent},
        'rejected',
        2,
        null,
        now() - interval '2 days',
        ${reviewer.id}
      )
      returning id
    `;
    const [foreignPost] = await client<{ id: string }[]>`
      insert into posts (
        organization_id,
        space_id,
        author_id,
        title,
        content,
        moderation_state,
        moderation_version,
        published_at,
        moderated_at,
        moderated_by_id
      ) values (
        ${organizationId},
        ${spaceId},
        ${foreignAuthor.id},
        'Fremder Prueffall',
        ${foreignContent},
        'rejected',
        2,
        null,
        now() - interval '2 days',
        ${reviewer.id}
      )
      returning id
    `;
    const [ownCase] = await client<{ id: string }[]>`
      insert into community_moderation_cases (
        organization_id,
        target_type,
        target_id,
        target_author_id,
        content_version,
        policy_version,
        reason,
        priority,
        status,
        resolved_by_id,
        resolved_at,
        decision_version
      ) values (
        ${organizationId},
        'post',
        ${ownPost.id},
        ${member.id},
        2,
        1,
        'report_threshold',
        90,
        'resolved',
        ${reviewer.id},
        now() - interval '2 days',
        2
      )
      returning id
    `;
    ownCaseId = ownCase.id;
    const [foreignCase] = await client<{ id: string }[]>`
      insert into community_moderation_cases (
        organization_id,
        target_type,
        target_id,
        target_author_id,
        content_version,
        policy_version,
        reason,
        priority,
        status,
        resolved_by_id,
        resolved_at,
        decision_version
      ) values (
        ${organizationId},
        'post',
        ${foreignPost.id},
        ${foreignAuthor.id},
        2,
        1,
        'manual',
        80,
        'resolved',
        ${reviewer.id},
        now() - interval '2 days',
        2
      )
      returning id
    `;
    foreignCaseId = foreignCase.id;
    await client`
      insert into community_reports (
        organization_id,
        case_id,
        reporter_id,
        target_type,
        target_id,
        target_author_id,
        content_excerpt,
        reason,
        details
      ) values (
        ${organizationId},
        ${ownCaseId},
        ${foreignAuthor.id},
        'post',
        ${ownPost.id},
        ${member.id},
        'Interner Meldungsauszug',
        'spam',
        'Interne Reporter-Begruendung darf nicht erscheinen.'
      )
    `;

    await loginAsMember(page);
    await page.goto("/academy/community");

    const submissions = page.getByRole("region", {
      name: "Meine Einreichungen",
    });
    const ownSubmission = submissions.locator(
      `#own-community-submission-${ownCaseId}`,
    );
    const feed = page.getByRole("region", {
      name: "Persoenlicher Community-Feed",
    });
    await expect(submissions).toBeVisible();
    await expect(
      ownSubmission.getByText(ownContent, { exact: true }),
    ).toBeVisible();
    await expect(
      ownSubmission.getByText("Community-Pruefung erforderlich", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ownSubmission.getByText("Abgelehnt", { exact: true }),
    ).toBeVisible();
    await expect(ownSubmission.getByText(/Einspruchsfrist bis/)).toBeVisible();
    await expect(
      submissions.getByText(foreignContent, { exact: true }),
    ).toHaveCount(0);
    await expect(
      submissions.getByText(
        "Interne Reporter-Begruendung darf nicht erscheinen.",
      ),
    ).toHaveCount(0);
    await expect(feed.getByText(ownContent, { exact: true })).toHaveCount(0);
    await expect(feed.getByText(foreignContent, { exact: true })).toHaveCount(
      0,
    );

    await ownSubmission
      .getByRole("button", { name: "Einspruch einlegen" })
      .click();
    const statement = ownSubmission.getByLabel("Begruendung des Einspruchs");
    const submit = ownSubmission.getByRole("button", {
      name: "Einspruch senden",
    });
    await statement.fill("ab");
    await expect(submit).toBeDisabled();
    await statement.fill(appealStatement);
    await expect(submit).toBeEnabled();

    if (testInfo.project.name === "mobile") {
      const box = await submissions.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }

    await submit.click();
    await expect(
      ownSubmission.getByText("Einspruch in Pruefung", { exact: true }),
    ).toBeVisible();
    await expect(
      ownSubmission.getByText(/Einspruch eingereicht am/),
    ).toBeVisible();
    await expect(
      ownSubmission.getByRole("button", { name: "Einspruch einlegen" }),
    ).toHaveCount(0);

    const [stored] = await client<
      {
        case_status: string;
        appellant_id: string;
        statement: string;
        resolution_action: string | null;
      }[]
    >`
      select
        moderation_case.status as case_status,
        appeal.appellant_id,
        appeal.statement,
        appeal.resolution_action
      from community_moderation_cases moderation_case
      inner join community_moderation_appeals appeal
        on appeal.case_id = moderation_case.id
       and appeal.organization_id = moderation_case.organization_id
      where moderation_case.id = ${ownCaseId}
    `;
    expect(stored).toEqual({
      case_status: "appealed",
      appellant_id: member.id,
      statement: appealStatement,
      resolution_action: null,
    });
  } finally {
    if (organizationId) {
      await client.begin(async (sqlClient) => {
        await sqlClient`set local session_replication_role = 'replica'`;
        await sqlClient`
          delete from community_moderation_events
          where organization_id = ${organizationId}
            and case_id = any(${[ownCaseId, foreignCaseId].filter(Boolean)}::uuid[])
        `;
      });
      await client`
        delete from community_reports
        where organization_id = ${organizationId}
          and case_id = any(${[ownCaseId, foreignCaseId].filter(Boolean)}::uuid[])
      `;
      await client`
        delete from community_moderation_appeals
        where organization_id = ${organizationId}
          and case_id = any(${[ownCaseId, foreignCaseId].filter(Boolean)}::uuid[])
      `;
      await client`
        delete from community_moderation_cases
        where organization_id = ${organizationId}
          and id = any(${[ownCaseId, foreignCaseId].filter(Boolean)}::uuid[])
      `;
    }
    if (spaceId) {
      await client`delete from community_spaces where id = ${spaceId}`;
    }
    await client.end();
  }
});
