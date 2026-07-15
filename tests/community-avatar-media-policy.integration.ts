/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime HTTP payloads are validated as untrusted JSON. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";

import { hash } from "bcryptjs";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const sql = postgres(databaseUrl, { max: 3, prepare: false });

after(() => sql.end());

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function apiKey(input: {
  organizationId: string;
  creatorId: string;
  scopes: string[];
  name: string;
}) {
  const token = `qak_test_${randomBytes(28).toString("base64url")}`;
  await sql`
    insert into api_keys (
      organization_id, name, prefix, key_hash, scopes, created_by_id
    ) values (
      ${input.organizationId}, ${input.name}, 'qak_test', ${tokenHash(token)},
      ${input.scopes}, ${input.creatorId}
    )
  `;
  return token;
}

async function login(input: {
  organizationSlug: string;
  email: string;
  password: string;
}) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(input),
    redirect: "manual",
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Login response did not set a session cookie.");
  return setCookie.split(";", 1)[0]!;
}

function sessionRequest(cookie: string, path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
}

function apiRequest(token: string, path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

async function expectProblem(response: Response, status: number, code: string) {
  assert.equal(response.status, status, await response.clone().text());
  const body = await json(response);
  assert.equal(body.code, code, JSON.stringify(body));
}

test(
  "public avatar media requires exact active configured binding on session and API surfaces",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const password = "AvatarPolicy123!";
    const passwordHash = await hash(password, 4);
    const organizationIds: string[] = [];
    const storageDirectories: string[] = [];

    try {
      const organizations = await sql<Array<{ id: string; slug: string }>>`
        insert into organizations (name, slug) values
          (${`Avatar Policy ${suffix}`}, ${`avatar-policy-${suffix}`}),
          (${`Foreign Avatar Policy ${suffix}`}, ${`foreign-avatar-policy-${suffix}`})
        returning id, slug
      `;
      const organization = organizations[0]!;
      const foreignOrganization = organizations[1]!;
      organizationIds.push(organization.id, foreignOrganization.id);

      const users = await sql<
        Array<{
          id: string;
          email: string;
          firstName: string;
          organizationId: string;
        }>
      >`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values
          (${organization.id}, ${`avatar-owner-${suffix}@example.test`}, ${passwordHash}, 'Avatar', 'Owner', 'member', 'active'),
          (${organization.id}, ${`viewer-${suffix}@example.test`}, ${passwordHash}, 'Avatar', 'Viewer', 'member', 'active'),
          (${organization.id}, ${`admin-${suffix}@example.test`}, ${passwordHash}, 'Avatar', 'Admin', 'admin', 'active'),
          (${foreignOrganization.id}, ${`foreign-${suffix}@example.test`}, ${passwordHash}, 'Foreign', 'Viewer', 'owner', 'active')
        returning id, email, first_name as "firstName", organization_id as "organizationId"
      `;
      const avatarOwner = users.find((user) => user.firstName === "Avatar" && user.email.includes("avatar-owner"))!;
      const viewer = users.find((user) => user.email.includes("viewer-") && user.organizationId === organization.id)!;
      const admin = users.find((user) => user.firstName === "Avatar" && user.email.includes("admin-"))!;
      const foreignViewer = users.find((user) => user.organizationId === foreignOrganization.id)!;

      const communityToken = await apiKey({
        organizationId: organization.id,
        creatorId: viewer.id,
        scopes: ["community:read"],
        name: "Public avatar community",
      });
      const memberToken = await apiKey({
        organizationId: organization.id,
        creatorId: admin.id,
        scopes: ["members:read"],
        name: "Private avatar members",
      });
      const noAvatarScopeToken = await apiKey({
        organizationId: organization.id,
        creatorId: admin.id,
        scopes: ["search:read"],
        name: "No avatar scope",
      });
      const foreignToken = await apiKey({
        organizationId: foreignOrganization.id,
        creatorId: foreignViewer.id,
        scopes: ["community:read", "members:read"],
        name: "Foreign avatar",
      });

      const [assetId, areaId, spaceId, postId] = Array.from(
        { length: 4 },
        () => randomUUID(),
      );
      const safeFileName = "avatar-policy.png";
      const storageKey = `tenants/${organization.id}/assets/${assetId}/${safeFileName}`;
      const stagingKey = `incoming/${storageKey}`;
      const avatarPath = `/api/media-assets/${assetId}/download`;
      const bytes = Buffer.from("public avatar media policy fixture\n", "utf8");
      const storageRoot = resolve(process.cwd(), ".data", "media");
      const assetPath = join(storageRoot, ...storageKey.split("/"));
      const organizationStorageDirectory = join(
        storageRoot,
        "tenants",
        organization.id,
      );
      assert.ok(
        organizationStorageDirectory.startsWith(`${storageRoot}${process.platform === "win32" ? "\\" : "/"}`),
      );
      storageDirectories.push(organizationStorageDirectory);
      await mkdir(dirname(assetPath), { recursive: true });
      await writeFile(assetPath, bytes, { flag: "wx", mode: 0o600 });

      await sql`
        update users set avatar_url = ${avatarPath}
        where id = ${avatarOwner.id} and organization_id = ${organization.id}
      `;
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
          status, storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          detected_mime_type, declared_size_bytes, actual_size_bytes,
          quota_bytes, upload_expires_at, uploaded_at, scan_completed_at,
          content_sha256
        ) values (
          ${assetId}, ${organization.id}, ${avatarOwner.id}, ${avatarOwner.id},
          'avatar', 'image', 'ready', 'filesystem', ${storageKey}, ${stagingKey},
          'avatar-policy.png', ${safeFileName}, 'image/png', 'image/png',
          ${bytes.byteLength}, ${bytes.byteLength}, ${bytes.byteLength},
          now() + interval '1 hour', now(), now(), ${tokenHash(bytes.toString("base64"))}
        )
      `;
      await sql`
        insert into community_profile_settings (
          organization_id, completion_gate_enabled, revision
        ) values (${organization.id}, false, 1)
      `;
      await sql`
        insert into community_public_profile_fields (
          organization_id, standard_field, required_for_posting, sort_order
        ) values (${organization.id}, 'avatar', false, 0)
      `;
      await sql`
        insert into community_areas (
          id, organization_id, title, slug, sort_order
        ) values (${areaId}, ${organization.id}, 'Avatar area', ${`avatar-area-${suffix}`}, 0)
      `;
      await sql`
        insert into community_spaces (
          id, organization_id, area_id, title, slug, type, sort_order
        ) values (${spaceId}, ${organization.id}, ${areaId}, 'Avatar feed', ${`avatar-feed-${suffix}`}, 'feed', 0)
      `;
      await sql`
        insert into posts (
          id, organization_id, space_id, author_id, content,
          moderation_state, published_at
        ) values (
          ${postId}, ${organization.id}, ${spaceId}, ${avatarOwner.id},
          'Avatar URL context post', 'published', now()
        )
      `;

      const [ownerCookie, viewerCookie, foreignCookie] = await Promise.all([
        login({
          organizationSlug: organization.slug,
          email: avatarOwner.email,
          password,
        }),
        login({
          organizationSlug: organization.slug,
          email: viewer.email,
          password,
        }),
        login({
          organizationSlug: foreignOrganization.slug,
          email: foreignViewer.email,
          password,
        }),
      ]);

      const apiProfileResponse = await apiRequest(
        communityToken,
        `/api/v1/community/profiles/${avatarOwner.id}`,
      );
      assert.equal(apiProfileResponse.status, 200);
      const apiProfile = await json(apiProfileResponse);
      assert.equal(
        apiProfile.data.avatarUrl,
        `/api/v1/media-assets/${assetId}/download`,
      );

      const sessionFeedResponse = await sessionRequest(
        viewerCookie,
        "/api/community/feed?mode=latest&limit=20",
      );
      assert.equal(
        sessionFeedResponse.status,
        200,
        await sessionFeedResponse.clone().text(),
      );
      const sessionFeed = await json(sessionFeedResponse);
      const feedPost = sessionFeed.data.items.find(
        (item: { id: string }) => item.id === postId,
      );
      assert.ok(feedPost);
      assert.equal(feedPost.authorAvatarUrl, avatarPath);

      const publicSessionDownload = await sessionRequest(viewerCookie, avatarPath);
      assert.equal(publicSessionDownload.status, 200);
      assert.deepEqual(
        Buffer.from(await publicSessionDownload.arrayBuffer()),
        bytes,
      );
      assert.equal(
        await readFile(assetPath, "utf8"),
        bytes.toString("utf8"),
      );

      const publicApiDownload = await apiRequest(
        communityToken,
        `/api/v1/media-assets/${assetId}/download`,
      );
      assert.equal(publicApiDownload.status, 307);
      assert.match(
        publicApiDownload.headers.get("location") ?? "",
        new RegExp(`/api/v1/media-assets/${assetId}/content`),
      );
      assert.doesNotMatch(
        publicApiDownload.headers.get("location") ?? "",
        /tenants\//,
      );

      await expectProblem(
        await apiRequest(
          noAvatarScopeToken,
          `/api/v1/media-assets/${assetId}/download`,
        ),
        403,
        "insufficient_scope",
      );
      await expectProblem(
        await apiRequest(
          foreignToken,
          `/api/v1/media-assets/${assetId}/download`,
        ),
        404,
        "not_found",
      );
      await expectProblem(
        await sessionRequest(foreignCookie, avatarPath),
        404,
        "not_found",
      );

      await sql`
        update users set avatar_url = null
        where id = ${avatarOwner.id} and organization_id = ${organization.id}
      `;
      await expectProblem(
        await sessionRequest(viewerCookie, avatarPath),
        404,
        "not_found",
      );
      await expectProblem(
        await apiRequest(
          communityToken,
          `/api/v1/media-assets/${assetId}/download`,
        ),
        404,
        "not_found",
      );
      const ownerUnboundDownload = await sessionRequest(ownerCookie, avatarPath);
      assert.equal(ownerUnboundDownload.status, 200);
      assert.deepEqual(
        Buffer.from(await ownerUnboundDownload.arrayBuffer()),
        bytes,
      );

      await sql`
        update users set avatar_url = ${avatarPath}
        where id = ${avatarOwner.id} and organization_id = ${organization.id}
      `;
      await sql`
        delete from community_public_profile_fields
        where organization_id = ${organization.id}
          and standard_field = 'avatar'
      `;
      await expectProblem(
        await sessionRequest(viewerCookie, avatarPath),
        404,
        "not_found",
      );
      await expectProblem(
        await apiRequest(
          communityToken,
          `/api/v1/media-assets/${assetId}/download`,
        ),
        404,
        "not_found",
      );
      const hiddenApiProfileResponse = await apiRequest(
        communityToken,
        `/api/v1/community/profiles/${avatarOwner.id}`,
      );
      assert.equal(hiddenApiProfileResponse.status, 200);
      assert.equal((await json(hiddenApiProfileResponse)).data.avatarUrl, null);
      const hiddenSessionFeedResponse = await sessionRequest(
        viewerCookie,
        "/api/community/feed?mode=latest&limit=20",
      );
      assert.equal(hiddenSessionFeedResponse.status, 200);
      const hiddenFeed = await json(hiddenSessionFeedResponse);
      assert.equal(
        hiddenFeed.data.items.find((item: { id: string }) => item.id === postId)
          .authorAvatarUrl,
        null,
      );

      const ownerHiddenDownload = await sessionRequest(ownerCookie, avatarPath);
      assert.equal(ownerHiddenDownload.status, 200);
      await ownerHiddenDownload.arrayBuffer();
      const membersDownload = await apiRequest(
        memberToken,
        `/api/v1/media-assets/${assetId}/download`,
      );
      assert.equal(membersDownload.status, 307);

      await sql`
        insert into community_public_profile_fields (
          organization_id, standard_field, required_for_posting, sort_order
        ) values (${organization.id}, 'avatar', false, 0)
      `;
      await sql`
        update users set status = 'disabled'
        where id = ${avatarOwner.id} and organization_id = ${organization.id}
      `;
      await expectProblem(
        await sessionRequest(viewerCookie, avatarPath),
        404,
        "not_found",
      );
      await expectProblem(
        await apiRequest(
          communityToken,
          `/api/v1/media-assets/${assetId}/download`,
        ),
        404,
        "not_found",
      );
      await expectProblem(
        await sessionRequest(ownerCookie, avatarPath),
        401,
        "authentication_required",
      );
      await expectProblem(
        await apiRequest(
          communityToken,
          `/api/v1/community/profiles/${avatarOwner.id}`,
        ),
        404,
        "not_found",
      );
    } finally {
      for (const organizationId of organizationIds.reverse()) {
        await sql`delete from organizations where id = ${organizationId}`;
      }
      for (const directory of storageDirectories) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
