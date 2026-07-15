import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

import { ensureCommunityAreaFixture } from "./helpers/community-area";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function environmentValue(name: string) {
  if (process.env[name]) return process.env[name]!;
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || "";
}

function rateLimitHash(action: string, identifier: string) {
  return createHmac("sha256", environmentValue("AUTH_RATE_LIMIT_SECRET"))
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

type FeedResponse = {
  data: {
    items: Array<{ id: string }>;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

async function collectFeed(
  request: APIRequestContext,
  secret: string,
  mode: "latest" | "following",
) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query = new URLSearchParams({ mode, limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const response = await request.get(`/api/v1/community/feed?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    const payload = (await response.json()) as FeedResponse;
    ids.push(...payload.data.items.map((item) => item.id));
    cursor = payload.data.nextCursor;
    pages += 1;
    expect(payload.data.hasMore).toBe(Boolean(cursor));
    expect(pages).toBeLessThan(25);
  } while (cursor);
  return { ids, pages };
}

test("latest and following keyset pagination do not truncate after 750 posts", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "scalability fixture runs once");
  test.setTimeout(240_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const secret = `qak_feed_scale_${randomBytes(24).toString("base64url")}`;
  let organizationId = "";
  let actorId = "";
  let keyId = "";

  try {
    const [demo] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    if (!demo) throw new Error("Seeded password fixture is missing.");

    const [organization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Feed scale ${suffix}`}, ${`feed-scale-${suffix}`})
      returning id
    `;
    organizationId = organization.id;

    const [actor, author] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values
        (${organizationId}, ${`actor-${suffix}@example.test`},
          ${demo.passwordHash}, 'Scale', 'Reader'),
        (${organizationId}, ${`author-${suffix}@example.test`},
          ${demo.passwordHash}, 'Scale', 'Author')
      returning id
    `;
    actorId = actor.id;

    const area = await ensureCommunityAreaFixture(sql, organizationId);

    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, type, access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, 'Scale feed', ${`scale-feed-${suffix}`},
        'discussion', 'open', ${area.nextSpaceSortOrder}
      )
      returning id
    `;

    await sql`
      insert into posts (
        organization_id, space_id, author_id, title, content,
        created_at, updated_at
      )
      select ${organizationId}, ${space.id}, ${author.id},
             'Scale post ' || value::text, 'Scale content ' || value::text,
             now() - (value || ' seconds')::interval,
             now() - (value || ' seconds')::interval
      from generate_series(1, 805) value
    `;
    await sql`
      insert into community_follows (
        organization_id, follower_id, target_type, target_space_id,
        created_at, updated_at
      ) values (
        ${organizationId}, ${actorId}, 'space', ${space.id},
        now() - interval '1 day', now() - interval '1 day'
      )
    `;

    const [key] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values (
        ${organizationId}, ${actorId}, 'Feed scale', ${secret.slice(0, 20)},
        ${createHash("sha256").update(secret).digest("hex")},
        array['community:read']
      )
      returning id
    `;
    keyId = key.id;

    const latest = await collectFeed(request, secret, "latest");
    const following = await collectFeed(request, secret, "following");

    expect(latest.pages).toBe(17);
    expect(following.pages).toBe(17);
    expect(new Set(latest.ids).size).toBe(805);
    expect(new Set(following.ids).size).toBe(805);
    expect(new Set(latest.ids)).toEqual(new Set(following.ids));
  } finally {
    if (organizationId) {
      await sql`delete from organizations where id = ${organizationId}`;
    }
    const rateHashes = [
      ...(keyId ? [rateLimitHash("api_read", keyId)] : []),
      ...(organizationId
        ? [
            rateLimitHash("api_read_tenant", organizationId),
            rateLimitHash("community_feed_read_tenant", organizationId),
          ]
        : []),
      ...(organizationId && actorId
        ? [
            rateLimitHash(
              "community_feed_read",
              `${organizationId}\0${actorId}`,
            ),
          ]
        : []),
    ];
    if (rateHashes.length) {
      await sql`
        delete from auth_rate_limits
        where key_hash = any(${rateHashes}::varchar[])
      `;
    }
    await sql.end();
  }
});
