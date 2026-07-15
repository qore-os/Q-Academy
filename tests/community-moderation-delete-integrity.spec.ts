import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

import { ensureCommunityAreaFixture } from "./helpers/community-area";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function apiHeaders(secret: string, idempotencyKey: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Idempotency-Key": idempotencyKey,
  };
}

async function expectConflict(
  response: Awaited<ReturnType<APIRequestContext["delete"]>>,
) {
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: "conflict",
  });
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("hard deletes cannot orphan open, reviewing or appealed moderation cases", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "database integrity runs once");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false, max: 4 });
  const suffix = randomUUID().slice(0, 8);
  const memberSecret = `qak_delete_member_${randomBytes(24).toString("base64url")}`;
  const adminSecret = `qak_delete_admin_${randomBytes(24).toString("base64url")}`;
  let organizationId = "";

  try {
    const [organization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (
        ${`Moderation delete integrity ${suffix}`},
        ${`moderation-delete-integrity-${suffix}`}
      )
      returning id
    `;
    organizationId = organization.id;

    const actors = await sql<
      Array<{ id: string; email: string; role: string }>
    >`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (
          ${organizationId}, ${`delete-member-${suffix}@example.test`},
          'not-a-login-hash', 'Delete', 'Member', 'member', 'active'
        ),
        (
          ${organizationId}, ${`delete-admin-${suffix}@example.test`},
          'not-a-login-hash', 'Delete', 'Admin', 'admin', 'active'
        )
      returning id, email, role
    `;
    const memberId = actors.find((actor) => actor.role === "member")!.id;
    const adminId = actors.find((actor) => actor.role === "admin")!.id;

    await sql`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values
        (
          ${organizationId}, ${memberId}, 'Delete integrity member',
          ${memberSecret.slice(0, 20)},
          ${createHash("sha256").update(memberSecret).digest("hex")},
          array['community:read', 'community:write']
        ),
        (
          ${organizationId}, ${adminId}, 'Delete integrity admin',
          ${adminSecret.slice(0, 20)},
          ${createHash("sha256").update(adminSecret).digest("hex")},
          array['community:read', 'community:write']
        )
    `;

    const area = await ensureCommunityAreaFixture(sql, organizationId);

    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, 'Delete integrity',
        ${`delete-integrity-${suffix}`},
        'Isolated moderation deletion integrity test', '#2b9188', 'open',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;

    const content = await sql<
      Array<{ id: string; marker: "open" | "parent" | "appealed" }>
    >`
      insert into posts (
        organization_id, space_id, author_id, title, content,
        moderation_state, moderation_version, published_at
      ) values
        (
          ${organizationId}, ${space.id}, ${memberId}, 'Open case',
          'Pending post with an open moderation case',
          'pending', 1, null
        ),
        (
          ${organizationId}, ${space.id}, ${memberId}, 'Comment parent',
          'Published parent for a reviewing comment',
          'published', 1, now()
        ),
        (
          ${organizationId}, ${space.id}, ${memberId}, 'Appealed case',
          'Rejected post with an unresolved appeal',
          'published', 1, now()
        )
      returning id,
        case title
          when 'Open case' then 'open'
          when 'Comment parent' then 'parent'
          else 'appealed'
        end as marker
    `;
    const openPostId = content.find((post) => post.marker === "open")!.id;
    const parentPostId = content.find((post) => post.marker === "parent")!.id;
    const appealedPostId = content.find(
      (post) => post.marker === "appealed",
    )!.id;
    await sql`
      update posts
      set moderation_state = 'rejected', moderation_version = 2,
          moderated_by_id = ${adminId}, moderated_at = now()
      where id = ${appealedPostId} and organization_id = ${organizationId}
    `;

    const [reviewingComment] = await sql<Array<{ id: string }>>`
      insert into comments (
        organization_id, post_id, author_id, content,
        moderation_state, moderation_version, published_at
      ) values (
        ${organizationId}, ${parentPostId}, ${memberId},
        'Pending comment under review', 'pending', 1, null
      )
      returning id
    `;

    const cases = await sql<
      Array<{ id: string; status: "open" | "reviewing" | "appealed" }>
    >`
      insert into community_moderation_cases (
        organization_id, target_type, target_id, target_author_id,
        content_version, policy_version, reason, priority, status,
        claimed_by_id, claimed_at, resolved_by_id, resolved_at,
        decision_version
      ) values
        (
          ${organizationId}, 'post', ${openPostId}, ${memberId},
          1, 1, 'approval_required', 60, 'open',
          null, null, null, null, 1
        ),
        (
          ${organizationId}, 'comment', ${reviewingComment.id}, ${memberId},
          1, 1, 'manual', 50, 'reviewing',
          ${adminId}, now(), null, null, 2
        ),
        (
          ${organizationId}, 'post', ${appealedPostId}, ${memberId},
          2, 1, 'manual', 50, 'appealed',
          ${adminId}, now(), ${adminId}, now(), 3
        )
      returning id, status
    `;
    const appealedCaseId = cases.find(
      (moderationCase) => moderationCase.status === "appealed",
    )!.id;
    const [appeal] = await sql<Array<{ id: string }>>`
      insert into community_moderation_appeals (
        organization_id, case_id, appellant_id, statement, decision_version
      ) values (
        ${organizationId}, ${appealedCaseId}, ${memberId},
        'This rejection needs an independent review.', 3
      )
      returning id
    `;

    await expectConflict(
      await request.delete(`/api/v1/community/posts/${openPostId}`, {
        headers: apiHeaders(memberSecret, `delete-open-${suffix}`),
      }),
    );
    await expectConflict(
      await request.delete(
        `/api/v1/community/comments/${reviewingComment.id}`,
        {
          headers: apiHeaders(memberSecret, `delete-reviewing-${suffix}`),
        },
      ),
    );
    await expectConflict(
      await request.delete(`/api/v1/community/posts/${appealedPostId}`, {
        headers: apiHeaders(memberSecret, `delete-appealed-${suffix}`),
      }),
    );
    await expectConflict(
      await request.delete(`/api/v1/community/spaces/${space.id}`, {
        headers: apiHeaders(adminSecret, `delete-space-${suffix}`),
      }),
    );

    const [preserved] = await sql<
      Array<{
        spaces: number;
        posts: number;
        comments: number;
        active_cases: number;
        open_appeals: number;
      }>
    >`
      select
        (select count(*)::int from community_spaces
          where id = ${space.id}) as spaces,
        (select count(*)::int from posts
          where id = any(${[openPostId, parentPostId, appealedPostId]}::uuid[])) as posts,
        (select count(*)::int from comments
          where id = ${reviewingComment.id}) as comments,
        (select count(*)::int from community_moderation_cases
          where organization_id = ${organizationId}
            and status in ('open', 'reviewing', 'appealed')) as active_cases,
        (select count(*)::int from community_moderation_appeals
          where id = ${appeal.id} and resolution_action is null) as open_appeals
    `;
    expect(preserved).toEqual({
      spaces: 1,
      posts: 3,
      comments: 1,
      active_cases: 3,
      open_appeals: 1,
    });
  } finally {
    if (organizationId) {
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = 'replica'`;
        await transaction`
          delete from community_moderation_events
          where organization_id = ${organizationId}
        `;
      });
      await sql`delete from organizations where id = ${organizationId}`;
    }
    await sql.end();
  }
});

test("parallel legacy admin rejection is non-destructive and creates one decision", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "database integrity runs once");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false, max: 4 });
  const suffix = randomUUID().slice(0, 8);
  const startedAt = new Date(Date.now() - 1_000);
  const contexts: BrowserContext[] = [];
  let organizationId = "";
  let authorId = "";
  let spaceId = "";
  let postId = "";
  let caseId = "";

  try {
    const [actors] = await sql<
      Array<{ organization_id: string; author_id: string }>
    >`
      select admin.organization_id, author.id as author_id
      from users admin
      join users author
        on author.organization_id = admin.organization_id
       and author.email = 'jonas@q-academy.de'
      where admin.email = 'admin@q-academy.de'
      limit 1
    `;
    organizationId = actors.organization_id;
    authorId = actors.author_id;
    const area = await ensureCommunityAreaFixture(sql, organizationId);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Parallel rejection ${suffix}`},
        ${`parallel-rejection-${suffix}`},
        'Isolated parallel legacy rejection test', '#2b9188', 'open',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [post] = await sql<Array<{ id: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content
      ) values (
        ${organizationId}, ${spaceId}, ${authorId},
        ${`Parallel rejection ${suffix}`},
        ${`Exactly one manual rejection ${suffix}`}
      )
      returning id
    `;
    postId = post.id;

    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    contexts.push(firstContext, secondContext);
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    await Promise.all([loginAsAdmin(firstPage), loginAsAdmin(secondPage)]);
    await Promise.all([
      firstPage.goto("/admin/community"),
      secondPage.goto("/admin/community"),
    ]);

    const pages = [firstPage, secondPage];
    await Promise.all(
      pages.map(async (page) => {
        const item = page.locator(`#post-${postId}`);
        await expect(item).toBeVisible();
        await item.getByRole("button", { name: "Beitrag ablehnen" }).click();
        await expect(
          page.getByRole("dialog", { name: "Beitrag ablehnen" }),
        ).toBeVisible();
      }),
    );
    await Promise.all(
      pages.map((page) =>
        page
          .getByRole("dialog", { name: "Beitrag ablehnen" })
          .getByRole("button", { name: "Ablehnen", exact: true })
          .click(),
      ),
    );
    await Promise.all(
      pages.map((page) =>
        expect(page.locator("[data-sonner-toast]")).toBeVisible(),
      ),
    );

    await expect
      .poll(async () => {
        const [state] = await sql<
          Array<{
            post_count: number;
            moderation_state: string | null;
            moderation_version: number | null;
            case_count: number;
            resolved_cases: number;
            flagged_events: number;
            rejected_events: number;
            author_notifications: number;
          }>
        >`
          select
            (select count(*)::int from posts where id = ${postId}) as post_count,
            (select moderation_state::text from posts where id = ${postId}) as moderation_state,
            (select moderation_version from posts where id = ${postId}) as moderation_version,
            (select count(*)::int from community_moderation_cases
              where organization_id = ${organizationId}
                and target_type = 'post' and target_id = ${postId}) as case_count,
            (select count(*)::int from community_moderation_cases
              where organization_id = ${organizationId}
                and target_type = 'post' and target_id = ${postId}
                and status = 'resolved') as resolved_cases,
            (select count(*)::int from community_moderation_events event
              join community_moderation_cases moderation_case
                on moderation_case.id = event.case_id
               and moderation_case.organization_id = event.organization_id
              where moderation_case.organization_id = ${organizationId}
                and moderation_case.target_id = ${postId}
                and event.action = 'flagged') as flagged_events,
            (select count(*)::int from community_moderation_events event
              join community_moderation_cases moderation_case
                on moderation_case.id = event.case_id
               and moderation_case.organization_id = event.organization_id
              where moderation_case.organization_id = ${organizationId}
                and moderation_case.target_id = ${postId}
                and event.action = 'rejected') as rejected_events,
            (select count(*)::int from notifications
              where user_id = ${authorId}
                and title = 'Community-Inhalt moderiert'
                and created_at >= ${startedAt}) as author_notifications
        `;
        return state;
      })
      .toEqual({
        post_count: 1,
        moderation_state: "rejected",
        moderation_version: 2,
        case_count: 1,
        resolved_cases: 1,
        flagged_events: 1,
        rejected_events: 1,
        author_notifications: 1,
      });

    const [moderationCase] = await sql<Array<{ id: string }>>`
      select id from community_moderation_cases
      where organization_id = ${organizationId}
        and target_type = 'post' and target_id = ${postId}
      limit 1
    `;
    caseId = moderationCase.id;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (caseId) {
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = 'replica'`;
        await transaction`
          delete from community_moderation_events where case_id = ${caseId}
        `;
      });
      await sql`delete from community_moderation_assessments where case_id = ${caseId}`;
      await sql`delete from community_moderation_appeals where case_id = ${caseId}`;
      await sql`delete from community_reports where case_id = ${caseId}`;
      await sql`delete from community_moderation_cases where id = ${caseId}`;
    }
    if (authorId) {
      await sql`
        delete from notifications
        where user_id = ${authorId}
          and title = 'Community-Inhalt moderiert'
          and created_at >= ${startedAt}
      `;
    }
    if (spaceId) await sql`delete from community_spaces where id = ${spaceId}`;
    await sql.end();
  }
});
