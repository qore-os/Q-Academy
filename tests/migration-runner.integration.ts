import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationFolder = path.join(projectRoot, "drizzle");
const adminUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
const freshDatabase = "q_academy_migration_runner_fresh_test";
const incrementalDatabase = "q_academy_migration_runner_incremental_test";

type Journal = {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

function databaseUrl(databaseName: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function runProductionMigrator(databaseName: string) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is required to test the production script.");
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, "run", "db:migrate"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(databaseName),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Production migrator exited ${code}.\n${output}`));
    });
  });
}

test(
  "production migrator serializes fresh runs and upgrades the latest migration",
  { timeout: 180_000 },
  async () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationFolder, "meta", "_journal.json"), "utf8"),
    ) as Journal;
    const latest = journal.entries.at(-1);
    assert.ok(latest);
    const admin = postgres(adminUrl, { max: 1 });
    const stagedFolder = mkdtempSync(
      path.join(tmpdir(), "q-academy-migration-runner-"),
    );

    try {
      for (const databaseName of [freshDatabase, incrementalDatabase]) {
        await admin.unsafe(
          `drop database if exists "${databaseName}" with (force)`,
        );
        await admin.unsafe(
          `create database "${databaseName}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
        );
      }

      const freshRuns = await Promise.all([
        runProductionMigrator(freshDatabase),
        runProductionMigrator(freshDatabase),
      ]);
      for (const output of freshRuns) {
        assert.match(output, /Database migrations applied successfully\./);
      }
      const fresh = postgres(databaseUrl(freshDatabase), { max: 1 });
      try {
        const [result] = await fresh<Array<{ count: number }>>`
          select count(*)::integer as count from drizzle.__drizzle_migrations
        `;
        assert.equal(result?.count, journal.entries.length);
        const immutableEntry = journal.entries.find(
          ({ tag }) => tag === "0062_course_release_links",
        );
        assert.ok(immutableEntry);
        await fresh`
          update drizzle.__drizzle_migrations
          set hash = ${"0".repeat(64)}
          where created_at = ${immutableEntry.when}
        `;
        await assert.rejects(
          runProductionMigrator(freshDatabase),
          /Migration history is incompatible: 0062_course_release_links[\s\S]*Do not edit drizzle\.__drizzle_migrations/,
        );
      } finally {
        await fresh.end();
      }

      const priorEntries = journal.entries.slice(0, -1);
      mkdirSync(path.join(stagedFolder, "meta"), { recursive: true });
      writeFileSync(
        path.join(stagedFolder, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: priorEntries }),
      );
      for (const entry of priorEntries) {
        copyFileSync(
          path.join(migrationFolder, `${entry.tag}.sql`),
          path.join(stagedFolder, `${entry.tag}.sql`),
        );
      }

      const incremental = postgres(databaseUrl(incrementalDatabase), {
        max: 1,
      });
      try {
        await migrate(drizzle(incremental), {
          migrationsFolder: stagedFolder,
        });
        const [before] = await incremental<Array<{ count: number }>>`
          select count(*)::integer as count from drizzle.__drizzle_migrations
        `;
        assert.equal(before?.count, priorEntries.length);
      } finally {
        await incremental.end();
      }

      const incrementalOutput = await runProductionMigrator(
        incrementalDatabase,
      );
      assert.match(
        incrementalOutput,
        /Database migrations applied successfully\./,
      );
      const upgraded = postgres(databaseUrl(incrementalDatabase), { max: 1 });
      try {
        const [after] = await upgraded<
          Array<{ count: number; latestCreatedAt: number }>
        >`
          select
            count(*)::integer as count,
            max(created_at)::double precision as "latestCreatedAt"
          from drizzle.__drizzle_migrations
        `;
        assert.equal(after?.count, journal.entries.length);
        assert.equal(after?.latestCreatedAt, latest.when);
      } finally {
        await upgraded.end();
      }
    } finally {
      rmSync(stagedFolder, { recursive: true, force: true });
      await admin.unsafe(
        `drop database if exists "${freshDatabase}" with (force)`,
      );
      await admin.unsafe(
        `drop database if exists "${incrementalDatabase}" with (force)`,
      );
      await admin.end();
    }
  },
);
