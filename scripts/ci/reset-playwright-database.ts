import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

type EnvironmentSource = Record<string, string | undefined>;

export type PlaywrightDatabaseResetTarget = {
  adminUrl: string;
  databaseUrl: string;
  databaseName: string;
  ownerRole: string;
};

function required(environment: EnvironmentSource, name: string) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Playwright database reset.`);
  }
  return value;
}

function parsePostgresUrl(value: string, name: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must use PostgreSQL.`);
  }
  return parsed;
}

function loopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function databaseName(url: URL) {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

export function resolvePlaywrightDatabaseResetTarget(
  environment: EnvironmentSource,
): PlaywrightDatabaseResetTarget {
  if (environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true") {
    throw new Error(
      "The Playwright database reset is restricted to GitHub Actions CI.",
    );
  }

  const expectedDatabase = required(
    environment,
    "PLAYWRIGHT_RESET_EXPECTED_DATABASE",
  );
  if (
    expectedDatabase !== "q_academy" &&
    !/^q_academy_[a-z0-9_]+_test$/.test(expectedDatabase)
  ) {
    throw new Error(
      "The Playwright reset target is not an allowed disposable database.",
    );
  }

  const expectedOwner = required(environment, "PLAYWRIGHT_RESET_EXPECTED_OWNER");
  if (!/^q_academy_[a-z0-9_]+$/.test(expectedOwner)) {
    throw new Error(
      "The Playwright reset owner is not an allowed disposable role.",
    );
  }

  const adminUrl = parsePostgresUrl(
    required(environment, "POSTGRES_ADMIN_URL"),
    "POSTGRES_ADMIN_URL",
  );
  const targetUrl = parsePostgresUrl(
    required(environment, "DATABASE_URL"),
    "DATABASE_URL",
  );
  if (
    !loopbackHostname(adminUrl.hostname) ||
    !loopbackHostname(targetUrl.hostname)
  ) {
    throw new Error(
      "The Playwright database reset requires loopback PostgreSQL URLs.",
    );
  }
  if (
    adminUrl.hostname !== targetUrl.hostname ||
    (adminUrl.port || "5432") !== (targetUrl.port || "5432")
  ) {
    throw new Error(
      "The Playwright admin and target URLs must identify the same server.",
    );
  }
  if (
    databaseName(adminUrl) !== "postgres" ||
    decodeURIComponent(adminUrl.username) !== "postgres"
  ) {
    throw new Error(
      "POSTGRES_ADMIN_URL must identify the local postgres administration database and role.",
    );
  }
  if (databaseName(targetUrl) !== expectedDatabase) {
    throw new Error("DATABASE_URL does not match PLAYWRIGHT_RESET_EXPECTED_DATABASE.");
  }
  if (decodeURIComponent(targetUrl.username) !== expectedOwner) {
    throw new Error("DATABASE_URL does not match PLAYWRIGHT_RESET_EXPECTED_OWNER.");
  }

  return {
    adminUrl: adminUrl.toString(),
    databaseUrl: targetUrl.toString(),
    databaseName: expectedDatabase,
    ownerRole: expectedOwner,
  };
}

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function resetPlaywrightDatabase(
  environment: EnvironmentSource = process.env,
) {
  const target = resolvePlaywrightDatabaseResetTarget(environment);
  const admin = postgres(target.adminUrl, { max: 1 });
  try {
    const [identity] = await admin<
      [{ database: string; user: string; serverAddress: string | null }]
    >`
      select
        current_database() as database,
        current_user as user,
        host(inet_server_addr()) as "serverAddress"
    `;
    if (
      identity.database !== "postgres" ||
      identity.user !== "postgres" ||
      !identity.serverAddress ||
      isIP(identity.serverAddress) === 0
    ) {
      throw new Error(
        "The Playwright database reset could not verify the local admin connection.",
      );
    }

    const [owner] = await admin<
      Array<{ canLogin: boolean; isSuperuser: boolean }>
    >`
      select rolcanlogin as "canLogin", rolsuper as "isSuperuser"
      from pg_roles
      where rolname = ${target.ownerRole}
    `;
    if (!owner || owner.canLogin !== true || owner.isSuperuser !== false) {
      throw new Error(
        "The Playwright database owner must be an existing non-superuser login role.",
      );
    }

    const databaseIdentifier = quotedIdentifier(target.databaseName);
    const ownerIdentifier = quotedIdentifier(target.ownerRole);
    await admin.unsafe(`drop database if exists ${databaseIdentifier} with (force)`);
    await admin.unsafe(
      `create database ${databaseIdentifier} with owner ${ownerIdentifier} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
    );
  } finally {
    await admin.end();
  }

  const verification = postgres(target.databaseUrl, { max: 1 });
  try {
    const [identity] = await verification<
      [
        {
          database: string;
          user: string;
          encoding: string;
          serverAddress: string | null;
        },
      ]
    >`
      select
        current_database() as database,
        current_user as user,
        current_setting('server_encoding') as encoding,
        host(inet_server_addr()) as "serverAddress"
    `;
    if (
      identity.database !== target.databaseName ||
      identity.user !== target.ownerRole ||
      identity.encoding !== "UTF8" ||
      !identity.serverAddress ||
      isIP(identity.serverAddress) === 0
    ) {
      throw new Error("The recreated Playwright database failed identity verification.");
    }
  } finally {
    await verification.end();
  }

  process.stdout.write(
    `Recreated disposable Playwright database ${target.databaseName}.\n`,
  );
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  await resetPlaywrightDatabase().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Playwright database reset failed."}\n`,
    );
    process.exitCode = 1;
  });
}
