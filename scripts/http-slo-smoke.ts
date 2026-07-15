import { readFileSync } from "node:fs";
import {
  evaluateHttpSlo,
  summarizeHttpSloSamples,
  type HttpSloSample,
} from "../src/lib/operations/http-slo";
import { validateHttpSloCliArguments } from "../src/lib/operations/http-slo-cli";

const SAFE_PATHS = new Set([
  "/api/v1/health/live",
  "/api/v1/health/ready",
]);
const API_PROBE_PATH = "/api/v1/courses?limit=1";
const PRODUCTION_API_KEY_FILE = "/run/secrets/http_slo_api_key";
const MAX_SAMPLES = 250_000;

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberOption(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
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

function apiProbeKey(enabled: boolean) {
  if (!enabled) return undefined;
  const file = process.env.HTTP_SLO_API_KEY_FILE;
  if (!file) {
    throw new Error(
      "HTTP_SLO_API_KEY_FILE is required when --api-probe is true.",
    );
  }
  if (process.env.NODE_ENV === "production" && file !== PRODUCTION_API_KEY_FILE) {
    throw new Error(
      `Production API probes must use ${PRODUCTION_API_KEY_FILE}.`,
    );
  }
  const key = readFileSync(file, "utf8").trim();
  if (key.length < 32 || key.length > 512 || /\s/.test(key)) {
    throw new Error("The HTTP SLO API key file is malformed.");
  }
  return key;
}

function normalizedOrigin(raw: string | undefined, label: string) {
  if (!raw) throw new Error(`${label} is required.`);
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an origin without credentials or a path.`);
  }
  return parsed.origin;
}

function requestedPaths() {
  const paths: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--path") {
      const path = process.argv[index + 1];
      if (!path || !SAFE_PATHS.has(path)) {
        throw new Error(
          `--path must be one of ${[...SAFE_PATHS].join(", ")}.`,
        );
      }
      paths.push(path);
    }
  }
  return [...new Set(paths.length ? paths : [...SAFE_PATHS])];
}

function validPayload(path: string, payload: unknown, requestId: string | null) {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return false;
  const data = (payload as { data?: unknown }).data;
  const meta = (payload as { meta?: unknown }).meta;
  if (
    !requestId ||
    meta === null ||
    typeof meta !== "object" ||
    !("requestId" in meta) ||
    meta.requestId !== requestId
  ) {
    return false;
  }
  if (path === API_PROBE_PATH) {
    return (
      Array.isArray(data) &&
      "pagination" in meta
    );
  }
  if (!data || typeof data !== "object" || !("status" in data)) return false;
  const status = (data as { status?: unknown }).status;
  return path.endsWith("/live") ? status === "ok" : status === "ready";
}

async function requestSample(
  origin: string,
  path: string,
  timeoutMs: number,
  apiKey?: string,
): Promise<HttpSloSample> {
  const started = performance.now();
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "q-academy-http-slo-smoke/1.0",
    };
    if (path === API_PROBE_PATH && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(new URL(path, origin), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    const payload = await response.json().catch(() => null);
    const requestId = response.headers.get("x-request-id");
    return {
      path,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      ok:
        response.ok &&
        validPayload(path, payload, requestId),
      status: response.status,
    };
  } catch {
    return {
      path,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      ok: false,
      status: null,
    };
  }
}

async function main() {
  validateHttpSloCliArguments(process.argv.slice(2));
  const origin = normalizedOrigin(option("--origin"), "--origin");
  const confirmation = normalizedOrigin(
    option("--confirm-origin"),
    "--confirm-origin",
  );
  if (origin !== confirmation) {
    throw new Error("--confirm-origin must exactly match --origin.");
  }
  const durationSeconds = numberOption("--duration-seconds", 30, 1, 300);
  const concurrency = Math.trunc(numberOption("--concurrency", 8, 1, 64));
  const timeoutMs = Math.trunc(numberOption("--timeout-ms", 5_000, 100, 30_000));
  const maxP95Ms = numberOption("--max-p95-ms", 500, 1, 60_000);
  const maxErrorRate = numberOption("--max-error-rate", 0, 0, 1);
  const minRequests = Math.trunc(numberOption("--min-requests", 20, 1, MAX_SAMPLES));
  const includeApiProbe = booleanOption("--api-probe", false);
  const apiKey = apiProbeKey(includeApiProbe);
  const paths = requestedPaths();

  for (const path of paths) {
    const warmup = await requestSample(origin, path, timeoutMs);
    if (!warmup.ok) {
      throw new Error(`Warmup failed for ${path} with ${warmup.status ?? "network error"}.`);
    }
  }

  const authenticatedProbe = includeApiProbe
    ? await requestSample(origin, API_PROBE_PATH, timeoutMs, apiKey)
    : null;
  if (authenticatedProbe && !authenticatedProbe.ok) {
    throw new Error(
      `Authenticated API probe failed with ${authenticatedProbe.status ?? "network error"}.`,
    );
  }

  const samples: HttpSloSample[] = [];
  const started = performance.now();
  const deadline = started + durationSeconds * 1_000;
  let sequence = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline && samples.length < MAX_SAMPLES) {
        const path = paths[sequence % paths.length] as string;
        sequence += 1;
        samples.push(await requestSample(origin, path, timeoutMs));
      }
    }),
  );
  const summary = summarizeHttpSloSamples(samples, performance.now() - started);
  const evaluation = evaluateHttpSlo(summary, {
    maxErrorRate,
    maxP95Ms,
    minRequests,
  });
  const report = {
    origin,
    paths,
    concurrency,
    durationSeconds,
    authenticatedProbe,
    thresholds: { maxP95Ms, maxErrorRate, minRequests },
    summary,
    evaluation,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!evaluation.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "HTTP SLO smoke failed."}\n`,
  );
  process.exitCode = 1;
});
