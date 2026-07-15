import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultBaseUrl = "http://127.0.0.1:3000";
const healthTimeoutMs = 120_000;

type HealthPayload = {
  data?: {
    service?: unknown;
    status?: unknown;
    database?: unknown;
    schema?: unknown;
  };
};

export function normalizeTestBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("TEST_BASE_URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("TEST_BASE_URL must not contain credentials.");
  }
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("TEST_BASE_URL must be an origin without a path, query, or hash.");
  }
  return url.origin;
}

export function isQAcademyHealthPayload(value: unknown): value is HealthPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = (value as HealthPayload).data;
  return Boolean(
    data &&
      typeof data === "object" &&
      data.service === "q-academy-api" &&
      data.status === "ok",
  );
}

export function isQAcademyReadyPayload(value: unknown): value is HealthPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = (value as HealthPayload).data;
  return Boolean(
    data &&
      typeof data === "object" &&
      data.status === "ready" &&
      data.database === "connected" &&
      data.schema === "current",
  );
}

export function selectIntegrationTestFiles(entries: readonly string[]) {
  return entries
    .filter((entry) => entry.endsWith(".integration.ts"))
    .sort((left, right) => left.localeCompare(right));
}

async function requestHealth(baseUrl: string, endpoint: "live" | "ready") {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health/${endpoint}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    const body = (await response.json().catch(() => undefined)) as unknown;
    return { response, body };
  } catch {
    return undefined;
  }
}

async function hasQAcademyLiveness(baseUrl: string) {
  const result = await requestHealth(baseUrl, "live");
  return Boolean(
    result?.response.ok && isQAcademyHealthPayload(result.body),
  );
}

async function waitForLiveness(baseUrl: string, server: ChildProcess) {
  const deadline = Date.now() + healthTimeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `The integration test server exited before becoming live (exit ${server.exitCode}).`,
      );
    }
    if (await hasQAcademyLiveness(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `The integration test server did not become live within ${healthTimeoutMs / 1_000} seconds.`,
  );
}

async function assertReady(baseUrl: string) {
  const result = await requestHealth(baseUrl, "ready");
  if (result?.response.ok && isQAcademyReadyPayload(result.body)) return;

  const status = result?.response.status ?? "unreachable";
  const detail =
    result?.body && typeof result.body === "object" && "detail" in result.body
      ? String((result.body as { detail?: unknown }).detail)
      : "no readiness detail";
  throw new Error(
    `Integration test server ${baseUrl} is not ready (${status}: ${detail}). Apply migrations and verify DATABASE_URL first.`,
  );
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local integration test port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function startTestServer(port: number) {
  const nextCli = path.join(rootDirectory, "node_modules", "next", "dist", "bin", "next");
  return spawn(
    process.execPath,
    [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: rootDirectory,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    },
  );
}

async function stopOwnedServer(server: ChildProcess | undefined) {
  if (!server?.pid || server.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function runTests(baseUrl: string) {
  const entries = await readdir(path.join(rootDirectory, "tests"));
  const files = selectIntegrationTestFiles(entries).map((entry) =>
    path.join(rootDirectory, "tests", entry),
  );
  if (files.length === 0) {
    throw new Error("No tests/*.integration.ts files were found.");
  }

  const tsxCli = path.join(rootDirectory, "node_modules", "tsx", "dist", "cli.mjs");
  const register = path.join(rootDirectory, "tests", "register-server-only.cjs");
  const child = spawn(
    process.execPath,
    [tsxCli, "--require", register, "--test", "--test-concurrency=1", ...files],
    {
      cwd: rootDirectory,
      env: { ...process.env, TEST_BASE_URL: baseUrl },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Integration tests stopped by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function main() {
  let ownedServer: ChildProcess | undefined;
  const stopForSignal = (signal: NodeJS.Signals) => {
    void stopOwnedServer(ownedServer).finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  const onSigint = () => stopForSignal("SIGINT");
  const onSigterm = () => stopForSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const configuredBaseUrl = process.env.TEST_BASE_URL?.trim();
    let baseUrl: string;
    if (configuredBaseUrl) {
      baseUrl = normalizeTestBaseUrl(configuredBaseUrl);
      if (!(await hasQAcademyLiveness(baseUrl))) {
        throw new Error(
          `Explicit TEST_BASE_URL ${baseUrl} is not a live Q-Academy server.`,
        );
      }
    } else if (await hasQAcademyLiveness(defaultBaseUrl)) {
      baseUrl = defaultBaseUrl;
      console.log(`Using existing integration test server at ${baseUrl}.`);
    } else {
      const port = await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Starting isolated integration test server at ${baseUrl}.`);
      ownedServer = startTestServer(port);
      await waitForLiveness(baseUrl, ownedServer);
    }

    await assertReady(baseUrl);
    process.exitCode = await runTests(baseUrl);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await stopOwnedServer(ownedServer);
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
