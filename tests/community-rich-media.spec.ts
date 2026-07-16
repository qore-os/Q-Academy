import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

import {
  getCommunityNotificationCopy,
  resolveCommunityActionMessage,
} from "../src/lib/i18n/community-actions";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { fetchMediaDownload } from "./helpers/media-download";

const notificationCopy = getCommunityNotificationCopy("de");
const publishedPostMessage = resolveCommunityActionMessage("de", {
  code: "contentCreated",
  params: { target: "post", moderationState: "published" },
});

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function authorization(secret: string) {
  return { Authorization: `Bearer ${secret}` };
}

function writeAuthorization(secret: string, idempotencyKey: string) {
  return {
    ...authorization(secret),
    "Idempotency-Key": idempotencyKey,
  };
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function createPost(
  request: APIRequestContext,
  input: {
    secret: string;
    key: string;
    spaceId: string;
    authorId: string;
    title: string;
    content: string;
    attachmentIds?: string[];
    pinned?: boolean;
    locked?: boolean;
  },
) {
  return request.post("/api/v1/community/posts", {
    headers: writeAuthorization(input.secret, input.key),
    data: {
      spaceId: input.spaceId,
      authorId: input.authorId,
      title: input.title,
      content: input.content,
      attachmentIds: input.attachmentIds ?? [],
      pinned: input.pinned,
      locked: input.locked,
    },
  });
}

async function createComment(
  request: APIRequestContext,
  input: {
    secret: string;
    key: string;
    postId: string;
    authorId: string;
    content: string;
    attachmentIds?: string[];
  },
) {
  return request.post(`/api/v1/community/posts/${input.postId}/comments`, {
    headers: writeAuthorization(input.secret, input.key),
    data: {
      authorId: input.authorId,
      content: input.content,
      attachmentIds: input.attachmentIds ?? [],
    },
  });
}

async function downloadApiMedia(
  request: APIRequestContext,
  href: string,
  secret: string,
) {
  const { response } = await fetchMediaDownload(request, href, {
    headers: authorization(secret),
  });
  return response;
}

test("community rich media binds atomically and follows restricted-space rights", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "lifecycle runs once");
  test.setTimeout(240_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const startedAt = new Date();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const keyPrefix = `community-rich-${suffix}`;
  const ownerEmail = `community-media-owner-${suffix}@example.test`;
  const viewerEmail = `community-media-viewer-${suffix}@example.test`;
  const viewerHandle = viewerEmail.slice(0, viewerEmail.indexOf("@"));
  const searchToken = `CMLeak${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const postTitle = `Geschuetzte Medien ${suffix}`;
  const postContent = `PNG und Dokument werden atomar gebunden ${suffix}. ${searchToken} @${viewerHandle}`;
  const commentContent = `Kommentar mit geschuetztem Dokument ${suffix}`;
  const imageName = `community-${suffix}.png`;
  const documentName = `community-${suffix}.txt`;
  const commentDocumentName = `community-comment-${suffix}.txt`;
  const adminSecret = `qak_cm_admin_${randomBytes(24).toString("base64url")}`;
  const ownerSecret = `qak_cm_owner_${randomBytes(24).toString("base64url")}`;
  const viewerSecret = `qak_cm_viewer_${randomBytes(24).toString("base64url")}`;

  let organizationId = "";
  let adminId = "";
  let originalAdminPoints = 0;
  let ownerId = "";
  let viewerId = "";
  let foreignOrganizationId = "";
  let foreignUserId = "";
  let spaceId = "";
  let postId = "";
  let commentId = "";
  let boundaryPostId = "";
  let boundaryCommentId = "";
  let concurrentAssetId = "";
  let accessGroupId = "";
  let accessBundleId = "";
  let foreignGroupId = "";
  const apiKeyIds: string[] = [];
  const mediaAssetIds: string[] = [];
  const postAttachmentIds: string[] = [];
  const contentEntityIds: string[] = [];
  const storageKeys: string[] = [];

  const nextKey = (label: string) => `${keyPrefix}-${label}`;

  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        admin_id: string;
        admin_points: number;
        password_hash: string;
      }>
    >`
      select
        admin.organization_id,
        admin.id as admin_id,
        admin.points as admin_points,
        member.password_hash
      from users admin
      join users member on member.organization_id = admin.organization_id
      where admin.email = 'admin@q-academy.de'
        and member.email = 'lea@q-academy.de'
      limit 1
    `;
    organizationId = fixture.organization_id;
    adminId = fixture.admin_id;
    originalAdminPoints = fixture.admin_points;

    const [owner] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role,
        status
      ) values (
        ${organizationId}, ${ownerEmail}, ${fixture.password_hash},
        'Mara', 'Medien', 'member', 'active'
      )
      returning id
    `;
    ownerId = owner.id;
    const [viewer] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role,
        status
      ) values (
        ${organizationId}, ${viewerEmail}, ${fixture.password_hash},
        'Nora', 'Leserechte', 'member', 'active'
      )
      returning id
    `;
    viewerId = viewer.id;

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (
        ${`Community Media Foreign ${suffix}`},
        ${`community-media-foreign-${suffix}`}
      )
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role,
        status
      ) values (
        ${foreignOrganizationId}, ${`foreign-community-${suffix}@example.test`},
        ${fixture.password_hash}, 'Fremd', 'Mandant', 'member', 'active'
      )
      returning id
    `;
    foreignUserId = foreignUser.id;

    const area = await ensureCommunityAreaFixture(sql, organizationId);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Medienrechte ${suffix}`},
        ${`medienrechte-${suffix}`},
        'Isolierter E2E-Bereich fuer geschuetzte Community-Medien.',
        '#2b9188', 'discussion', 'restricted', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;

    const keyRows = await sql<Array<{ id: string; created_by_id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values
        (
          ${organizationId}, ${adminId}, ${`Community Admin ${suffix}`},
          ${adminSecret.slice(0, 20)}, ${hashSecret(adminSecret)},
          array['community:read', 'community:write', 'search:read']
        ),
        (
          ${organizationId}, ${ownerId}, ${`Community Owner ${suffix}`},
          ${ownerSecret.slice(0, 20)}, ${hashSecret(ownerSecret)},
          array['community:read', 'community:write', 'search:read']
        ),
        (
          ${organizationId}, ${viewerId}, ${`Community Viewer ${suffix}`},
          ${viewerSecret.slice(0, 20)}, ${hashSecret(viewerSecret)},
          array['community:read', 'community:write', 'search:read']
        )
      returning id, created_by_id
    `;
    apiKeyIds.push(...keyRows.map((row) => row.id));

    const initialPolicy = await request.put(
      `/api/v1/community/spaces/${spaceId}/access-policy`,
      {
        headers: writeAuthorization(adminSecret, nextKey("policy-initial")),
        data: {
          accessMode: "restricted",
          rules: [
            {
              subjectType: "user",
              subjectUserId: ownerId,
              canView: true,
              canPost: true,
              canComment: true,
            },
          ],
        },
      },
    );
    const initialPolicyBody = await initialPolicy.json();
    expect(initialPolicy.status(), JSON.stringify(initialPolicyBody)).toBe(200);
    expect(initialPolicyBody.data).toMatchObject({
      spaceId,
      accessMode: "restricted",
    });
    expect(initialPolicyBody.data).not.toHaveProperty("id");
    expect(initialPolicyBody.data.rules).toHaveLength(1);

    const viewerSpaces = await request.get(
      `/api/v1/community/spaces?search=${encodeURIComponent(`Medienrechte ${suffix}`)}`,
      { headers: authorization(viewerSecret) },
    );
    expect(viewerSpaces.status()).toBe(200);
    expect((await viewerSpaces.json()).data).toEqual([]);

    const deniedViewerPost = await createPost(request, {
      secret: viewerSecret,
      key: nextKey("viewer-post-denied"),
      spaceId,
      authorId: viewerId,
      title: `Nicht erlaubt ${suffix}`,
      content: "Die Rollenregel erlaubt nur das Lesen.",
    });
    expect(deniedViewerPost.status()).toBe(404);

    await login(page, ownerEmail);
    await page.goto("/academy/community");
    await page.getByRole("button", { name: /Teile eine Frage/ }).click();
    const composer = page.getByRole("dialog", { name: "Neuer Beitrag" });
    await composer.locator('select[name="spaceId"]').selectOption(spaceId);
    await composer.locator('input[type="file"]').setInputFiles([
      { name: imageName, mimeType: "image/png", buffer: png },
      {
        name: documentName,
        mimeType: "text/plain",
        buffer: Buffer.from(
          `Geschuetztes Community-Dokument fuer ${suffix}.\n`,
          "utf8",
        ),
      },
    ]);
    await expect(composer.getByText(/Bereit \|/)).toHaveCount(2, {
      timeout: 45_000,
    });
    postAttachmentIds.push(
      ...(await composer
        .locator('input[name="attachmentIds"]')
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        )),
    );
    expect(postAttachmentIds).toHaveLength(2);
    mediaAssetIds.push(...postAttachmentIds);
    await composer.getByPlaceholder("Titel der Diskussion").fill(postTitle);
    await composer.locator('textarea[name="content"]').fill(postContent);
    await expect(
      composer.getByRole("button", { name: "Veroeffentlichen" }),
    ).toBeEnabled();
    await composer.getByRole("button", { name: "Veroeffentlichen" }).click();
    await expect(
      composer.getByText(publishedPostMessage, { exact: true }),
    ).toBeVisible();
    await composer.getByRole("button", { name: "Dialog schliessen" }).click();
    await expect(composer).toBeHidden();

    await expect
      .poll(async () => {
        const rows = await sql<Array<{ id: string }>>`
          select id from posts
          where organization_id = ${organizationId} and title = ${postTitle}
        `;
        return rows[0]?.id ?? null;
      })
      .not.toBeNull();
    const [storedPost] = await sql<Array<{ id: string }>>`
      select id from posts
      where organization_id = ${organizationId} and title = ${postTitle}
    `;
    postId = storedPost.id;
    contentEntityIds.push(postId);

    const article = page.locator("article").filter({
      has: page.getByRole("heading", { name: postTitle }),
    });
    await expect(article).toBeVisible();
    const renderedImage = article.getByRole("img", { name: imageName });
    await expect(renderedImage).toBeVisible();
    await expect
      .poll(() =>
        renderedImage.evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(
      article.getByRole("link", { name: new RegExp(documentName) }),
    ).toBeVisible();

    const postBindings = await sql<
      Array<{
        media_asset_id: string;
        sort_order: number;
        purpose: string;
        status: string;
        owner_user_id: string | null;
      }>
    >`
      select
        attachment.media_asset_id,
        attachment.sort_order,
        asset.purpose,
        asset.status,
        asset.owner_user_id
      from community_post_attachments attachment
      join media_assets asset on asset.id = attachment.media_asset_id
      where attachment.post_id = ${postId}
      order by attachment.sort_order
    `;
    expect(postBindings).toEqual(
      postAttachmentIds.map((mediaAssetId, sortOrder) => ({
        media_asset_id: mediaAssetId,
        sort_order: sortOrder,
        purpose: "community",
        status: "ready",
        owner_user_id: ownerId,
      })),
    );

    const imageDownload = await page.request.get(
      `/api/media-assets/${postAttachmentIds[0]}/download?disposition=inline`,
    );
    expect(imageDownload.status()).toBe(200);
    expect(imageDownload.headers()["content-type"]).toBe("image/png");
    expect(await imageDownload.body()).toEqual(png);
    const documentDownload = await page.request.get(
      `/api/media-assets/${postAttachmentIds[1]}/download`,
    );
    expect(documentDownload.status()).toBe(200);
    expect(await documentDownload.text()).toContain(
      "Geschuetztes Community-Dokument",
    );

    const commentForm = article.locator("form").filter({
      has: page.getByPlaceholder("Antwort schreiben..."),
    });
    await commentForm.locator('input[type="file"]').setInputFiles({
      name: commentDocumentName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Kommentar-Anhang fuer ${suffix}.\n`, "utf8"),
    });
    await expect(commentForm.getByText(/Bereit \|/)).toHaveCount(1, {
      timeout: 45_000,
    });
    const [commentAttachmentId] = await commentForm
      .locator('input[name="attachmentIds"]')
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      );
    expect(commentAttachmentId).toBeTruthy();
    mediaAssetIds.push(commentAttachmentId);
    await commentForm.getByPlaceholder("Antwort schreiben...").fill(commentContent);
    await commentForm
      .getByRole("button", { name: "Antwort veroeffentlichen" })
      .click();
    await expect(article.getByText(commentContent, { exact: true })).toBeVisible();
    await expect(
      article.getByRole("link", { name: new RegExp(commentDocumentName) }),
    ).toBeVisible();

    const [storedComment] = await sql<Array<{ id: string }>>`
      select id from comments
      where organization_id = ${organizationId}
        and post_id = ${postId}
        and content = ${commentContent}
    `;
    commentId = storedComment.id;
    contentEntityIds.push(commentId);
    const [commentBinding] = await sql<
      Array<{
        media_asset_id: string;
        post_id: string;
        sort_order: number;
      }>
    >`
      select media_asset_id, post_id, sort_order
      from community_comment_attachments
      where comment_id = ${commentId}
    `;
    expect(commentBinding).toEqual({
      media_asset_id: commentAttachmentId,
      post_id: postId,
      sort_order: 0,
    });

    const boundDelete = await page.evaluate(async (assetId) => {
      const response = await fetch(`/api/media-assets/${assetId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      return response.status;
    }, commentAttachmentId);
    expect(boundDelete).toBe(409);

    const ownerPostRead = await request.get(
      `/api/v1/community/posts/${postId}`,
      { headers: authorization(ownerSecret) },
    );
    expect(ownerPostRead.status()).toBe(200);
    const ownerPostBody = await ownerPostRead.json();
    const restImageHref = `/api/v1/media-assets/${postAttachmentIds[0]}/download`;
    const restDocumentHref = `/api/v1/media-assets/${postAttachmentIds[1]}/download`;
    const restCommentHref = `/api/v1/media-assets/${commentAttachmentId}/download`;
    expect(ownerPostBody.data.attachments).toEqual([
      expect.objectContaining({
        id: postAttachmentIds[0],
        downloadHref: restImageHref,
      }),
      expect.objectContaining({
        id: postAttachmentIds[1],
        downloadHref: restDocumentHref,
      }),
    ]);
    expect(ownerPostBody.data.comments).toEqual([
      expect.objectContaining({
        id: commentId,
        attachments: [
          expect.objectContaining({
            id: commentAttachmentId,
            name: commentDocumentName,
            downloadHref: restCommentHref,
          }),
        ],
      }),
    ]);
    const restImageDownload = await downloadApiMedia(
      request,
      restImageHref,
      ownerSecret,
    );
    expect(restImageDownload.status()).toBe(200);
    expect(restImageDownload.headers()["content-type"]).toBe("image/png");
    expect(await restImageDownload.body()).toEqual(png);
    const restDocumentDownload = await downloadApiMedia(
      request,
      restDocumentHref,
      ownerSecret,
    );
    expect(restDocumentDownload.status()).toBe(200);
    expect(await restDocumentDownload.text()).toContain(
      "Geschuetztes Community-Dokument",
    );

    const [mentionLeakBeforeGrant] = await sql<
      Array<{ mentions: number; notifications: number }>
    >`
      select
        (select count(*)::int from community_mentions
          where post_id = ${postId}
            and mentioned_user_id = ${viewerId}) as mentions,
        (select count(*)::int from notifications
          where user_id = ${viewerId}
            and title = ${notificationCopy.mentionTitle}
            and created_at >= ${startedAt}) as notifications
    `;
    expect(mentionLeakBeforeGrant).toEqual({ mentions: 0, notifications: 0 });

    await login(page, viewerEmail);
    await page.goto("/academy");
    await expect(page.getByText(new RegExp(searchToken))).toHaveCount(0);
    const hiddenNavigationSearch = await page.request.get(
      `/api/navigation-search?q=${encodeURIComponent(searchToken)}&mode=member`,
    );
    expect(hiddenNavigationSearch.status()).toBe(200);
    expect(
      ((await hiddenNavigationSearch.json()) as {
        data: Array<{ id: string }>;
      }).data.some((result) => result.id === postId),
    ).toBe(false);
    const hiddenApiSearch = await request.get(
      `/api/v1/search?types=community&q=${encodeURIComponent(searchToken)}`,
      { headers: authorization(viewerSecret) },
    );
    expect(hiddenApiSearch.status()).toBe(200);
    expect(
      ((await hiddenApiSearch.json()) as {
        data: Array<{ id: string }>;
      }).data.some((result) => result.id === postId),
    ).toBe(false);
    await page.goto("/academy/community");
    await expect(
      page.locator("article").filter({
        has: page.getByRole("heading", { name: postTitle }),
      }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(
          `/api/media-assets/${postAttachmentIds[0]}/download?disposition=inline`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(restImageHref, {
          headers: authorization(viewerSecret),
        })
      ).status(),
    ).toBe(404);

    const [accessGroup] = await sql<Array<{ id: string }>>`
      insert into groups (organization_id, name, description, color)
      values (
        ${organizationId}, ${`Community Matrix ${suffix}`},
        'Direkte Gruppenmitgliedschaft fuer den Community-ACL-Test.', '#2b9188'
      )
      returning id
    `;
    accessGroupId = accessGroup.id;
    await sql`
      insert into group_members (group_id, user_id)
      values (${accessGroupId}, ${viewerId})
    `;
    const [accessBundle] = await sql<Array<{ id: string }>>`
      insert into bundles (
        organization_id, name, description, color, active
      ) values (
        ${organizationId}, ${`Community Bundle ${suffix}`},
        'Direkte und gruppenbasierte Bundle-Mitgliedschaft.', '#4f7cac', true
      )
      returning id
    `;
    accessBundleId = accessBundle.id;
    const [foreignGroup] = await sql<Array<{ id: string }>>`
      insert into groups (organization_id, name, description, color)
      values (
        ${foreignOrganizationId}, ${`Foreign Community Group ${suffix}`},
        'Darf nie Ziel einer fremden Tenant-Policy sein.', '#ee6c5d'
      )
      returning id
    `;
    foreignGroupId = foreignGroup.id;

    const ownerAccessRule = {
      subjectType: "user",
      subjectUserId: ownerId,
      canView: true,
      canPost: true,
      canComment: true,
    } as const;
    const viewOnly = {
      canView: true,
      canPost: false,
      canComment: false,
    } as const;
    const replacePolicy = (
      label: string,
      rules: Array<Record<string, string | boolean>>,
    ) =>
      request.put(`/api/v1/community/spaces/${spaceId}/access-policy`, {
        headers: writeAuthorization(adminSecret, nextKey(label)),
        data: { accessMode: "restricted", rules },
      });

    const groupPolicy = await replacePolicy("policy-group", [
      ownerAccessRule,
      {
        subjectType: "group",
        subjectGroupId: accessGroupId,
        ...viewOnly,
      },
    ]);
    expect(groupPolicy.status()).toBe(200);
    expect(
      (
        await request.get(`/api/v1/community/posts/${postId}`, {
          headers: authorization(viewerSecret),
        })
      ).status(),
    ).toBe(200);

    await sql`
      insert into member_bundles (user_id, bundle_id)
      values (${viewerId}, ${accessBundleId})
    `;
    const directBundlePolicy = await replacePolicy("policy-direct-bundle", [
      ownerAccessRule,
      {
        subjectType: "bundle",
        subjectBundleId: accessBundleId,
        ...viewOnly,
      },
    ]);
    expect(directBundlePolicy.status()).toBe(200);
    expect(
      (
        await request.get(`/api/v1/community/posts/${postId}`, {
          headers: authorization(viewerSecret),
        })
      ).status(),
    ).toBe(200);

    await sql`
      delete from member_bundles
      where user_id = ${viewerId} and bundle_id = ${accessBundleId}
    `;
    await sql`
      insert into group_bundles (group_id, bundle_id)
      values (${accessGroupId}, ${accessBundleId})
    `;
    const groupBundlePolicy = await replacePolicy("policy-group-bundle", [
      ownerAccessRule,
      {
        subjectType: "bundle",
        subjectBundleId: accessBundleId,
        ...viewOnly,
      },
    ]);
    expect(groupBundlePolicy.status()).toBe(200);
    expect(
      (
        await request.get(`/api/v1/community/posts/${postId}`, {
          headers: authorization(viewerSecret),
        })
      ).status(),
    ).toBe(200);

    await sql`update bundles set active = false where id = ${accessBundleId}`;
    expect(
      (
        await request.get(`/api/v1/community/posts/${postId}`, {
          headers: authorization(viewerSecret),
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await replacePolicy("policy-inactive-bundle", [
          ownerAccessRule,
          {
            subjectType: "bundle",
            subjectBundleId: accessBundleId,
            ...viewOnly,
          },
        ])
      ).status(),
    ).toBe(422);
    expect(
      (
        await replacePolicy("policy-foreign-group", [
          ownerAccessRule,
          {
            subjectType: "group",
            subjectGroupId: foreignGroupId,
            ...viewOnly,
          },
        ])
      ).status(),
    ).toBe(422);
    await sql`update bundles set active = true where id = ${accessBundleId}`;

    const roleGrant = await replacePolicy("policy-role-grant", [
      ownerAccessRule,
      {
        subjectType: "role",
        subjectRole: "member",
        ...viewOnly,
      },
    ]);
    expect(roleGrant.status()).toBe(200);
    const postContentVersion = async () => {
      const [post] = await sql<Array<{ content_version: number }>>`
        select moderation_version as content_version
        from posts where id = ${postId}
      `;
      if (!post) throw new Error(`Post version missing: ${postId}`);
      return post.content_version;
    };
    const mentionAfterGrant = await request.patch(
      `/api/v1/community/posts/${postId}`,
      {
        headers: writeAuthorization(
          ownerSecret,
          nextKey("mention-after-grant"),
        ),
        data: {
          expectedContentVersion: await postContentVersion(),
          content: `${postContent} Sichtbar nach Freigabe @${viewerHandle}`,
        },
      },
    );
    expect(
      mentionAfterGrant.status(),
      await mentionAfterGrant.text(),
    ).toBe(200);
    const [mentionStateAfterGrant] = await sql<
      Array<{ mentions: number; notifications: number }>
    >`
      select
        (select count(*)::int from community_mentions
          where post_id = ${postId}
            and mentioned_user_id = ${viewerId}) as mentions,
        (select count(*)::int from notifications
          where user_id = ${viewerId}
            and title = ${notificationCopy.mentionTitle}
            and created_at >= ${startedAt}) as notifications
    `;
    expect(mentionStateAfterGrant).toEqual({ mentions: 1, notifications: 1 });

    const visibleViewerSpaces = await request.get(
      `/api/v1/community/spaces?search=${encodeURIComponent(`Medienrechte ${suffix}`)}`,
      { headers: authorization(viewerSecret) },
    );
    expect(visibleViewerSpaces.status()).toBe(200);
    expect((await visibleViewerSpaces.json()).data).toEqual([
      expect.objectContaining({
        id: spaceId,
        permissions: expect.objectContaining({
          canView: true,
          canPost: false,
          canComment: false,
        }),
      }),
    ]);
    const visibleNavigationSearch = await page.request.get(
      `/api/navigation-search?q=${encodeURIComponent(searchToken)}&mode=member`,
    );
    expect(visibleNavigationSearch.status()).toBe(200);
    expect(
      ((await visibleNavigationSearch.json()) as {
        data: Array<{ id: string }>;
      }).data.some((result) => result.id === postId),
    ).toBe(true);
    const visibleApiSearch = await request.get(
      `/api/v1/search?types=community&q=${encodeURIComponent(searchToken)}`,
      { headers: authorization(viewerSecret) },
    );
    expect(visibleApiSearch.status()).toBe(200);
    expect(
      ((await visibleApiSearch.json()) as {
        data: Array<{ id: string }>;
      }).data.some((result) => result.id === postId),
    ).toBe(true);
    await page.goto("/academy");
    await expect(page.getByText(new RegExp(searchToken))).toBeVisible();
    await page.goto("/academy/community");
    const grantedViewerArticle = page.locator("article").filter({
      has: page.getByRole("heading", { name: postTitle }),
    });
    await expect(grantedViewerArticle).toBeVisible();
    await expect(
      grantedViewerArticle.getByPlaceholder("Antwort schreiben..."),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(
          `/api/media-assets/${postAttachmentIds[0]}/download?disposition=inline`,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await downloadApiMedia(request, restImageHref, viewerSecret)
      ).status(),
    ).toBe(200);
    await page.getByRole("button", { name: /Teile eine Frage/ }).click();
    const grantedViewerComposer = page.getByRole("dialog", {
      name: "Neuer Beitrag",
    });
    await expect(
      grantedViewerComposer.locator(`option[value="${spaceId}"]`),
    ).toHaveCount(0);
    await grantedViewerComposer
      .getByRole("button", { name: "Dialog schliessen" })
      .click();
    const viewerPostReadAfterGrant = await request.get(
      `/api/v1/community/posts/${postId}`,
      { headers: authorization(viewerSecret) },
    );
    expect(viewerPostReadAfterGrant.status()).toBe(200);
    const deniedViewerCommentAfterGrant = await createComment(request, {
      secret: viewerSecret,
      key: nextKey("viewer-comment-denied-after-grant"),
      postId,
      authorId: viewerId,
      content: "Die Rollenregel verbietet Kommentare.",
    });
    expect(deniedViewerCommentAfterGrant.status()).toBe(403);

    const memberPinnedCreate = await createPost(request, {
      secret: ownerSecret,
      key: nextKey("member-pinned-create-denied"),
      spaceId,
      authorId: ownerId,
      title: `Invalid Member Pin ${suffix}`,
      content: "Mitglieder duerfen Beitraege nicht selbst hervorheben.",
      pinned: true,
    });
    expect(memberPinnedCreate.status()).toBe(403);
    const memberLockedCreate = await createPost(request, {
      secret: ownerSecret,
      key: nextKey("member-locked-create-denied"),
      spaceId,
      authorId: ownerId,
      title: `Invalid Member Lock ${suffix}`,
      content: "Mitglieder duerfen Beitraege nicht selbst sperren.",
      locked: true,
    });
    expect(memberLockedCreate.status()).toBe(403);
    const memberPinnedPatch = await request.patch(
      `/api/v1/community/posts/${postId}`,
      {
        headers: writeAuthorization(
          ownerSecret,
          nextKey("member-pinned-patch-denied"),
        ),
        data: {
          expectedContentVersion: await postContentVersion(),
          pinned: true,
        },
      },
    );
    expect(memberPinnedPatch.status()).toBe(403);
    const memberLockedPatch = await request.patch(
      `/api/v1/community/posts/${postId}`,
      {
        headers: writeAuthorization(
          ownerSecret,
          nextKey("member-locked-patch-denied"),
        ),
        data: {
          expectedContentVersion: await postContentVersion(),
          locked: true,
        },
      },
    );
    expect(memberLockedPatch.status()).toBe(403);
    const [memberModerationState] = await sql<
      Array<{ pinned: boolean; locked: boolean }>
    >`
      select pinned, locked from posts where id = ${postId}
    `;
    expect(memberModerationState).toEqual({ pinned: false, locked: false });

    const adminModeratedCreate = await createPost(request, {
      secret: adminSecret,
      key: nextKey("admin-moderated-create"),
      spaceId,
      authorId: adminId,
      title: `Admin Moderation ${suffix}`,
      content: "Administrativ hervorgehobener und gesperrter Beitrag.",
      pinned: true,
      locked: true,
    });
    const adminModeratedCreateBody = await adminModeratedCreate.json();
    expect(
      adminModeratedCreate.status(),
      JSON.stringify(adminModeratedCreateBody),
    ).toBe(201);
    expect(adminModeratedCreateBody.data).toMatchObject({
      pinned: true,
      locked: true,
    });
    const adminModeratedPostId = adminModeratedCreateBody.data.id as string;
    contentEntityIds.push(adminModeratedPostId);

    const adminModeratedPatch = await request.patch(
      `/api/v1/community/posts/${postId}`,
      {
        headers: writeAuthorization(
          adminSecret,
          nextKey("admin-moderated-patch"),
        ),
        data: {
          expectedContentVersion: await postContentVersion(),
          pinned: true,
          locked: true,
        },
      },
    );
    expect(adminModeratedPatch.status()).toBe(200);
    expect((await adminModeratedPatch.json()).data).toMatchObject({
      pinned: true,
      locked: true,
    });
    const adminModerationRestore = await request.patch(
      `/api/v1/community/posts/${postId}`,
      {
        headers: writeAuthorization(
          adminSecret,
          nextKey("admin-moderation-restore"),
        ),
        data: {
          expectedContentVersion: await postContentVersion(),
          pinned: false,
          locked: false,
        },
      },
    );
    expect(adminModerationRestore.status()).toBe(200);
    expect((await adminModerationRestore.json()).data).toMatchObject({
      pinned: false,
      locked: false,
    });
    const deleteAdminModeratedPost = await request.delete(
      `/api/v1/community/posts/${adminModeratedPostId}`,
      {
        headers: writeAuthorization(
          adminSecret,
          nextKey("admin-moderated-delete"),
        ),
      },
    );
    expect(deleteAdminModeratedPost.status()).toBe(200);

    const insertSyntheticAsset = async (input: {
      organizationId: string;
      uploadedById: string;
      ownerUserId: string;
      purpose: "community" | "submission";
      status: "pending" | "ready";
      name: string;
    }) => {
      const id = randomUUID();
      const size = 96;
      const ready = input.status === "ready";
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
          status, storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          detected_mime_type, declared_size_bytes, actual_size_bytes,
          quota_bytes, upload_expires_at, uploaded_at, scan_completed_at
        ) values (
          ${id}, ${input.organizationId}, ${input.uploadedById},
          ${input.ownerUserId}, ${input.purpose}, 'document', ${input.status},
          'filesystem',
          ${`tenants/${input.organizationId}/assets/${id}/ready.txt`},
          ${`incoming/tenants/${input.organizationId}/assets/${id}/incoming.txt`},
          ${input.name}, ${`community-${id.slice(0, 8)}.txt`}, 'text/plain',
          ${ready ? "text/plain" : null}, ${size}, ${ready ? size : null},
          ${size}, now() + interval '1 hour',
          ${ready ? new Date() : null}, ${ready ? new Date() : null}
        )
      `;
      mediaAssetIds.push(id);
      return id;
    };

    const boundaryPostAssets: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      boundaryPostAssets.push(
        await insertSyntheticAsset({
          organizationId,
          uploadedById: ownerId,
          ownerUserId: ownerId,
          purpose: "community",
          status: "ready",
          name: `post-boundary-${index}-${suffix}.txt`,
        }),
      );
    }
    const boundaryCommentAssets: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      boundaryCommentAssets.push(
        await insertSyntheticAsset({
          organizationId,
          uploadedById: ownerId,
          ownerUserId: ownerId,
          purpose: "community",
          status: "ready",
          name: `comment-boundary-${index}-${suffix}.txt`,
        }),
      );
    }
    const rollbackAsset = await insertSyntheticAsset({
      organizationId,
      uploadedById: ownerId,
      ownerUserId: ownerId,
      purpose: "community",
      status: "ready",
      name: `rollback-${suffix}.txt`,
    });
    const pendingAsset = await insertSyntheticAsset({
      organizationId,
      uploadedById: ownerId,
      ownerUserId: ownerId,
      purpose: "community",
      status: "pending",
      name: `pending-${suffix}.txt`,
    });
    const wrongPurposeAsset = await insertSyntheticAsset({
      organizationId,
      uploadedById: ownerId,
      ownerUserId: ownerId,
      purpose: "submission",
      status: "ready",
      name: `wrong-purpose-${suffix}.txt`,
    });
    const wrongOwnerAsset = await insertSyntheticAsset({
      organizationId,
      uploadedById: viewerId,
      ownerUserId: viewerId,
      purpose: "community",
      status: "ready",
      name: `wrong-owner-${suffix}.txt`,
    });
    const foreignAsset = await insertSyntheticAsset({
      organizationId: foreignOrganizationId,
      uploadedById: foreignUserId,
      ownerUserId: foreignUserId,
      purpose: "community",
      status: "ready",
      name: `foreign-${suffix}.txt`,
    });
    concurrentAssetId = await insertSyntheticAsset({
      organizationId,
      uploadedById: ownerId,
      ownerUserId: ownerId,
      purpose: "community",
      status: "ready",
      name: `concurrent-${suffix}.txt`,
    });

    await expect(
      sql`
        insert into community_asset_bindings (media_asset_id, organization_id)
        values (${rollbackAsset}, ${organizationId})
      `,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`
        update community_asset_bindings
        set created_at = created_at
        where media_asset_id = ${postAttachmentIds[0]}
      `,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`
        delete from community_asset_bindings
        where media_asset_id = ${postAttachmentIds[0]}
      `,
    ).rejects.toMatchObject({ code: "55000" });

    for (const assetId of [pendingAsset, wrongPurposeAsset, wrongOwnerAsset]) {
      await expect(
        sql`
          insert into community_post_attachments (
            organization_id, post_id, media_asset_id, sort_order
          ) values (${organizationId}, ${postId}, ${assetId}, 2)
        `,
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      sql`
        insert into community_post_attachments (
          organization_id, post_id, media_asset_id, sort_order
        ) values (${organizationId}, ${postId}, ${foreignAsset}, 2)
      `,
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      sql`
        insert into community_comment_attachments (
          organization_id, comment_id, post_id, media_asset_id, sort_order
        ) values (
          ${organizationId}, ${commentId}, ${postId},
          ${postAttachmentIds[0]}, 1
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });

    const concurrentBindings = await Promise.allSettled([
      sql`
        insert into community_post_attachments (
          organization_id, post_id, media_asset_id, sort_order
        ) values (
          ${organizationId}, ${postId}, ${concurrentAssetId}, 2
        )
      `,
      sql`
        insert into community_comment_attachments (
          organization_id, comment_id, post_id, media_asset_id, sort_order
        ) values (
          ${organizationId}, ${commentId}, ${postId}, ${concurrentAssetId}, 1
        )
      `,
    ]);
    expect(
      concurrentBindings.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [concurrentFailure] = concurrentBindings.filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    expect(concurrentFailure.reason).toMatchObject({ code: "23505" });
    const winnerRows = await sql<Array<{ target: string }>>`
      select 'post'::text as target from community_post_attachments
      where media_asset_id = ${concurrentAssetId}
      union all
      select 'comment'::text as target from community_comment_attachments
      where media_asset_id = ${concurrentAssetId}
    `;
    expect(winnerRows).toHaveLength(1);
    const [registryWinner] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from community_asset_bindings
      where media_asset_id = ${concurrentAssetId}
        and organization_id = ${organizationId}
    `;
    expect(registryWinner.count).toBe(1);

    const boundaryPost = await createPost(request, {
      secret: ownerSecret,
      key: nextKey("post-max-six"),
      spaceId,
      authorId: ownerId,
      title: `Sechs Anhaenge ${suffix}`,
      content: "Die erlaubte Obergrenze fuer Beitraege wird akzeptiert.",
      attachmentIds: boundaryPostAssets,
    });
    const boundaryPostBody = await boundaryPost.json();
    expect(boundaryPost.status(), JSON.stringify(boundaryPostBody)).toBe(201);
    expect(boundaryPostBody.data.attachments).toHaveLength(6);
    boundaryPostId = boundaryPostBody.data.id;
    contentEntityIds.push(boundaryPostId);

    const boundaryComment = await createComment(request, {
      secret: ownerSecret,
      key: nextKey("comment-max-three"),
      postId,
      authorId: ownerId,
      content: `Drei erlaubte Kommentar-Anhaenge ${suffix}`,
      attachmentIds: boundaryCommentAssets,
    });
    const boundaryCommentBody = await boundaryComment.json();
    expect(
      boundaryComment.status(),
      JSON.stringify(boundaryCommentBody),
    ).toBe(201);
    expect(boundaryCommentBody.data.attachments).toHaveLength(3);
    boundaryCommentId = boundaryCommentBody.data.id;
    contentEntityIds.push(boundaryCommentId);

    const tooManyPostAttachments = await createPost(request, {
      secret: ownerSecret,
      key: nextKey("post-max-rejected"),
      spaceId,
      authorId: ownerId,
      title: `Invalid Post Max ${suffix}`,
      content: "Sieben Anhaenge muessen abgelehnt werden.",
      attachmentIds: Array.from({ length: 7 }, () => randomUUID()),
    });
    expect(tooManyPostAttachments.status()).toBe(422);

    const tooManyCommentAttachments = await createComment(request, {
      secret: ownerSecret,
      key: nextKey("comment-max-rejected"),
      postId,
      authorId: ownerId,
      content: `Invalid Comment Max ${suffix}`,
      attachmentIds: Array.from({ length: 4 }, () => randomUUID()),
    });
    expect(tooManyCommentAttachments.status()).toBe(422);

    const invalidCases = [
      {
        label: "rollback-pending",
        title: `Invalid Pending ${suffix}`,
        attachmentIds: [rollbackAsset, pendingAsset],
        status: 422,
      },
      {
        label: "wrong-purpose",
        title: `Invalid Purpose ${suffix}`,
        attachmentIds: [wrongPurposeAsset],
        status: 422,
      },
      {
        label: "wrong-owner",
        title: `Invalid Owner ${suffix}`,
        attachmentIds: [wrongOwnerAsset],
        status: 422,
      },
      {
        label: "foreign-asset",
        title: `Invalid Tenant ${suffix}`,
        attachmentIds: [foreignAsset],
        status: 422,
      },
      {
        label: "post-reuse",
        title: `Invalid Post Reuse ${suffix}`,
        attachmentIds: [postAttachmentIds[0]],
        status: 409,
      },
      {
        label: "comment-cross-reuse",
        title: `Invalid Comment Reuse ${suffix}`,
        attachmentIds: [commentAttachmentId],
        status: 409,
      },
    ];
    for (const invalid of invalidCases) {
      const response = await createPost(request, {
        secret: ownerSecret,
        key: nextKey(invalid.label),
        spaceId,
        authorId: ownerId,
        title: invalid.title,
        content: `Atomarer Negativfall ${invalid.label}.`,
        attachmentIds: invalid.attachmentIds,
      });
      expect(response.status(), invalid.label).toBe(invalid.status);
    }

    const postAssetReusedByComment = await createComment(request, {
      secret: ownerSecret,
      key: nextKey("post-asset-as-comment"),
      postId,
      authorId: ownerId,
      content: `Invalid gebundener Post-Anhang ${suffix}`,
      attachmentIds: [postAttachmentIds[0]],
    });
    expect(postAssetReusedByComment.status()).toBe(409);

    const crossTenantAuthor = await createPost(request, {
      secret: ownerSecret,
      key: nextKey("foreign-author"),
      spaceId,
      authorId: foreignUserId,
      title: `Invalid Foreign Author ${suffix}`,
      content: "Ein API-Schluessel darf nicht mandantenfremd handeln.",
    });
    expect(crossTenantAuthor.status()).toBe(403);

    const foreignArea = await ensureCommunityAreaFixture(
      sql,
      foreignOrganizationId,
    );
    const [foreignSpace] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${foreignOrganizationId}, ${foreignArea.id},
        ${`Cascade Space ${suffix}`}, ${`cascade-space-${suffix}`},
        'Registry-Cascade-Test', '#365f8d', 'discussion', 'open',
        ${foreignArea.nextSpaceSortOrder}
      )
      returning id
    `;
    const [foreignPost] = await sql<Array<{ id: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content
      ) values (
        ${foreignOrganizationId}, ${foreignSpace.id}, ${foreignUserId},
        ${`Cascade Post ${suffix}`}, 'Gebundenes Asset vor Mandanten-Cascade.'
      )
      returning id
    `;
    await sql`
      insert into community_post_attachments (
        organization_id, post_id, media_asset_id, sort_order
      ) values (
        ${foreignOrganizationId}, ${foreignPost.id}, ${foreignAsset}, 0
      )
    `;
    const [foreignRegistryBeforeDelete] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from community_asset_bindings
      where media_asset_id = ${foreignAsset}
        and organization_id = ${foreignOrganizationId}
    `;
    expect(foreignRegistryBeforeDelete.count).toBe(1);
    await expect(
      sql`delete from organizations where id = ${foreignOrganizationId}`,
    ).resolves.toBeDefined();
    const [foreignCascadeState] = await sql<
      Array<{ organizations: number; assets: number; registry: number }>
    >`
      select
        (select count(*)::int from organizations
          where id = ${foreignOrganizationId}) as organizations,
        (select count(*)::int from media_assets
          where id = ${foreignAsset}) as assets,
        (select count(*)::int from community_asset_bindings
          where media_asset_id = ${foreignAsset}) as registry
    `;
    expect(foreignCascadeState).toEqual({
      organizations: 0,
      assets: 0,
      registry: 0,
    });
    foreignOrganizationId = "";

    const [rollbackState] = await sql<
      Array<{ post_count: number; binding_count: number }>
    >`
      select
        (
          select count(*)::int from posts
          where organization_id = ${organizationId}
            and title like ${`Invalid % ${suffix}`}
        ) as post_count,
        (
          select count(*)::int from community_post_attachments
          where media_asset_id = ${rollbackAsset}
        ) as binding_count
    `;
    expect(rollbackState).toEqual({ post_count: 0, binding_count: 0 });

    const privatePolicy = await request.put(
      `/api/v1/community/spaces/${spaceId}/access-policy`,
      {
        headers: writeAuthorization(adminSecret, nextKey("policy-private")),
        data: {
          accessMode: "restricted",
          rules: [
            {
              subjectType: "user",
              subjectUserId: ownerId,
              canView: true,
              canPost: true,
              canComment: true,
            },
          ],
        },
      },
    );
    expect(privatePolicy.status()).toBe(200);

    const hiddenPost = await request.get(
      `/api/v1/community/posts/${postId}`,
      { headers: authorization(viewerSecret) },
    );
    expect(hiddenPost.status()).toBe(404);
    await page.reload();
    await expect(grantedViewerArticle).toHaveCount(0);
    const hiddenDownload = await page.request.get(
      `/api/media-assets/${postAttachmentIds[0]}/download?disposition=inline`,
    );
    expect(hiddenDownload.status()).toBe(404);
    expect(
      (
        await request.get(restImageHref, {
          headers: authorization(viewerSecret),
        })
      ).status(),
    ).toBe(404);
    const hiddenNavigationSearchAfterRevoke = await page.request.get(
      `/api/navigation-search?q=${encodeURIComponent(searchToken)}&mode=member`,
    );
    expect(hiddenNavigationSearchAfterRevoke.status()).toBe(200);
    expect(
      ((await hiddenNavigationSearchAfterRevoke.json()) as {
        data: Array<{ id: string }>;
      }).data.some((result) => result.id === postId),
    ).toBe(false);
    const hiddenApiSearchAfterRevoke = await request.get(
      `/api/v1/search?types=community&q=${encodeURIComponent(searchToken)}`,
      { headers: authorization(viewerSecret) },
    );
    expect(hiddenApiSearchAfterRevoke.status()).toBe(200);
    expect(
      ((await hiddenApiSearchAfterRevoke.json()) as {
        data: Array<{ id: string }>;
      }).data.some((result) => result.id === postId),
    ).toBe(false);
    await page.goto("/academy");
    await expect(page.getByText(new RegExp(searchToken))).toHaveCount(0);
    const stillVisibleToOwner = await request.get(
      `/api/v1/community/posts/${postId}`,
      { headers: authorization(ownerSecret) },
    );
    expect(stillVisibleToOwner.status()).toBe(200);

    const deleteComment = await request.delete(
      `/api/v1/community/comments/${commentId}`,
      {
        headers: writeAuthorization(ownerSecret, nextKey("delete-comment")),
      },
    );
    expect(deleteComment.status()).toBe(200);
    const [commentTombstone] = await sql<
      Array<{ status: string; deleted_at: Date | null }>
    >`
      select status, deleted_at from media_assets
      where id = ${commentAttachmentId}
    `;
    expect(commentTombstone.status).toBe("deleted");
    expect(commentTombstone.deleted_at).not.toBeNull();

    const deleteBoundaryComment = await request.delete(
      `/api/v1/community/comments/${boundaryCommentId}`,
      {
        headers: writeAuthorization(
          ownerSecret,
          nextKey("delete-boundary-comment"),
        ),
      },
    );
    expect(deleteBoundaryComment.status()).toBe(200);
    const boundaryCommentTombstones = await sql<
      Array<{ id: string; status: string; deleted_at: Date | null }>
    >`
      select id, status, deleted_at from media_assets
      where id = any(${boundaryCommentAssets}::uuid[])
      order by id
    `;
    expect(boundaryCommentTombstones).toHaveLength(3);
    expect(
      boundaryCommentTombstones.every(
        (asset) => asset.status === "deleted" && asset.deleted_at !== null,
      ),
    ).toBe(true);

    const deleteBoundaryPost = await request.delete(
      `/api/v1/community/posts/${boundaryPostId}`,
      {
        headers: writeAuthorization(
          ownerSecret,
          nextKey("delete-boundary-post"),
        ),
      },
    );
    expect(deleteBoundaryPost.status()).toBe(200);
    const boundaryPostTombstones = await sql<
      Array<{ id: string; status: string; deleted_at: Date | null }>
    >`
      select id, status, deleted_at from media_assets
      where id = any(${boundaryPostAssets}::uuid[])
      order by id
    `;
    expect(boundaryPostTombstones).toHaveLength(6);
    expect(
      boundaryPostTombstones.every(
        (asset) => asset.status === "deleted" && asset.deleted_at !== null,
      ),
    ).toBe(true);

    const deletePost = await request.delete(
      `/api/v1/community/posts/${postId}`,
      {
        headers: writeAuthorization(ownerSecret, nextKey("delete-post")),
      },
    );
    expect(deletePost.status()).toBe(200);
    const postTombstones = await sql<
      Array<{ id: string; status: string; deleted_at: Date | null }>
    >`
      select id, status, deleted_at from media_assets
      where id = any(${postAttachmentIds}::uuid[])
      order by id
    `;
    expect(postTombstones).toHaveLength(2);
    expect(
      postTombstones.every(
        (asset) => asset.status === "deleted" && asset.deleted_at !== null,
      ),
    ).toBe(true);
    const [concurrentTombstone] = await sql<
      Array<{ status: string; deleted_at: Date | null }>
    >`
      select status, deleted_at from media_assets
      where id = ${concurrentAssetId}
    `;
    expect(concurrentTombstone.status).toBe("deleted");
    expect(concurrentTombstone.deleted_at).not.toBeNull();
    const [bindingState] = await sql<
      Array<{ post_bindings: number; comment_bindings: number }>
    >`
      select
        (select count(*)::int from community_post_attachments
          where media_asset_id = any(${mediaAssetIds}::uuid[])) as post_bindings,
        (select count(*)::int from community_comment_attachments
          where media_asset_id = any(${mediaAssetIds}::uuid[])) as comment_bindings
    `;
    expect(bindingState).toEqual({ post_bindings: 0, comment_bindings: 0 });
    expect(
      (
        await request.get(restImageHref, {
          headers: authorization(ownerSecret),
        })
      ).status(),
    ).toBe(404);
  } finally {
    if (mediaAssetIds.length) {
      const rows = await sql<
        Array<{ storage_key: string; staging_storage_key: string }>
      >`
        select storage_key, staging_storage_key
        from media_assets
        where id = any(${mediaAssetIds}::uuid[])
      `;
      storageKeys.push(
        ...rows.flatMap((row) => [row.storage_key, row.staging_storage_key]),
      );
    }
    if (apiKeyIds.length) {
      await sql`
        delete from api_audit_logs
        where api_key_id = any(${apiKeyIds}::uuid[])
      `;
      await sql`
        delete from api_idempotency_keys
        where api_key_id = any(${apiKeyIds}::uuid[])
          or key like ${`${keyPrefix}%`}
      `;
      await sql`delete from api_keys where id = any(${apiKeyIds}::uuid[])`;
    }
    if (organizationId && contentEntityIds.length) {
      await sql`
        delete from webhook_deliveries
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and event in ('community.post.created', 'community.comment.created')
          and payload -> 'data' ->> 'id' = any(${contentEntityIds})
      `;
    }
    if (spaceId) {
      await sql`delete from community_spaces where id = ${spaceId}`;
    }
    if (accessGroupId) {
      await sql`delete from groups where id = ${accessGroupId}`;
    }
    if (accessBundleId) {
      await sql`delete from bundles where id = ${accessBundleId}`;
    }
    if (organizationId && (ownerId || viewerId)) {
      const userIds = [ownerId, viewerId].filter(Boolean);
      await sql`
        delete from notifications
        where user_id = any(${userIds}::uuid[]) and created_at >= ${startedAt}
      `;
      await sql`
        delete from point_transactions
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and (
            user_id = any(${userIds}::uuid[])
            or entity_id = any(${contentEntityIds}::uuid[])
          )
      `;
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and (
            user_id = any(${userIds}::uuid[])
            or entity_id = any(${[
              ...mediaAssetIds,
              ...contentEntityIds,
              spaceId,
            ].filter(Boolean)}::uuid[])
          )
      `;
    }
    if (adminId) {
      await sql`
        update users set points = ${originalAdminPoints} where id = ${adminId}
      `;
    }
    if (mediaAssetIds.length) {
      await sql`
        delete from media_assets where id = any(${mediaAssetIds}::uuid[])
      `;
    }
    if (ownerId || viewerId) {
      await sql`
        delete from users where id = any(${[ownerId, viewerId].filter(Boolean)}::uuid[])
      `;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
    for (const key of new Set(storageKeys.filter(Boolean))) {
      await unlink(resolve(process.cwd(), ".data", "media", ...key.split("/"))).catch(
        () => undefined,
      );
    }
  }
});

test("community attachment composer stays inside the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only visual audit");
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const assetIds: string[] = [];
  const storageKeys: string[] = [];

  try {
    await login(page, "lea@q-academy.de");
    await page.goto("/academy/community");
    await page.getByRole("button", { name: /Teile eine Frage/ }).click();
    const dialog = page.getByRole("dialog", { name: "Neuer Beitrag" });
    await dialog.locator('input[type="file"]').setInputFiles([
      {
        name: `${"sehr-langer-community-bildname-".repeat(4)}${suffix}.png`,
        mimeType: "image/png",
        buffer: png,
      },
      {
        name: `${"sehr-langer-community-dokumentname-".repeat(3)}${suffix}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`Mobiler Community-Upload ${suffix}.\n`, "utf8"),
      },
    ]);
    await expect(dialog.getByText(/Bereit \|/)).toHaveCount(2, {
      timeout: 45_000,
    });
    assetIds.push(
      ...(await dialog
        .locator('input[name="attachmentIds"]')
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        )),
    );
    expect(assetIds).toHaveLength(2);

    const viewport = page.viewportSize();
    const dialogBox = await dialog.boundingBox();
    expect(viewport).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
      viewport!.width,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const screenshotPath = ".data/community-rich-media-mobile.png";
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach("community-rich-media-mobile", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await dialog.getByRole("button", { name: "Dialog schliessen" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const rows = await sql<Array<{ status: string }>>`
          select status from media_assets
          where id = any(${assetIds}::uuid[])
          order by id
        `;
        return rows.map((row) => row.status);
      })
      .toEqual(["deleted", "deleted"]);
  } finally {
    if (assetIds.length) {
      const rows = await sql<
        Array<{ storage_key: string; staging_storage_key: string }>
      >`
        select storage_key, staging_storage_key from media_assets
        where id = any(${assetIds}::uuid[])
      `;
      storageKeys.push(
        ...rows.flatMap((row) => [row.storage_key, row.staging_storage_key]),
      );
      await sql`
        delete from activity_events where entity_id = any(${assetIds}::uuid[])
      `;
      await sql`delete from media_assets where id = any(${assetIds}::uuid[])`;
    }
    await sql.end();
    for (const key of new Set(storageKeys.filter(Boolean))) {
      await unlink(resolve(process.cwd(), ".data", "media", ...key.split("/"))).catch(
        () => undefined,
      );
    }
  }
});
