import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { assertUtf8DatabaseEncoding } from "../src/lib/database-encoding";
import { assertCompatibleMigrationHistory } from "../src/lib/migration-history-validation";
import { databaseUrlForEnvironment } from "../src/lib/server-environment-validation";
import { loadProjectEnvironment } from "./load-environment";

loadProjectEnvironment();
const databaseUrl = databaseUrlForEnvironment(process.env);
const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);
const migrationFolder = path.join(process.cwd(), "drizzle");
const migrationLockNamespace = 1_364_217_153;
const migrationLockKey = 1_296_651_474;
let migrationLockAcquired = false;
let migrationBackendPid: number | undefined;

type MigrationJournal = Readonly<{
  entries: readonly Readonly<{ tag: string; when: number }>[];
}>;

function expectedMigrationHistory() {
  const journal = JSON.parse(
    readFileSync(path.join(migrationFolder, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const migrations = readMigrationFiles({ migrationsFolder: migrationFolder });
  if (migrations.length !== journal.entries.length) {
    throw new Error("Migration journal and SQL file count diverged.");
  }
  return journal.entries.map((entry, index) => {
    const migration = migrations[index];
    if (!migration || migration.folderMillis !== entry.when) {
      throw new Error(`Migration journal entry ${entry.tag} is inconsistent.`);
    }
    return {
      tag: entry.tag,
      hash: migration.hash,
      createdAt: migration.folderMillis,
    };
  });
}

async function assertDatabaseMigrationHistory() {
  const [table] = await client<Array<{ exists: boolean }>>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists
  `;
  if (!table?.exists) return;
  const applied = await client<
    Array<{ hash: string; createdAt: string | null }>
  >`
    select hash, created_at::text as "createdAt"
    from drizzle.__drizzle_migrations
    order by created_at, id
  `;
  assertCompatibleMigrationHistory(expectedMigrationHistory(), applied);
}

try {
  const lock = await client<Array<{ backendPid: number }>>`
    select
      pg_backend_pid() as "backendPid",
      pg_advisory_lock(${migrationLockNamespace}, ${migrationLockKey})
  `;
  migrationBackendPid = lock[0]?.backendPid;
  if (!Number.isSafeInteger(migrationBackendPid)) {
    throw new Error("Could not identify the database migration lock session.");
  }
  migrationLockAcquired = true;

  const encoding = await client<Array<{ encoding: string }>>`
    select current_setting('server_encoding') as encoding
  `;
  assertUtf8DatabaseEncoding(encoding[0]?.encoding);
  await assertDatabaseMigrationHistory();
  await migrate(db, { migrationsFolder: migrationFolder });
  console.log("Database migrations applied successfully.");
} finally {
  try {
    if (migrationLockAcquired) {
      const result = await client<
        Array<{ backendPid: number; unlocked: boolean }>
      >`
        select
          pg_backend_pid() as "backendPid",
          pg_advisory_unlock(${migrationLockNamespace}, ${migrationLockKey})
            as unlocked
      `;
      if (
        result[0]?.backendPid !== migrationBackendPid ||
        result[0]?.unlocked !== true
      ) {
        throw new Error(
          "The database migration advisory lock session was not preserved.",
        );
      }
    }
  } finally {
    await client.end();
  }
}
