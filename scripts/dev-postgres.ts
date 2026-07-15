import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { assertUtf8DatabaseEncoding } from "../src/lib/database-encoding";

const databaseDir = path.resolve(".data", "postgres");
const port = 54329;

const embeddedPostgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: (message) => {
    if (String(message).includes("ready to accept connections")) {
      console.log("PostgreSQL is ready on 127.0.0.1:54329");
    }
  },
  onError: (error) => console.error(String(error)),
});

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
  console.log("Initializing local PostgreSQL cluster...");
  await embeddedPostgres.initialise();
}

await embeddedPostgres.start();

try {
  const adminClient = postgres(
    `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    { max: 1 },
  );
  try {
    const existing = await adminClient<Array<{ exists: boolean }>>`
      select exists(select 1 from pg_database where datname = 'q_academy') as exists
    `;
    if (!existing[0]?.exists) {
      await adminClient.unsafe(
        "create database q_academy with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'",
      );
      console.log("Created UTF-8 database q_academy");
    }
  } finally {
    await adminClient.end();
  }

  const applicationClient = postgres(
    `postgresql://postgres:postgres@127.0.0.1:${port}/q_academy`,
    { max: 1 },
  );
  try {
    const result = await applicationClient<Array<{ encoding: string }>>`
      select current_setting('server_encoding') as encoding
    `;
    assertUtf8DatabaseEncoding(result[0]?.encoding);
  } finally {
    await applicationClient.end();
  }
} catch (error) {
  await embeddedPostgres.stop().catch(() => undefined);
  throw error;
}

console.log("DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/q_academy");
console.log("Press Ctrl+C to stop PostgreSQL.");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await embeddedPostgres.stop();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await new Promise(() => undefined);
