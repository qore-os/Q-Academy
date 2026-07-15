import "server-only";

import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { postgresClient } from "@/db";
import { assertUtf8DatabaseEncoding } from "@/lib/database-encoding";
import { evaluateMigrationReadiness } from "@/lib/schema-readiness-validation";

let expectedHashes: ReadonlySet<string> | null = null;

function getExpectedMigrationHashes() {
  if (!expectedHashes) {
    expectedHashes = new Set(
      readMigrationFiles({
        migrationsFolder: join(process.cwd(), "drizzle"),
      }).map((migration) => migration.hash),
    );
  }
  return expectedHashes;
}

export async function assertCurrentDatabaseSchema() {
  const expected = getExpectedMigrationHashes();
  const [applied, database] = await Promise.all([
    postgresClient<Array<{ hash: string }>>`
      select hash
      from drizzle.__drizzle_migrations
    `,
    postgresClient<Array<{ encoding: string }>>`
      select current_setting('server_encoding') as encoding
    `,
  ]);
  const encoding = assertUtf8DatabaseEncoding(database[0]?.encoding);
  const readiness = evaluateMigrationReadiness(
    expected,
    applied.map(({ hash }) => hash),
  );
  if (!readiness.current) {
    throw new Error(
      `Database schema is not current (${readiness.appliedMigrations} applied, ${readiness.missingMigrations}/${readiness.expectedMigrations} expected migrations missing).`,
    );
  }
  return {
    migrations: readiness.appliedMigrations,
    expectedMigrations: readiness.expectedMigrations,
    encoding,
  };
}
