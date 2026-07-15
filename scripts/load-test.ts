import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  assertSafeLoadTestOrigin,
  createLoadTestEvidence,
  evaluateLoadTest,
  normalizeLoadTestOrigin,
  normalizeMemberCoursePath,
  normalizeUuidOption,
  resolveLoadTestScenarios,
  summarizeLoadTestSamples,
  validateLoadTestCliArguments,
  type LoadTestSample,
  type LoadTestScenario,
} from "../src/lib/operations/load-test";

const MAX_REQUESTS = 250_000;
const JOB_ACKNOWLEDGEMENT = "STAGING_SYNTHETIC_JOB_DISPATCH";
const MAX_SECRET_FILE_BYTES = 4_096;

type LoginCredentials = {
  email: string;
  password: string;
  organizationSlug?: string;
};

type WorkerSessions = {
  memberCookie?: string;
  adminCookie?: string;
};

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function repeatedOption(name: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1] as string);
    }
  }
  return values;
}

function numberOption(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
) {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `${name} must be ${integer ? "an integer " : ""}between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function booleanOption(name: string, fallback: boolean) {
  const raw = option(name);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function readProtectedFile(file: string, label: string) {
  let stats;
  try {
    stats = lstatSync(file);
  } catch {
    throw new Error(`${label} could not be read.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file.`);
  }
  if (stats.size < 1 || stats.size > MAX_SECRET_FILE_BYTES) {
    throw new Error(`${label} has an invalid size.`);
  }
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be readable or writable by group or other users.`);
  }
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`${label} could not be read.`);
  }
}

function readCredentials(file: string | undefined, label: string) {
  if (!file) return undefined;
  const serialized = readProtectedFile(file, label);
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  const candidate = value as Record<string, unknown>;
  const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
  const password =
    typeof candidate.password === "string" ? candidate.password : "";
  const organizationSlug =
    typeof candidate.organizationSlug === "string"
      ? candidate.organizationSlug.trim().toLowerCase()
      : undefined;
  if (
    email.length < 3 ||
    email.length > 320 ||
    !email.includes("@") ||
    password.length < 1 ||
    password.length > 512 ||
    (organizationSlug !== undefined &&
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(organizationSlug))
  ) {
    throw new Error(`${label} is malformed.`);
  }
  return { email, password, organizationSlug } satisfies LoginCredentials;
}

function readToken(
  file: string | undefined,
  label: string,
  minimumLength: number,
) {
  if (!file) return undefined;
  const value = readProtectedFile(file, label).trim();
  if (
    value.length < minimumLength ||
    value.length > 512 ||
    /\s/.test(value)
  ) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function roundedLatency(started: number) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function requestIdMatches(response: Response, payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const meta = (payload as { meta?: unknown }).meta;
  const requestId = response.headers.get("x-request-id");
  return Boolean(
    requestId &&
      meta &&
      typeof meta === "object" &&
      !Array.isArray(meta) &&
      (meta as { requestId?: unknown }).requestId === requestId,
  );
}

function sessionCookie(response: Response) {
  const raw = response.headers.get("set-cookie");
  const cookie = raw?.split(";", 1)[0]?.trim();
  return cookie && /^[^=;,\s]+=[^;,\s]+$/.test(cookie) ? cookie : undefined;
}

async function jsonRequest(input: {
  origin: string;
  scenario: LoadTestScenario;
  pathname: string;
  timeoutMs: number;
  init?: RequestInit;
  validate: (payload: unknown, response: Response) => boolean;
}): Promise<LoadTestSample> {
  const started = performance.now();
  try {
    const response = await fetch(new URL(input.pathname, input.origin), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
      ...input.init,
      headers: {
        Accept: "application/json",
        "User-Agent": "q-academy-bounded-load-test/1.0",
        ...input.init?.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    const valid =
      response.ok &&
      requestIdMatches(response, payload) &&
      input.validate(payload, response);
    return {
      scenario: input.scenario,
      latencyMs: roundedLatency(started),
      ok: valid,
      status: response.status,
      ...(valid
        ? {}
        : {
            failureCode:
              response.status === 429
                ? "rate_limited"
                : response.ok
                  ? "contract_mismatch"
                  : "http_error",
          }),
    };
  } catch (error) {
    return {
      scenario: input.scenario,
      latencyMs: roundedLatency(started),
      ok: false,
      status: null,
      failureCode:
        error instanceof Error &&
        ["AbortError", "TimeoutError"].includes(error.name)
          ? "timeout"
          : "network_error",
    };
  }
}

async function loginRequest(input: {
  origin: string;
  timeoutMs: number;
  credentials: LoginCredentials;
}) {
  const started = performance.now();
  try {
    const response = await fetch(new URL("/api/v1/auth/login", input.origin), {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "q-academy-bounded-load-test/1.0",
      },
      body: JSON.stringify(input.credentials),
    });
    const payload = await response.json().catch(() => null);
    const cookie = sessionCookie(response);
    const data =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : undefined;
    const valid = Boolean(
      response.status === 200 &&
        requestIdMatches(response, payload) &&
        cookie &&
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        "user" in data,
    );
    return {
      cookie: valid ? cookie : undefined,
      sample: {
        scenario: "login",
        latencyMs: roundedLatency(started),
        ok: valid,
        status: response.status,
        ...(valid
          ? {}
          : {
              failureCode:
                response.status === 202
                  ? "mfa_not_supported"
                  : response.status === 429
                    ? "rate_limited"
                    : response.ok
                      ? "contract_mismatch"
                      : "http_error",
            }),
      } satisfies LoadTestSample,
    };
  } catch (error) {
    return {
      cookie: undefined,
      sample: {
        scenario: "login",
        latencyMs: roundedLatency(started),
        ok: false,
        status: null,
        failureCode:
          error instanceof Error &&
          ["AbortError", "TimeoutError"].includes(error.name)
            ? "timeout"
            : "network_error",
      } satisfies LoadTestSample,
    };
  }
}

async function htmlRequest(input: {
  origin: string;
  scenario: "course-list" | "course-read" | "admin";
  pathname: string;
  timeoutMs: number;
  cookie: string;
}): Promise<LoadTestSample> {
  const started = performance.now();
  try {
    const response = await fetch(new URL(input.pathname, input.origin), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        Accept: "text/html",
        Cookie: input.cookie,
        "User-Agent": "q-academy-bounded-load-test/1.0",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text().catch(() => "");
    const valid =
      response.status === 200 &&
      contentType.toLowerCase().includes("text/html") &&
      /<(?:!doctype\s+html|html)(?:\s|>)/i.test(body);
    return {
      scenario: input.scenario,
      latencyMs: roundedLatency(started),
      ok: valid,
      status: response.status,
      ...(valid
        ? {}
        : {
            failureCode:
              response.status >= 300 && response.status < 400
                ? "unexpected_redirect"
                : response.ok
                  ? "contract_mismatch"
                  : "http_error",
          }),
    };
  } catch (error) {
    return {
      scenario: input.scenario,
      latencyMs: roundedLatency(started),
      ok: false,
      status: null,
      failureCode:
        error instanceof Error &&
        ["AbortError", "TimeoutError"].includes(error.name)
          ? "timeout"
          : "network_error",
    };
  }
}

function dataObject(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const data = (payload as { data?: unknown }).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}

function writeEvidence(file: string | undefined, report: unknown) {
  if (!file) return;
  const destination = path.resolve(file);
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function assertEvidenceDestinationAvailable(file: string | undefined) {
  if (file && existsSync(path.resolve(file))) {
    throw new Error("--output must name a new evidence file.");
  }
}

async function main() {
  validateLoadTestCliArguments(process.argv.slice(2));
  const origin = normalizeLoadTestOrigin(option("--origin"), "--origin");
  const confirmedOrigin = normalizeLoadTestOrigin(
    option("--confirm-origin"),
    "--confirm-origin",
  );
  if (origin !== confirmedOrigin) {
    throw new Error("--confirm-origin must exactly match --origin.");
  }
  assertSafeLoadTestOrigin(origin);
  assertEvidenceDestinationAvailable(option("--output"));

  const durationSeconds = numberOption(
    "--duration-seconds",
    30,
    1,
    300,
    true,
  );
  const vus = numberOption("--vus", 4, 1, 32, true);
  const maxRequests = numberOption(
    "--max-requests",
    1_000,
    1,
    MAX_REQUESTS,
    true,
  );
  const timeoutMs = numberOption("--timeout-ms", 5_000, 100, 30_000, true);
  const maxP95Ms = numberOption("--max-p95-ms", 1_000, 1, 60_000);
  const maxErrorRate = numberOption("--max-error-rate", 0.01, 0, 1);
  const minRequests = numberOption(
    "--min-requests",
    20,
    1,
    MAX_REQUESTS,
    true,
  );
  if (minRequests > maxRequests) {
    throw new Error("--min-requests must not exceed --max-requests.");
  }
  const requireAll = booleanOption("--require", false);
  const requested = repeatedOption("--scenario") as LoadTestScenario[];
  const memberCoursePath = normalizeMemberCoursePath(
    option("--member-course-path"),
  );
  const progressMemberId = normalizeUuidOption(
    option("--progress-member-id"),
    "--progress-member-id",
  );
  const progressLessonId = normalizeUuidOption(
    option("--progress-lesson-id"),
    "--progress-lesson-id",
  );
  const memberCredentialsFile = option("--member-credentials-file");
  const adminCredentialsFile = option("--admin-credentials-file");
  const apiKeyFile = option("--api-key-file");
  const jobSecretFile = option("--job-secret-file");
  const jobMutationAcknowledged =
    option("--ack-mutating-job") === JOB_ACKNOWLEDGEMENT;
  const resolution = resolveLoadTestScenarios({
    requested,
    requireAll,
    prerequisites: {
      hasMemberCredentials: Boolean(memberCredentialsFile),
      hasAdminCredentials: Boolean(adminCredentialsFile),
      hasApiKey: Boolean(apiKeyFile),
      hasCoursePath: Boolean(memberCoursePath),
      hasProgressIds: Boolean(progressMemberId && progressLessonId),
      hasJobSecret: Boolean(jobSecretFile),
      jobMutationAcknowledged,
    },
  });
  if (
    option("--ack-mutating-job") !== undefined &&
    !resolution.requested.includes("job")
  ) {
    throw new Error("--ack-mutating-job is only valid when the job scenario is requested.");
  }
  if (
    resolution.requested.includes("job") &&
    option("--ack-mutating-job") !== undefined &&
    !jobMutationAcknowledged
  ) {
    throw new Error(
      `--ack-mutating-job must equal ${JOB_ACKNOWLEDGEMENT}.`,
    );
  }

  const selected = new Set(resolution.selected);
  const memberCredentials =
    selected.has("login") || selected.has("course-list") || selected.has("course-read")
      ? readCredentials(memberCredentialsFile, "Member credentials file")
      : undefined;
  const adminCredentials =
    selected.has("login") || selected.has("admin")
      ? readCredentials(adminCredentialsFile, "Admin credentials file")
      : undefined;
  const apiKey =
    selected.has("api") || selected.has("progress")
      ? readToken(apiKeyFile, "API key file", 32)
      : undefined;
  const jobSecret = selected.has("job")
    ? readToken(jobSecretFile, "Job secret file", 32)
    : undefined;

  const samples: LoadTestSample[] = [];
  let reservedRequests = 0;
  let steadySequence = 0;
  const startedAt = new Date();
  const started = performance.now();
  const deadline = started + durationSeconds * 1_000;
  const reserve = () => {
    if (reservedRequests >= maxRequests) return false;
    reservedRequests += 1;
    return true;
  };
  const record = (sample: LoadTestSample) => samples.push(sample);

  if (selected.has("job") && reserve()) {
    record(
      await jsonRequest({
        origin,
        scenario: "job",
        pathname: "/api/internal/jobs/dispatch?limit=1&cleanup=dry-run&cleanupLimit=1",
        timeoutMs,
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${jobSecret}` },
        },
        validate: (payload) => typeof dataObject(payload)?.processed === "number",
      }),
    );
  }

  const needsMemberSession =
    selected.has("course-list") ||
    selected.has("course-read") ||
    (selected.has("login") && Boolean(memberCredentials));
  const needsAdminSession =
    selected.has("admin") ||
    (selected.has("login") && !memberCredentials && Boolean(adminCredentials));

  await Promise.all(
    Array.from({ length: vus }, async () => {
      const sessions: WorkerSessions = {};
      if (needsMemberSession && memberCredentials && reserve()) {
        const result = await loginRequest({ origin, timeoutMs, credentials: memberCredentials });
        sessions.memberCookie = result.cookie;
        record(result.sample);
      }
      if (needsAdminSession && adminCredentials && reserve()) {
        const result = await loginRequest({ origin, timeoutMs, credentials: adminCredentials });
        sessions.adminCookie = result.cookie;
        record(result.sample);
      }

      const steadyScenarios = resolution.selected.filter((scenario) => {
        if (scenario === "login" || scenario === "job") return false;
        if (scenario === "course-list" || scenario === "course-read") {
          return Boolean(sessions.memberCookie);
        }
        if (scenario === "admin") return Boolean(sessions.adminCookie);
        return true;
      });
      while (performance.now() < deadline && steadyScenarios.length) {
        if (!reserve()) break;
        const scenario = steadyScenarios[
          steadySequence % steadyScenarios.length
        ] as LoadTestScenario;
        steadySequence += 1;
        if (scenario === "health") {
          record(
            await jsonRequest({
              origin,
              scenario,
              pathname: "/api/v1/health/live",
              timeoutMs,
              validate: (payload) => {
                const data = dataObject(payload);
                return data?.status === "ok" && data.service === "q-academy-api";
              },
            }),
          );
        } else if (scenario === "course-list") {
          record(
            await htmlRequest({
              origin,
              scenario,
              pathname: "/academy/courses",
              timeoutMs,
              cookie: sessions.memberCookie as string,
            }),
          );
        } else if (scenario === "course-read") {
          record(
            await htmlRequest({
              origin,
              scenario,
              pathname: memberCoursePath as string,
              timeoutMs,
              cookie: sessions.memberCookie as string,
            }),
          );
        } else if (scenario === "admin") {
          record(
            await htmlRequest({
              origin,
              scenario,
              pathname: "/admin",
              timeoutMs,
              cookie: sessions.adminCookie as string,
            }),
          );
        } else if (scenario === "api") {
          record(
            await jsonRequest({
              origin,
              scenario,
              pathname: "/api/v1/courses?limit=1",
              timeoutMs,
              init: { headers: { Authorization: `Bearer ${apiKey}` } },
              validate: (payload) => {
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
                const value = payload as { data?: unknown; meta?: unknown };
                return Boolean(
                  Array.isArray(value.data) &&
                    value.meta &&
                    typeof value.meta === "object" &&
                    "pagination" in value.meta,
                );
              },
            }),
          );
        } else if (scenario === "progress") {
          record(
            await jsonRequest({
              origin,
              scenario,
              pathname: `/api/v1/members/${progressMemberId}/progress/${progressLessonId}`,
              timeoutMs,
              init: { headers: { Authorization: `Bearer ${apiKey}` } },
              validate: (payload) => {
                const data = dataObject(payload);
                return Boolean(
                  data &&
                    ["not_started", "in_progress", "completed"].includes(
                      String(data.status),
                    ) &&
                    typeof data.percent === "number",
                );
              },
            }),
          );
        }
      }
    }),
  );

  const endedAt = new Date();
  const summary = summarizeLoadTestSamples(samples, performance.now() - started);
  const thresholds = { maxP95Ms, maxErrorRate, minRequests };
  const evaluation = evaluateLoadTest(
    summary,
    thresholds,
    resolution.selected,
  );
  const report = createLoadTestEvidence({
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    origin,
    vus,
    durationSeconds,
    maxRequests,
    timeoutMs,
    requireAll,
    resolution,
    jobEnabled: selected.has("job"),
    thresholds,
    summary,
    evaluation,
  });
  writeEvidence(option("--output"), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!evaluation.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Load test failed."}\n`,
  );
  process.exitCode = 1;
});
