import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  clearPersistentRateLimit,
  consumeGuardedPersistentRateLimit,
  consumePersistentRateLimit,
} from "../src/lib/auth-rate-limit";
import { getAuthRateLimitSecret } from "../src/lib/server-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 1, prepare: false });

function rateLimitHash(action: string, identifier: string) {
  return createHmac("sha256", getAuthRateLimitSecret())
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("expired concurrency owners cannot release a newer claim", async () => {
  const action = "ai_message_concurrent" as const;
  const identifier = `lease-fencing:${randomUUID()}`;

  try {
    const first = await consumePersistentRateLimit({ action, identifier });
    assert.equal(first.limited, false);

    await sql`
      update auth_rate_limits
      set reset_at = now() - interval '1 second'
      where action = ${action}
        and reset_at = ${first.resetAt}
    `;

    const second = await consumePersistentRateLimit({ action, identifier });
    assert.equal(second.limited, false);
    assert.ok(second.resetAt.getTime() > first.resetAt.getTime());

    const staleRelease = await clearPersistentRateLimit({
      action,
      identifier,
      expectedResetAt: first.resetAt,
    });
    assert.equal(staleRelease.length, 0);

    const currentRelease = await clearPersistentRateLimit({
      action,
      identifier,
      expectedResetAt: second.resetAt,
    });
    assert.deepEqual(
      currentRelease.map((row) => row.resetAt.getTime()),
      [second.resetAt.getTime()],
    );
  } finally {
    await clearPersistentRateLimit({ action, identifier });
  }
});

test("a saturated authenticated primary leaves tenant guards unchanged", async () => {
  const tenantA = `feed-tenant-a:${randomUUID()}`;
  const tenantB = `feed-tenant-b:${randomUUID()}`;
  const member = `feed-member:${randomUUID()}`;
  const primary = `${tenantA}\0${member}`;
  const primaryHash = rateLimitHash("community_feed_read", primary);
  const tenantAHash = rateLimitHash("community_feed_read_tenant", tenantA);
  const tenantBHash = rateLimitHash("community_feed_read_tenant", tenantB);

  try {
    await sql`
      insert into auth_rate_limits
        (action, key_hash, attempts, reset_at, updated_at)
      values
        ('community_feed_read', ${primaryHash}, 120, now() + interval '10 minutes', now()),
        ('community_feed_read_tenant', ${tenantAHash}, 10, now() + interval '10 minutes', now()),
        ('community_feed_read_tenant', ${tenantBHash}, 7, now() + interval '10 minutes', now())
    `;

    const rejected = await consumeGuardedPersistentRateLimit({
      guards: [
        { action: "community_feed_read_tenant", identifier: tenantA },
      ],
      primary: { action: "community_feed_read", identifier: primary },
    });
    assert.equal(rejected.limited, true);
    assert.equal(rejected.limit, 120);
    assert.equal(rejected.remaining, 0);

    const [state] = await sql<
      Array<{
        primaryAttempts: number;
        tenantAAttempts: number;
        tenantBAttempts: number;
      }>
    >`
      select
        (select attempts::int from auth_rate_limits
         where action = 'community_feed_read' and key_hash = ${primaryHash})
          as "primaryAttempts",
        (select attempts::int from auth_rate_limits
         where action = 'community_feed_read_tenant' and key_hash = ${tenantAHash})
          as "tenantAAttempts",
        (select attempts::int from auth_rate_limits
         where action = 'community_feed_read_tenant' and key_hash = ${tenantBHash})
          as "tenantBAttempts"
    `;
    assert.deepEqual(state, {
      primaryAttempts: 121,
      tenantAAttempts: 10,
      tenantBAttempts: 7,
    });
  } finally {
    await Promise.all([
      clearPersistentRateLimit({
        action: "community_feed_read",
        identifier: primary,
      }),
      clearPersistentRateLimit({
        action: "community_feed_read_tenant",
        identifier: tenantA,
      }),
      clearPersistentRateLimit({
        action: "community_feed_read_tenant",
        identifier: tenantB,
      }),
    ]);
  }
});

test("a saturated tenant guard rolls back a free authenticated primary", async () => {
  const tenant = `feed-tenant:${randomUUID()}`;
  const member = `feed-member:${randomUUID()}`;
  const primary = `${tenant}\0${member}`;
  const primaryHash = rateLimitHash("community_feed_read", primary);
  const tenantHash = rateLimitHash("community_feed_read_tenant", tenant);

  try {
    await sql`
      insert into auth_rate_limits
        (action, key_hash, attempts, reset_at, updated_at)
      values
        ('community_feed_read_tenant', ${tenantHash}, 3000,
         now() + interval '10 minutes', now())
    `;

    const rejected = await consumeGuardedPersistentRateLimit({
      guards: [
        { action: "community_feed_read_tenant", identifier: tenant },
      ],
      primary: { action: "community_feed_read", identifier: primary },
    });
    assert.equal(rejected.limited, true);
    assert.equal(rejected.limit, 3_000);
    assert.equal(rejected.remaining, 0);

    const [state] = await sql<
      Array<{ primaryRows: number; tenantAttempts: number }>
    >`
      select
        (select count(*)::int from auth_rate_limits
         where action = 'community_feed_read' and key_hash = ${primaryHash})
          as "primaryRows",
        (select attempts::int from auth_rate_limits
         where action = 'community_feed_read_tenant' and key_hash = ${tenantHash})
          as "tenantAttempts"
    `;
    assert.deepEqual(state, { primaryRows: 0, tenantAttempts: 3_000 });
  } finally {
    await Promise.all([
      clearPersistentRateLimit({
        action: "community_feed_read",
        identifier: primary,
      }),
      clearPersistentRateLimit({
        action: "community_feed_read_tenant",
        identifier: tenant,
      }),
    ]);
  }
});
