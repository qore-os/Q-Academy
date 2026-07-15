import { isIP } from "node:net";

import { LOCAL_DATABASE_URL, type EnvironmentSource } from "../src/lib/server-environment-validation";

export const DESTRUCTIVE_SEED_FLAG = "ALLOW_DESTRUCTIVE_SEED";
export const SEED_DATABASE_CONFIRMATION = "SEED_EXPECTED_DATABASE";

function loopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function allowedSeedDatabase(databaseName: string) {
  return (
    databaseName === "q_academy" ||
    /^q_academy_[a-z0-9_]+_test$/.test(databaseName)
  );
}

export type DestructiveSeedTarget = {
  databaseUrl: string;
  databaseName: string;
};

export function assertDestructiveSeedAllowed(
  environment: EnvironmentSource,
): DestructiveSeedTarget {
  if (environment.NODE_ENV === "production") {
    throw new Error("Demo seed is disabled when NODE_ENV=production.");
  }
  if (environment[DESTRUCTIVE_SEED_FLAG] !== "true") {
    throw new Error(
      `${DESTRUCTIVE_SEED_FLAG}=true is required for the destructive demo seed.`,
    );
  }

  const databaseUrl = environment.DATABASE_URL?.trim() || LOCAL_DATABASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for seeding.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL for seeding.");
  }
  if (!loopbackHostname(parsed.hostname)) {
    throw new Error("Demo seed is restricted to a loopback PostgreSQL server.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!allowedSeedDatabase(databaseName)) {
    throw new Error(
      "Demo seed is restricted to q_academy or q_academy_*_test databases.",
    );
  }
  if (environment[SEED_DATABASE_CONFIRMATION]?.trim() !== databaseName) {
    throw new Error(
      `${SEED_DATABASE_CONFIRMATION} must exactly match the target database name '${databaseName}'.`,
    );
  }
  return { databaseUrl, databaseName };
}

export function assertSeedDatabaseIdentity(input: {
  expectedDatabaseName: string;
  actualDatabaseName: string;
  serverAddress: string | null;
}) {
  if (input.actualDatabaseName !== input.expectedDatabaseName) {
    throw new Error("Connected PostgreSQL database does not match the confirmed seed target.");
  }
  if (!input.serverAddress || isIP(input.serverAddress) === 0) {
    throw new Error("Connected PostgreSQL server did not expose a verifiable IP address.");
  }
  if (!loopbackHostname(input.serverAddress)) {
    throw new Error("Connected PostgreSQL server is not a loopback server.");
  }
}
