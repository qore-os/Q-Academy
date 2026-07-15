import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import { isCustomDomainTlsAuthorized } from "../src/lib/custom-domains";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("Caddy authorizes only verified non-revoked domains of active tenants", async () => {
  const suffix = randomUUID().slice(0, 8);
  const fixtures = [
    {
      organizationId: randomUUID(),
      organizationStatus: "active",
      hostname: `verified-${suffix}.customer-domain.de`,
      claimStatus: "verified",
    },
    {
      organizationId: randomUUID(),
      organizationStatus: "active",
      hostname: `pending-${suffix}.customer-domain.de`,
      claimStatus: "pending",
    },
    {
      organizationId: randomUUID(),
      organizationStatus: "active",
      hostname: `revoked-${suffix}.customer-domain.de`,
      claimStatus: "revoked",
    },
    {
      organizationId: randomUUID(),
      organizationStatus: "suspended",
      hostname: `suspended-${suffix}.customer-domain.de`,
      claimStatus: "verified",
    },
  ] as const;

  try {
    for (const fixture of fixtures) {
      await sql`
        insert into organizations (id, name, slug, status)
        values (
          ${fixture.organizationId},
          ${`Caddy TLS ${fixture.claimStatus}`},
          ${`caddy-tls-${fixture.organizationStatus}-${fixture.claimStatus}-${suffix}`},
          ${fixture.organizationStatus}
        )
      `;
      const now = new Date();
      const createdAt = new Date(now.getTime() - 1_000);
      const verifiedAt =
        fixture.claimStatus === "verified" || fixture.claimStatus === "revoked"
          ? now
          : null;
      const revokedAt = fixture.claimStatus === "revoked" ? now : null;
      await sql`
        insert into custom_domain_claims (
          organization_id, hostname, status, challenge_hash,
          challenge_expires_at, verified_at, revoked_at, created_at, updated_at
        ) values (
          ${fixture.organizationId}, ${fixture.hostname}, ${fixture.claimStatus},
          ${"a".repeat(64)}, ${new Date(Date.now() + 86_400_000)},
          ${verifiedAt}, ${revokedAt}, ${createdAt}, ${now}
        )
      `;
    }

    assert.equal(
      await isCustomDomainTlsAuthorized(
        `${fixtures[0].hostname.toUpperCase()}.`,
      ),
      true,
    );
    for (const fixture of fixtures.slice(1)) {
      assert.equal(
        await isCustomDomainTlsAuthorized(fixture.hostname),
        false,
        fixture.claimStatus,
      );
    }
    assert.equal(
      await isCustomDomainTlsAuthorized(`unknown-${suffix}.customer-domain.de`),
      false,
    );
    assert.equal(await isCustomDomainTlsAuthorized("localhost"), false);
  } finally {
    for (const fixture of fixtures) {
      await sql`delete from organizations where id = ${fixture.organizationId}`;
    }
  }
});
