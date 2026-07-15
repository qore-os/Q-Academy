import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getRounds, hash } from "bcryptjs";
import postgres from "postgres";

import {
  assertDestructiveSeedAllowed,
  assertSeedDatabaseIdentity,
} from "../seed-guard";

const DEMO_PASSWORD = "Demo123!";
const BCRYPT_ROUNDS = 12;
const EXPECTED_ORGANIZATION = "q-academy";

export const productionSmokeFixtures = [
  { email: "admin@q-academy.de", role: "owner" },
  { email: "lea@q-academy.de", role: "member" },
] as const;

type Mode = "prepare" | "restore";
type Environment = Record<string, string | undefined>;
type FixtureRecord = {
  id: string;
  email: string;
  role: string;
  status: string;
  organizationSlug: string;
};

export function assertGitHubActionsEnvironment(environment: Environment) {
  if (environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true") {
    throw new Error(
      "Production-smoke credential rotation is restricted to GitHub Actions CI.",
    );
  }
  if (!environment.GITHUB_ENV?.trim()) {
    throw new Error("GITHUB_ENV is required for production-smoke credentials.");
  }
}

export function assertExpectedFixtureRecords(records: FixtureRecord[]) {
  if (records.length !== productionSmokeFixtures.length) {
    throw new Error("Expected exactly two production-smoke fixture users.");
  }

  for (const expected of productionSmokeFixtures) {
    const matches = records.filter((record) => record.email === expected.email);
    if (
      matches.length !== 1 ||
      matches[0].role !== expected.role ||
      matches[0].status !== "active" ||
      matches[0].organizationSlug !== EXPECTED_ORGANIZATION
    ) {
      throw new Error(
        `Production-smoke fixture ${expected.email} does not match its active role and organization contract.`,
      );
    }
  }
}

export function generateProductionSmokePassword() {
  const password = randomBytes(32).toString("base64url");
  if (password.length < 40 || password === DEMO_PASSWORD) {
    throw new Error("Failed to generate a strong production-smoke password.");
  }
  return password;
}

function parseMode(value: string | undefined): Mode {
  if (value === "prepare" || value === "restore") return value;
  throw new Error("Usage: production-smoke-credentials.ts <prepare|restore>");
}

async function rotateCredentials(mode: Mode, environment: Environment) {
  assertGitHubActionsEnvironment(environment);
  const seedTarget = assertDestructiveSeedAllowed(environment);
  const client = postgres(seedTarget.databaseUrl, { max: 1 });
  const password =
    mode === "prepare" ? generateProductionSmokePassword() : DEMO_PASSWORD;
  if (mode === "prepare") {
    process.stdout.write(`::add-mask::${password}\n`);
  }
  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  if (getRounds(passwordHash) !== BCRYPT_ROUNDS) {
    throw new Error("Production-smoke password hash cost is invalid.");
  }

  try {
    const [identity] = await client<Array<{
      databaseName: string;
      serverAddress: string | null;
    }>>`
      select
        current_database() as "databaseName",
        inet_server_addr()::text as "serverAddress"
    `;
    assertSeedDatabaseIdentity({
      expectedDatabaseName: seedTarget.databaseName,
      actualDatabaseName: identity.databaseName,
      serverAddress: identity.serverAddress,
    });

    await client.begin(async (transaction) => {
      const records = await transaction<FixtureRecord[]>`
        select
          users.id::text as id,
          users.email,
          users.role::text as role,
          users.status::text as status,
          organizations.slug as "organizationSlug"
        from users
        join organizations on organizations.id = users.organization_id
        where users.email in (
          ${productionSmokeFixtures[0].email},
          ${productionSmokeFixtures[1].email}
        )
        for update of users
      `;
      assertExpectedFixtureRecords(records);

      for (const record of records) {
        const updated = await transaction<Array<{ id: string }>>`
          update users
          set password_hash = ${passwordHash}
          where id = ${record.id}::uuid
          returning id::text as id
        `;
        if (updated.length !== 1 || updated[0].id !== record.id) {
          throw new Error(`Failed to rotate production-smoke fixture ${record.email}.`);
        }
      }
    });

    const githubEnvironmentPath = environment.GITHUB_ENV!.trim();
    if (mode === "prepare") {
      appendFileSync(
        githubEnvironmentPath,
        `PLAYWRIGHT_SEED_PASSWORD=${password}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      process.stdout.write("Prepared ephemeral production-smoke credentials.\n");
    } else {
      appendFileSync(githubEnvironmentPath, "PLAYWRIGHT_SEED_PASSWORD=\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      process.stdout.write("Restored disposable demo credentials.\n");
    }
  } finally {
    await client.end();
  }
}

async function main() {
  await rotateCredentials(parseMode(process.argv[2]), process.env);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
