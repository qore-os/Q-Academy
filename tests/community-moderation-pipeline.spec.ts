import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { getCommunityNotificationCopy } from "../src/lib/i18n/community-actions";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { ensureCommunityAreaFixture } from "./helpers/community-area";

const adminCopy = getCommunityAdminCopy("de");
const notificationCopy = getCommunityNotificationCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function apiHeaders(secret: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${secret}`,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: "Bei Q-Academy anmelden" }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function apiFeedContains(
  request: APIRequestContext,
  secret: string,
  postId: string,
) {
  const response = await request.get(
    "/api/v1/community/feed?mode=latest&limit=50",
    { headers: apiHeaders(secret) },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    data: { items: Array<{ id: string }> };
  };
  return body.data.items.some((post) => post.id === postId);
}

async function apiSearchContains(
  request: APIRequestContext,
  secret: string,
  marker: string,
  postId: string,
) {
  const response = await request.get(
    `/api/v1/search?types=community&limit=50&q=${encodeURIComponent(marker)}`,
    { headers: apiHeaders(secret) },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  return body.data.some((result) => result.id === postId);
}

async function expectApiMediaDownload(
  request: APIRequestContext,
  secret: string,
  assetId: string,
  expectedStatus: 200 | 404,
) {
  const initial = await request.get(
    `/api/v1/media-assets/${assetId}/download`,
    {
      headers: apiHeaders(secret),
      maxRedirects: 0,
    },
  );
  if (expectedStatus === 404) {
    expect(initial.status()).toBe(404);
    return;
  }
  expect(initial.status()).toBe(307);
  const location = initial.headers().location;
  expect(location).toBeTruthy();
  const download = await request.get(location!, {
    headers: apiHeaders(secret),
  });
  expect(download.status()).toBe(200);
}

async function openAdminModerationCase(page: Page, caseId: string) {
  await page.goto("/admin/community");
  const item = page.locator(`#moderation-case-${caseId}`);
  await expect(item).toBeVisible();
  return item;
}

async function createAdminPair(browser: Browser) {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  await Promise.all([loginAsAdmin(firstPage), loginAsAdmin(secondPage)]);
  return { firstContext, secondContext, firstPage, secondPage };
}

async function closeContexts(contexts: readonly BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

async function waitForActionToast(pages: readonly Page[]) {
  await Promise.all(
    pages.map((page) =>
      expect(page.locator("[data-sonner-toast]")).toBeVisible(),
    ),
  );
}

test("moderated create and report lifecycle keeps publication effects exact under races", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "P0 pipeline runs once");
  test.setTimeout(180_000);

  const sql = postgres(databaseUrl, { prepare: false, max: 6 });
  const startedAt = new Date(Date.now() - 1_000);
  const suffix = randomUUID().slice(0, 8);
  const marker = `P0PIPE-${suffix}`;
  const content = `${marker} wartet auf Freigabe und erwaehnt @lea.`;
  const apiSecret = `qak_p0_pipeline_${randomBytes(24).toString("base64url")}`;
  let organizationId = "";
  let adminId = "";
  let authorId = "";
  let firstReporterId = "";
  let secondReporterId = "";
  let originalAuthorPoints = 0;
  let originalAuthorCommunityPoints = 0;
  let spaceId = "";
  let postId = "";
  let approvalCaseId = "";
  let reportCaseId = "";
  let apiKeyId = "";
  let webhookId = "";
  let assetId = "";
  let storagePath = "";
  let notifyingFollowerId = "";
  let silentFollowerId = "";
  let inactiveFollowerId = "";

  try {
    const [actors] = await sql<
      Array<{
        organization_id: string;
        admin_id: string;
        author_id: string;
        first_reporter_id: string;
        second_reporter_id: string;
        author_points: number;
        author_community_points: number;
      }>
    >`
      select author.organization_id,
             admin.id as admin_id,
             author.id as author_id,
             first_reporter.id as first_reporter_id,
             second_reporter.id as second_reporter_id,
             author.points as author_points,
             author.community_points as author_community_points
      from users author
      join users admin
        on admin.organization_id = author.organization_id
       and admin.email = 'admin@q-academy.de'
      join users first_reporter
        on first_reporter.organization_id = author.organization_id
       and first_reporter.email = 'lea@q-academy.de'
      join users second_reporter
        on second_reporter.organization_id = author.organization_id
       and second_reporter.email = 'aylin@q-academy.de'
      where author.email = 'jonas@q-academy.de'
      limit 1
    `;
    organizationId = actors.organization_id;
    adminId = actors.admin_id;
    authorId = actors.author_id;
    firstReporterId = actors.first_reporter_id;
    secondReporterId = actors.second_reporter_id;
    originalAuthorPoints = actors.author_points;
    originalAuthorCommunityPoints = actors.author_community_points;

    const followers = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (${organizationId}, ${`notify-${suffix}@example.test`}, 'unused', 'Notify', 'Follower', 'member', 'active'),
        (${organizationId}, ${`silent-${suffix}@example.test`}, 'unused', 'Silent', 'Follower', 'member', 'active'),
        (${organizationId}, ${`inactive-${suffix}@example.test`}, 'unused', 'Inactive', 'Follower', 'member', 'active')
      returning id
    `;
    [notifyingFollowerId, silentFollowerId, inactiveFollowerId] = followers.map(
      (follower) => follower.id,
    );

    const area = await ensureCommunityAreaFixture(sql, organizationId);

    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`P0 Pipeline ${suffix}`},
        ${`p0-pipeline-${suffix}`}, 'Isolierter P0-Pipeline-Test',
        '#2b9188', 'open', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    await sql`
      insert into community_follows (
        organization_id, follower_id, target_type, target_author_id,
        target_space_id, notify
      ) values
        (${organizationId}, ${notifyingFollowerId}, 'author', ${authorId}, null, true),
        (${organizationId}, ${notifyingFollowerId}, 'space', null, ${spaceId}, true),
        (${organizationId}, ${silentFollowerId}, 'author', ${authorId}, null, false),
        (${organizationId}, ${inactiveFollowerId}, 'space', null, ${spaceId}, true)
    `;
    await sql`
      insert into community_space_moderation_policies (
        organization_id, space_id, post_approval, comment_approval,
        automation_mode, report_threshold, duplicate_window_minutes,
        link_limit, version, updated_by_id
      ) values (
        ${organizationId}, ${spaceId}, 'members', 'members', 'off',
        2, 60, 10, 1, ${adminId}
      )
    `;

    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values (
        ${organizationId}, ${authorId}, ${`P0 Pipeline ${suffix}`},
        ${apiSecret.slice(0, 20)},
        ${createHash("sha256").update(apiSecret).digest("hex")},
        array['community:read', 'community:write', 'search:read']
      )
      returning id
    `;
    apiKeyId = apiKey.id;
    const [webhook] = await sql<Array<{ id: string }>>`
      insert into webhooks (
        organization_id, name, url, signing_secret_encrypted,
        events, active, created_by_id
      ) values (
        ${organizationId}, ${`P0 Pipeline ${suffix}`},
        'https://example.invalid/p0-pipeline', 'isolated-test-secret',
        array['community.post.created'], true, ${adminId}
      )
      returning id
    `;
    webhookId = webhook.id;

    assetId = randomUUID();
    const assetBody = Buffer.from(`p0-pipeline-media-${suffix}`, "utf8");
    const storageKey = `tenants/${organizationId}/assets/${assetId}/pipeline.txt`;
    storagePath = resolve(
      process.cwd(),
      ".data",
      "media",
      ...storageKey.split("/"),
    );
    await mkdir(dirname(storagePath), { recursive: true });
    await writeFile(storagePath, assetBody);
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes,
        quota_bytes, content_sha256, upload_expires_at, uploaded_at,
        scan_completed_at
      ) values (
        ${assetId}, ${organizationId}, ${authorId}, ${authorId}, 'community',
        'document', 'ready', 'filesystem', ${storageKey},
        ${`incoming/${storageKey}`}, 'pipeline.txt', 'pipeline.txt',
        'text/plain', 'text/plain', ${assetBody.byteLength},
        ${assetBody.byteLength}, ${assetBody.byteLength},
        ${createHash("sha256").update(assetBody).digest("hex")},
        now() + interval '1 hour', now(), now()
      )
    `;

    const createdResponse = await request.post("/api/v1/community/posts", {
      headers: apiHeaders(apiSecret, `pending-create-${suffix}`),
      data: {
        spaceId,
        authorId,
        title: `Freigabe ${marker}`,
        content,
        attachmentIds: [assetId],
      },
    });
    expect(createdResponse.status()).toBe(201);
    const createdBody = (await createdResponse.json()) as {
      data: {
        id: string;
        moderationState: string;
        moderationVersion: number;
        publishedAt: string | null;
      };
    };
    postId = createdBody.data.id;
    expect(createdBody.data).toMatchObject({
      moderationState: "pending",
      moderationVersion: 1,
      publishedAt: null,
    });
    const [approvalCase] = await sql<
      Array<{
        id: string;
        status: string;
        reason: string;
        decision_version: number;
        content_version: number;
      }>
    >`
      select id, status, reason, decision_version, content_version
      from community_moderation_cases
      where organization_id = ${organizationId}
        and target_type = 'post'
        and target_id = ${postId}
      order by created_at desc, id desc
      limit 1
    `;
    approvalCaseId = approvalCase.id;
    expect(approvalCase).toMatchObject({
      status: "open",
      reason: "approval_required",
      decision_version: 1,
      content_version: 1,
    });

    const [unpublishedSideEffects] = await sql<
      Array<{
        activities: number;
        point_transactions: number;
        mentions: number;
        mention_notifications: number;
        follower_notifications: number;
        silent_follow_notifications: number;
        inactive_follow_notifications: number;
        webhook_deliveries: number;
      }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${postId} and type = 'post.created') as activities,
        (select count(*)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${postId}
            and reason = 'community.post.created') as point_transactions,
        (select count(*)::int from community_mentions
          where organization_id = ${organizationId}
            and post_id = ${postId}) as mentions,
        (select count(*)::int from notifications
          where user_id = ${firstReporterId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = ${notificationCopy.mentionTitle}) as mention_notifications,
        (select count(*)::int from notifications
          where user_id = ${notifyingFollowerId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = 'Neuer Community-Beitrag') as follower_notifications,
        (select count(*)::int from notifications
          where user_id = ${silentFollowerId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = 'Neuer Community-Beitrag') as silent_follow_notifications,
        (select count(*)::int from notifications
          where user_id = ${inactiveFollowerId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = 'Neuer Community-Beitrag') as inactive_follow_notifications,
        (select count(*)::int from webhook_deliveries
          where organization_id = ${organizationId}
            and event = 'community.post.created'
            and payload -> 'data' ->> 'id' = ${postId}) as webhook_deliveries
    `;
    expect(unpublishedSideEffects).toEqual({
      activities: 0,
      point_transactions: 0,
      mentions: 0,
      mention_notifications: 0,
      follower_notifications: 0,
      silent_follow_notifications: 0,
      inactive_follow_notifications: 0,
      webhook_deliveries: 0,
    });
    expect(await apiFeedContains(request, apiSecret, postId)).toBe(false);
    expect(await apiSearchContains(request, apiSecret, marker, postId)).toBe(
      false,
    );
    expect(
      (
        await request.get(`/api/v1/community/posts/${postId}`, {
          headers: apiHeaders(apiSecret),
        })
      ).status(),
    ).toBe(404);
    await expectApiMediaDownload(request, apiSecret, assetId, 404);

    await sql`
      update users set status = 'disabled'
      where id = ${inactiveFollowerId} and organization_id = ${organizationId}
    `;

    const claimAdmins = await createAdminPair(browser);
    const [claimItemOne, claimItemTwo] = await Promise.all([
      openAdminModerationCase(claimAdmins.firstPage, approvalCaseId),
      openAdminModerationCase(claimAdmins.secondPage, approvalCaseId),
    ]);
    const claimOne = claimItemOne.getByRole("button", {
      name: adminCopy.queue.claim,
    });
    const claimTwo = claimItemTwo.getByRole("button", {
      name: adminCopy.queue.claim,
    });
    await expect(claimOne).toBeVisible();
    await expect(claimTwo).toBeVisible();
    await Promise.all([claimOne.click(), claimTwo.click()]);
    await waitForActionToast([claimAdmins.firstPage, claimAdmins.secondPage]);
    const [claimedState] = await sql<
      Array<{
        status: string;
        decision_version: number;
        claimed_by_id: string | null;
        claim_events: number;
      }>
    >`
      select moderation_case.status, moderation_case.decision_version,
             moderation_case.claimed_by_id,
             (select count(*)::int from activity_events event
               where event.organization_id = moderation_case.organization_id
                 and event.entity_id = moderation_case.id
                 and event.type = 'community_moderation.case_claimed') as claim_events
      from community_moderation_cases moderation_case
      where moderation_case.id = ${approvalCaseId}
    `;
    expect(claimedState).toEqual({
      status: "reviewing",
      decision_version: 2,
      claimed_by_id: adminId,
      claim_events: 1,
    });

    const decisionItems = await Promise.all([
      openAdminModerationCase(claimAdmins.firstPage, approvalCaseId),
      openAdminModerationCase(claimAdmins.secondPage, approvalCaseId),
    ]);
    await Promise.all(
      decisionItems.map((item) =>
        item.getByRole("button", { name: adminCopy.queue.approve }).click(),
      ),
    );
    const decisionDialogs = [
      claimAdmins.firstPage.getByRole("dialog", {
        name: adminCopy.queue.decisionTitles.approve,
      }),
      claimAdmins.secondPage.getByRole("dialog", {
        name: adminCopy.queue.decisionTitles.approve,
      }),
    ];
    await Promise.all(
      decisionDialogs.map((dialog) =>
        dialog
          .getByLabel(adminCopy.queue.note)
          .fill("Parallele Freigabe nach P0-Pruefung."),
      ),
    );
    await Promise.all(
      decisionDialogs.map((dialog) =>
        dialog
          .getByRole("button", { name: adminCopy.queue.saveDecision })
          .click(),
      ),
    );
    await waitForActionToast([claimAdmins.firstPage, claimAdmins.secondPage]);
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ state: string; status: string }>>`
          select post.moderation_state as state, moderation_case.status
          from posts post
          join community_moderation_cases moderation_case
            on moderation_case.target_id = post.id
           and moderation_case.organization_id = post.organization_id
          where post.id = ${postId}
            and moderation_case.id = ${approvalCaseId}
        `;
        return row;
      })
      .toEqual({ state: "published", status: "resolved" });
    await closeContexts([claimAdmins.firstContext, claimAdmins.secondContext]);

    const [firstPublishSideEffects] = await sql<
      Array<{
        activities: number;
        point_transactions: number;
        point_amount: number;
        mentions: number;
        mention_notifications: number;
        follower_notifications: number;
        silent_follow_notifications: number;
        inactive_follow_notifications: number;
        webhook_deliveries: number;
        author_points: number;
      }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${postId} and type = 'post.created') as activities,
        (select count(*)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${postId}
            and reason = 'community.post.created') as point_transactions,
        (select coalesce(sum(amount), 0)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${postId}
            and reason = 'community.post.created') as point_amount,
        (select count(*)::int from community_mentions
          where organization_id = ${organizationId}
            and post_id = ${postId}) as mentions,
        (select count(*)::int from notifications
          where user_id = ${firstReporterId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = ${notificationCopy.mentionTitle}) as mention_notifications,
        (select count(*)::int from notifications
          where user_id = ${notifyingFollowerId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = 'Neuer Community-Beitrag') as follower_notifications,
        (select count(*)::int from notifications
          where user_id = ${silentFollowerId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = 'Neuer Community-Beitrag') as silent_follow_notifications,
        (select count(*)::int from notifications
          where user_id = ${inactiveFollowerId}
            and href = ${`/academy/community?post=${postId}#post-${postId}`}
            and title = 'Neuer Community-Beitrag') as inactive_follow_notifications,
        (select count(*)::int from webhook_deliveries
          where organization_id = ${organizationId}
            and event = 'community.post.created'
            and payload -> 'data' ->> 'id' = ${postId}) as webhook_deliveries,
        (select points from users where id = ${authorId}) as author_points
    `;
    expect(firstPublishSideEffects).toEqual({
      activities: 1,
      point_transactions: 1,
      point_amount: 10,
      mentions: 1,
      mention_notifications: 1,
      follower_notifications: 1,
      silent_follow_notifications: 0,
      inactive_follow_notifications: 0,
      webhook_deliveries: 1,
      author_points: originalAuthorPoints + 10,
    });
    expect(await apiFeedContains(request, apiSecret, postId)).toBe(true);
    expect(await apiSearchContains(request, apiSecret, marker, postId)).toBe(
      true,
    );
    await expectApiMediaDownload(request, apiSecret, assetId, 200);

    await sql`
      update community_space_moderation_policies
      set automation_mode = 'enforce', version = 2, updated_at = now()
      where organization_id = ${organizationId} and space_id = ${spaceId}
    `;
    await sql`
      insert into post_likes (organization_id, post_id, user_id, reaction)
      values (${organizationId}, ${postId}, ${firstReporterId}, 'like')
    `;
    await sql`
      insert into community_score_contributions (
        organization_id, recipient_id, actor_id, kind, post_id, points
      ) values (
        ${organizationId}, ${authorId}, ${firstReporterId},
        'post_reaction', ${postId}, 1
      )
    `;
    const [scoreBeforeReports] = await sql<
      Array<{ contribution_count: number; community_points: number }>
    >`
      select
        (select count(*)::int from community_score_contributions
          where organization_id = ${organizationId}
            and post_id = ${postId}) as contribution_count,
        (select community_points from users where id = ${authorId}) as community_points
    `;
    expect(scoreBeforeReports).toEqual({
      contribution_count: 1,
      community_points: originalAuthorCommunityPoints + 1,
    });

    const firstReporterContext = await browser.newContext();
    const secondReporterContext = await browser.newContext();
    const firstReporterPage = await firstReporterContext.newPage();
    const secondReporterPage = await secondReporterContext.newPage();
    await Promise.all([
      loginAsMember(firstReporterPage, "lea@q-academy.de"),
      loginAsMember(secondReporterPage, "aylin@q-academy.de"),
    ]);
    await Promise.all([
      firstReporterPage.goto("/academy/community"),
      secondReporterPage.goto("/academy/community"),
    ]);
    const firstReportPost = firstReporterPage.locator(`#post-${postId}`);
    const secondReportPost = secondReporterPage.locator(`#post-${postId}`);
    await expect(firstReportPost).toBeVisible();
    await expect(secondReportPost).toBeVisible();

    await firstReportPost
      .getByRole("button", { name: "Beitrag melden" })
      .click();
    const firstReportDialog = firstReporterPage.getByRole("dialog", {
      name: "Beitrag melden",
    });
    await firstReportDialog.getByLabel("Grund").selectOption("spam");
    await firstReportDialog
      .getByLabel("Beschreibung (optional)")
      .fill("Erste isolierte P0-Meldung.");
    await firstReportDialog
      .getByRole("button", { name: "Meldung senden" })
      .click();
    await expect(firstReportDialog).toBeHidden();
    const [afterFirstReport] = await sql<
      Array<{ state: string; contribution_count: number }>
    >`
      select post.moderation_state as state,
             (select count(*)::int from community_score_contributions score
               where score.organization_id = post.organization_id
                 and score.post_id = post.id) as contribution_count
      from posts post where post.id = ${postId}
    `;
    expect(afterFirstReport).toEqual({
      state: "published",
      contribution_count: 1,
    });

    await secondReportPost
      .getByRole("button", { name: "Beitrag melden" })
      .click();
    const secondReportDialog = secondReporterPage.getByRole("dialog", {
      name: "Beitrag melden",
    });
    await secondReportDialog.getByLabel("Grund").selectOption("other");
    await secondReportDialog
      .getByLabel("Beschreibung (optional)")
      .fill("Zweite isolierte P0-Meldung erreicht die Schwelle.");
    await secondReportDialog
      .getByRole("button", { name: "Meldung senden" })
      .click();
    await expect(secondReportDialog).toBeHidden();
    await closeContexts([firstReporterContext, secondReporterContext]);

    const [heldByReports] = await sql<
      Array<{
        id: string;
        state: string;
        status: string;
        decision_version: number;
        content_version: number;
        contribution_count: number;
        community_points: number;
      }>
    >`
      select moderation_case.id, post.moderation_state as state,
             moderation_case.status, moderation_case.decision_version,
             moderation_case.content_version,
             (select count(*)::int from community_score_contributions score
               where score.organization_id = post.organization_id
                 and score.post_id = post.id) as contribution_count,
             (select community_points from users where id = ${authorId}) as community_points
      from community_moderation_cases moderation_case
      join posts post
        on post.id = moderation_case.target_id
       and post.organization_id = moderation_case.organization_id
      where moderation_case.organization_id = ${organizationId}
        and moderation_case.target_type = 'post'
        and moderation_case.target_id = ${postId}
        and moderation_case.reason = 'report_threshold'
      order by moderation_case.created_at desc, moderation_case.id desc
      limit 1
    `;
    reportCaseId = heldByReports.id;
    expect(heldByReports).toMatchObject({
      state: "held",
      status: "open",
      contribution_count: 0,
      community_points: originalAuthorCommunityPoints,
    });
    expect(await apiFeedContains(request, apiSecret, postId)).toBe(false);
    expect(await apiSearchContains(request, apiSecret, marker, postId)).toBe(
      false,
    );
    await expectApiMediaDownload(request, apiSecret, assetId, 404);

    const reportDecisionAdmins = await createAdminPair(browser);
    const reportItems = await Promise.all([
      openAdminModerationCase(reportDecisionAdmins.firstPage, reportCaseId),
      openAdminModerationCase(reportDecisionAdmins.secondPage, reportCaseId),
    ]);
    await Promise.all(
      reportItems.map((item) =>
        item.getByRole("button", { name: adminCopy.queue.approve }).click(),
      ),
    );
    const reportDecisionDialogs = [
      reportDecisionAdmins.firstPage.getByRole("dialog", {
        name: adminCopy.queue.decisionTitles.approve,
      }),
      reportDecisionAdmins.secondPage.getByRole("dialog", {
        name: adminCopy.queue.decisionTitles.approve,
      }),
    ];
    await Promise.all(
      reportDecisionDialogs.map((dialog) =>
        dialog
          .getByLabel(adminCopy.queue.note)
          .fill("Meldungen geprueft; Inhalt wird wieder freigegeben."),
      ),
    );
    await Promise.all(
      reportDecisionDialogs.map((dialog) =>
        dialog
          .getByRole("button", { name: adminCopy.queue.saveDecision })
          .click(),
      ),
    );
    await waitForActionToast([
      reportDecisionAdmins.firstPage,
      reportDecisionAdmins.secondPage,
    ]);
    await expect
      .poll(async () => {
        const [state] = await sql<
          Array<{
            moderation_state: string;
            case_status: string;
            contribution_count: number;
            community_points: number;
          }>
        >`
          select post.moderation_state,
                 moderation_case.status as case_status,
                 (select count(*)::int from community_score_contributions score
                   where score.organization_id = post.organization_id
                     and score.post_id = post.id) as contribution_count,
                 (select community_points from users where id = ${authorId}) as community_points
          from posts post
          join community_moderation_cases moderation_case
            on moderation_case.target_id = post.id
           and moderation_case.organization_id = post.organization_id
          where post.id = ${postId}
            and moderation_case.id = ${reportCaseId}
        `;
        return state;
      })
      .toEqual({
        moderation_state: "published",
        case_status: "resolved",
        contribution_count: 1,
        community_points: originalAuthorCommunityPoints + 1,
      });
    await closeContexts([
      reportDecisionAdmins.firstContext,
      reportDecisionAdmins.secondContext,
    ]);

    const [finalEffects] = await sql<
      Array<{
        activities: number;
        point_transactions: number;
        mentions: number;
        webhook_deliveries: number;
        reports_dismissed: number;
      }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${postId} and type = 'post.created') as activities,
        (select count(*)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${postId}
            and reason = 'community.post.created') as point_transactions,
        (select count(*)::int from community_mentions
          where organization_id = ${organizationId}
            and post_id = ${postId}) as mentions,
        (select count(*)::int from webhook_deliveries
          where organization_id = ${organizationId}
            and event = 'community.post.created'
            and payload -> 'data' ->> 'id' = ${postId}) as webhook_deliveries,
        (select count(*)::int from community_reports
          where organization_id = ${organizationId}
            and case_id = ${reportCaseId}
            and status = 'dismissed') as reports_dismissed
    `;
    expect(finalEffects).toEqual({
      activities: 1,
      point_transactions: 1,
      mentions: 1,
      webhook_deliveries: 1,
      reports_dismissed: 2,
    });
    expect(await apiFeedContains(request, apiSecret, postId)).toBe(true);
    expect(await apiSearchContains(request, apiSecret, marker, postId)).toBe(
      true,
    );
    await expectApiMediaDownload(request, apiSecret, assetId, 200);
  } finally {
    if (organizationId) {
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = 'replica'`;
        await transaction`
          delete from community_moderation_events
          where organization_id = ${organizationId}
            and case_id = any(${[approvalCaseId, reportCaseId].filter(Boolean)}::uuid[])
        `;
      });
      await sql`
        delete from community_reports
        where organization_id = ${organizationId}
          and case_id = any(${[approvalCaseId, reportCaseId].filter(Boolean)}::uuid[])
      `;
      await sql`
        delete from community_moderation_appeals
        where organization_id = ${organizationId}
          and case_id = any(${[approvalCaseId, reportCaseId].filter(Boolean)}::uuid[])
      `;
      await sql`
        delete from community_moderation_assessments
        where organization_id = ${organizationId}
          and case_id = any(${[approvalCaseId, reportCaseId].filter(Boolean)}::uuid[])
      `;
      await sql`
        delete from community_moderation_cases
        where organization_id = ${organizationId}
          and id = any(${[approvalCaseId, reportCaseId].filter(Boolean)}::uuid[])
      `;
      await sql`
        delete from notifications
        where user_id = any(${[
          authorId,
          firstReporterId,
          secondReporterId,
          notifyingFollowerId,
          silentFollowerId,
          inactiveFollowerId,
        ].filter(Boolean)}::uuid[])
          and created_at >= ${startedAt}
          and type = 'community'
      `;
      await sql`
        delete from point_transactions
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and entity_id = ${postId || null}::uuid
      `;
      if (authorId) {
        await sql`
          update users
          set points = ${originalAuthorPoints}
          where id = ${authorId} and organization_id = ${organizationId}
        `;
      }
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and (
            entity_id = any(${[postId, approvalCaseId, reportCaseId].filter(Boolean)}::uuid[])
            or type = 'community_report.created'
          )
      `;
      if (webhookId) {
        await sql`delete from webhooks where id = ${webhookId}`;
      }
      if (spaceId) {
        await sql`delete from community_spaces where id = ${spaceId}`;
      }
      if (assetId) {
        await sql`delete from media_assets where id = ${assetId}`;
      }
      if (apiKeyId) {
        await sql`delete from api_audit_logs where api_key_id = ${apiKeyId}`;
        await sql`delete from api_idempotency_keys where api_key_id = ${apiKeyId}`;
        await sql`delete from api_keys where id = ${apiKeyId}`;
      }
      if (notifyingFollowerId || silentFollowerId || inactiveFollowerId) {
        await sql`
          delete from users
          where id = any(${[
            notifyingFollowerId,
            silentFollowerId,
            inactiveFollowerId,
          ].filter(Boolean)}::uuid[])
        `;
      }
      await sql`
        delete from auth_rate_limits
        where action in (
          'community_post_create', 'community_post_create_tenant',
          'community_report', 'community_report_tenant'
        )
      `;
    }
    if (storagePath) await unlink(storagePath).catch(() => undefined);
    await sql.end();
  }
});

test("enforce mode analyzes post titles and holds duplicate submissions before side effects", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "P0 enforcement runs once");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false, max: 4 });
  const suffix = randomUUID().slice(0, 8);
  const marker = `P0ENFORCE-${suffix}`;
  const apiSecret = `qak_p0_enforce_${randomBytes(24).toString("base64url")}`;
  let organizationId = "";
  let adminId = "";
  let authorId = "";
  let originalAuthorPoints = 0;
  let spaceId = "";
  let apiKeyId = "";
  const postIds: string[] = [];
  const caseIds: string[] = [];

  try {
    const [actors] = await sql<
      Array<{
        organization_id: string;
        admin_id: string;
        author_id: string;
        author_points: number;
      }>
    >`
      select author.organization_id,
             admin.id as admin_id,
             author.id as author_id,
             author.points as author_points
      from users author
      join users admin
        on admin.organization_id = author.organization_id
       and admin.email = 'admin@q-academy.de'
      where author.email = 'jonas@q-academy.de'
      limit 1
    `;
    organizationId = actors.organization_id;
    adminId = actors.admin_id;
    authorId = actors.author_id;
    originalAuthorPoints = actors.author_points;
    const area = await ensureCommunityAreaFixture(sql, organizationId);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`P0 Enforce ${suffix}`},
        ${`p0-enforce-${suffix}`}, 'Isolierter Enforce-Test',
        '#4f7cac', 'open', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    await sql`
      insert into community_space_moderation_policies (
        organization_id, space_id, post_approval, comment_approval,
        automation_mode, report_threshold, duplicate_window_minutes,
        link_limit, version, updated_by_id
      ) values (
        ${organizationId}, ${spaceId}, 'off', 'off', 'enforce', null,
        60, 1, 1, ${adminId}
      )
    `;
    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values (
        ${organizationId}, ${authorId}, ${`P0 Enforce ${suffix}`},
        ${apiSecret.slice(0, 20)},
        ${createHash("sha256").update(apiSecret).digest("hex")},
        array['community:read', 'community:write', 'search:read']
      )
      returning id
    `;
    apiKeyId = apiKey.id;

    const titleLimitedResponse = await request.post("/api/v1/community/posts", {
      headers: apiHeaders(apiSecret, `title-limit-${suffix}`),
      data: {
        spaceId,
        authorId,
        title: `${marker} https://one.example https://two.example`,
        content: "Der Body selbst enthaelt keinen Link.",
      },
    });
    expect(titleLimitedResponse.status()).toBe(201);
    const titleLimited = (await titleLimitedResponse.json()) as {
      data: { id: string; moderationState: string; publishedAt: string | null };
    };
    postIds.push(titleLimited.data.id);
    expect(titleLimited.data).toMatchObject({
      moderationState: "held",
      publishedAt: null,
    });
    const [titleCase] = await sql<
      Array<{ id: string; reason: string; status: string }>
    >`
      select id, reason, status
      from community_moderation_cases
      where organization_id = ${organizationId}
        and target_type = 'post'
        and target_id = ${titleLimited.data.id}
      order by created_at desc, id desc
      limit 1
    `;
    caseIds.push(titleCase.id);
    expect(titleCase).toMatchObject({ reason: "link_limit", status: "open" });
    const [titleEffects] = await sql<
      Array<{
        activities: number;
        point_transactions: number;
        webhook_deliveries: number;
      }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${titleLimited.data.id}
            and type = 'post.created') as activities,
        (select count(*)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${titleLimited.data.id}
            and reason = 'community.post.created') as point_transactions,
        (select count(*)::int from webhook_deliveries
          where organization_id = ${organizationId}
            and event = 'community.post.created'
            and payload -> 'data' ->> 'id' = ${titleLimited.data.id}) as webhook_deliveries
    `;
    expect(titleEffects).toEqual({
      activities: 0,
      point_transactions: 0,
      webhook_deliveries: 0,
    });
    expect(
      await apiFeedContains(request, apiSecret, titleLimited.data.id),
    ).toBe(false);
    expect(
      await apiSearchContains(request, apiSecret, marker, titleLimited.data.id),
    ).toBe(false);

    await sql`
      update community_space_moderation_policies
      set link_limit = 20, version = 2, updated_at = now()
      where organization_id = ${organizationId} and space_id = ${spaceId}
    `;
    const duplicateTitle = `Duplikat ${marker}`;
    const duplicateContent = `Gleicher normalisierter Inhalt ${marker}`;
    const sourceResponse = await request.post("/api/v1/community/posts", {
      headers: apiHeaders(apiSecret, `duplicate-source-${suffix}`),
      data: {
        spaceId,
        authorId,
        title: duplicateTitle,
        content: duplicateContent,
      },
    });
    expect(sourceResponse.status()).toBe(201);
    const source = (await sourceResponse.json()) as {
      data: { id: string; moderationState: string };
    };
    postIds.push(source.data.id);
    expect(source.data.moderationState).toBe("published");

    const duplicateResponse = await request.post("/api/v1/community/posts", {
      headers: apiHeaders(apiSecret, `duplicate-held-${suffix}`),
      data: {
        spaceId,
        authorId,
        title: duplicateTitle,
        content: duplicateContent,
      },
    });
    expect(duplicateResponse.status()).toBe(201);
    const duplicate = (await duplicateResponse.json()) as {
      data: { id: string; moderationState: string; publishedAt: string | null };
    };
    postIds.push(duplicate.data.id);
    expect(duplicate.data).toMatchObject({
      moderationState: "held",
      publishedAt: null,
    });
    const [duplicateCase] = await sql<
      Array<{ id: string; reason: string; status: string }>
    >`
      select id, reason, status
      from community_moderation_cases
      where organization_id = ${organizationId}
        and target_type = 'post'
        and target_id = ${duplicate.data.id}
      order by created_at desc, id desc
      limit 1
    `;
    caseIds.push(duplicateCase.id);
    expect(duplicateCase).toMatchObject({
      reason: "duplicate",
      status: "open",
    });
    const [duplicateEffects] = await sql<
      Array<{
        source_activities: number;
        source_points: number;
        duplicate_activities: number;
        duplicate_points: number;
      }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${source.data.id}
            and type = 'post.created') as source_activities,
        (select count(*)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${source.data.id}
            and reason = 'community.post.created') as source_points,
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${duplicate.data.id}
            and type = 'post.created') as duplicate_activities,
        (select count(*)::int from point_transactions
          where organization_id = ${organizationId}
            and entity_id = ${duplicate.data.id}
            and reason = 'community.post.created') as duplicate_points
    `;
    expect(duplicateEffects).toEqual({
      source_activities: 1,
      source_points: 1,
      duplicate_activities: 0,
      duplicate_points: 0,
    });
    expect(await apiFeedContains(request, apiSecret, source.data.id)).toBe(
      true,
    );
    expect(await apiFeedContains(request, apiSecret, duplicate.data.id)).toBe(
      false,
    );
    expect(
      await apiSearchContains(request, apiSecret, marker, source.data.id),
    ).toBe(true);
    expect(
      await apiSearchContains(request, apiSecret, marker, duplicate.data.id),
    ).toBe(false);
  } finally {
    if (organizationId) {
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = 'replica'`;
        await transaction`
          delete from community_moderation_events
          where organization_id = ${organizationId}
            and case_id = any(${caseIds}::uuid[])
        `;
      });
      await sql`
        delete from community_moderation_assessments
        where organization_id = ${organizationId}
          and case_id = any(${caseIds}::uuid[])
      `;
      await sql`
        delete from community_moderation_cases
        where organization_id = ${organizationId}
          and id = any(${caseIds}::uuid[])
      `;
      await sql`
        delete from webhook_deliveries
        where organization_id = ${organizationId}
          and payload -> 'data' ->> 'id' = any(${postIds})
      `;
      await sql`
        delete from point_transactions
        where organization_id = ${organizationId}
          and entity_id = any(${postIds}::uuid[])
      `;
      if (authorId) {
        await sql`
          update users set points = ${originalAuthorPoints}
          where id = ${authorId} and organization_id = ${organizationId}
        `;
      }
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and entity_id = any(${postIds}::uuid[])
      `;
      if (spaceId) {
        await sql`delete from community_spaces where id = ${spaceId}`;
      }
      if (apiKeyId) {
        await sql`delete from api_audit_logs where api_key_id = ${apiKeyId}`;
        await sql`delete from api_idempotency_keys where api_key_id = ${apiKeyId}`;
        await sql`delete from api_keys where id = ${apiKeyId}`;
      }
      await sql`
        delete from auth_rate_limits
        where action in ('community_post_create', 'community_post_create_tenant')
      `;
    }
    await sql.end();
  }
});
