export const LOAD_TEST_SCENARIOS = [
  "health",
  "login",
  "course-list",
  "course-read",
  "admin",
  "api",
  "progress",
  "job",
] as const;

export type LoadTestScenario = (typeof LOAD_TEST_SCENARIOS)[number];

export const DEFAULT_LOAD_TEST_SCENARIOS = [
  "health",
  "login",
  "course-list",
  "course-read",
  "admin",
  "api",
  "progress",
] as const satisfies readonly LoadTestScenario[];

const scenarioSet = new Set<string>(LOAD_TEST_SCENARIOS);
const stagingLabels = new Set([
  "dev",
  "development",
  "qa",
  "sandbox",
  "stage",
  "staging",
  "stg",
  "test",
  "testing",
  "preprod",
]);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LoadTestPrerequisites = {
  hasMemberCredentials: boolean;
  hasAdminCredentials: boolean;
  hasApiKey: boolean;
  hasCoursePath: boolean;
  hasProgressIds: boolean;
  hasJobSecret: boolean;
  jobMutationAcknowledged: boolean;
};

export type LoadTestScenarioResolution = {
  requested: LoadTestScenario[];
  selected: LoadTestScenario[];
  skipped: Array<{ scenario: LoadTestScenario; reason: string }>;
};

export type LoadTestSample = {
  scenario: LoadTestScenario;
  latencyMs: number;
  ok: boolean;
  status: number | null;
  failureCode?: string;
};

export type LoadTestThresholds = {
  maxErrorRate: number;
  maxP95Ms: number;
  minRequests: number;
};

const valueOptions = new Set([
  "--origin",
  "--confirm-origin",
  "--duration-seconds",
  "--vus",
  "--max-requests",
  "--timeout-ms",
  "--max-p95-ms",
  "--max-error-rate",
  "--min-requests",
  "--require",
  "--scenario",
  "--member-credentials-file",
  "--admin-credentials-file",
  "--api-key-file",
  "--member-course-path",
  "--progress-member-id",
  "--progress-lesson-id",
  "--job-secret-file",
  "--ack-mutating-job",
  "--output",
]);

export function validateLoadTestCliArguments(args: readonly string[]) {
  const repeatable = new Set(["--scenario"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${name ?? "missing"}.`);
    }
    if (!valueOptions.has(name)) {
      throw new Error(`Unknown load-test option: ${name}.`);
    }
    if (!repeatable.has(name) && seen.has(name)) {
      throw new Error(`${name} may only be provided once.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    if (name === "--scenario" && !scenarioSet.has(value)) {
      throw new Error(
        `--scenario must be one of ${LOAD_TEST_SCENARIOS.join(", ")}.`,
      );
    }
    seen.add(name);
  }
}

export function normalizeLoadTestOrigin(raw: string | undefined, label: string) {
  if (!raw) throw new Error(`${label} is required.`);
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an origin without credentials or a path.`);
  }
  return parsed.origin;
}

export function assertSafeLoadTestOrigin(origin: string) {
  const parsed = new URL(origin);
  const hostname = parsed.hostname.toLowerCase();
  if (loopbackHosts.has(hostname)) return;
  if (parsed.protocol !== "https:") {
    throw new Error("Remote load-test targets must use HTTPS.");
  }
  const labels = hostname.split(/[.-]/).filter(Boolean);
  if (!labels.some((label) => stagingLabels.has(label))) {
    throw new Error(
      "Remote load-test targets must contain an explicit staging, QA, test, dev, preprod, or sandbox hostname label.",
    );
  }
}

export function normalizeMemberCoursePath(raw: string | undefined) {
  if (!raw) return undefined;
  if (
    !/^\/academy\/courses\/[a-z0-9][a-z0-9-]*(?:\/learn\/[0-9a-f-]{36})?$/i.test(
      raw,
    )
  ) {
    throw new Error(
      "--member-course-path must be a course or lesson path below /academy/courses without a query or fragment.",
    );
  }
  return raw;
}

export function normalizeUuidOption(
  raw: string | undefined,
  label: string,
) {
  if (raw === undefined) return undefined;
  if (!uuidPattern.test(raw)) throw new Error(`${label} must be a valid UUID.`);
  return raw.toLowerCase();
}

function unavailableReason(
  scenario: LoadTestScenario,
  prerequisites: LoadTestPrerequisites,
) {
  if (scenario === "login" && !prerequisites.hasMemberCredentials && !prerequisites.hasAdminCredentials) {
    return "credentials_file_missing";
  }
  if (
    (scenario === "course-list" || scenario === "course-read") &&
    !prerequisites.hasMemberCredentials
  ) {
    return "member_credentials_file_missing";
  }
  if (scenario === "course-read" && !prerequisites.hasCoursePath) {
    return "member_course_path_missing";
  }
  if (scenario === "admin" && !prerequisites.hasAdminCredentials) {
    return "admin_credentials_file_missing";
  }
  if ((scenario === "api" || scenario === "progress") && !prerequisites.hasApiKey) {
    return "api_key_file_missing";
  }
  if (scenario === "progress" && !prerequisites.hasProgressIds) {
    return "progress_ids_missing";
  }
  if (scenario === "job" && !prerequisites.hasJobSecret) {
    return "job_secret_file_missing";
  }
  if (scenario === "job" && !prerequisites.jobMutationAcknowledged) {
    return "job_mutation_ack_missing";
  }
  return undefined;
}

export function resolveLoadTestScenarios(input: {
  requested?: readonly LoadTestScenario[];
  prerequisites: LoadTestPrerequisites;
  requireAll: boolean;
}): LoadTestScenarioResolution {
  const requested = [
    ...new Set(input.requested?.length ? input.requested : DEFAULT_LOAD_TEST_SCENARIOS),
  ];
  if (
    !requested.includes("login") &&
    requested.some((scenario) =>
      ["course-list", "course-read", "admin"].includes(scenario),
    )
  ) {
    requested.unshift("login");
  }
  const selected: LoadTestScenario[] = [];
  const skipped: LoadTestScenarioResolution["skipped"] = [];
  for (const scenario of requested) {
    const reason = unavailableReason(scenario, input.prerequisites);
    if (reason) skipped.push({ scenario, reason });
    else selected.push(scenario);
  }
  if (input.requireAll && skipped.length) {
    throw new Error(
      `Required load-test scenarios are not configured: ${skipped
        .map(({ scenario, reason }) => `${scenario} (${reason})`)
        .join(", ")}.`,
    );
  }
  if (!selected.length) {
    throw new Error("No configured load-test scenario remains to run.");
  }
  return { requested, selected, skipped };
}

function percentile(sorted: readonly number[], quantile: number) {
  if (!sorted.length) return null;
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index] ?? null;
}

function summarizeGroup(samples: readonly LoadTestSample[], elapsedMs: number) {
  const latencies = samples
    .map((sample) => sample.latencyMs)
    .sort((left, right) => left - right);
  const failed = samples.filter((sample) => !sample.ok).length;
  const statusCounts: Record<string, number> = {};
  const failureCounts: Record<string, number> = {};
  for (const sample of samples) {
    const status = sample.status === null ? "network_error" : String(sample.status);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (sample.failureCode) {
      failureCounts[sample.failureCode] =
        (failureCounts[sample.failureCode] ?? 0) + 1;
    }
  }
  return {
    requests: samples.length,
    failed,
    errorRate: samples.length ? failed / samples.length : 0,
    requestsPerSecond:
      elapsedMs > 0 ? samples.length / (elapsedMs / 1_000) : 0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.at(-1) ?? null,
    statusCounts,
    failureCounts,
  };
}

export function summarizeLoadTestSamples(
  samples: readonly LoadTestSample[],
  elapsedMs: number,
) {
  const byScenario = Object.fromEntries(
    LOAD_TEST_SCENARIOS.map((scenario) => [
      scenario,
      summarizeGroup(
        samples.filter((sample) => sample.scenario === scenario),
        elapsedMs,
      ),
    ]),
  ) as Record<LoadTestScenario, ReturnType<typeof summarizeGroup>>;
  return {
    elapsedMs,
    ...summarizeGroup(samples, elapsedMs),
    byScenario,
  };
}

export function evaluateLoadTest(
  summary: ReturnType<typeof summarizeLoadTestSamples>,
  thresholds: LoadTestThresholds,
  selected: readonly LoadTestScenario[],
) {
  const failures: string[] = [];
  if (summary.requests < thresholds.minRequests) {
    failures.push(
      `request count ${summary.requests} is below ${thresholds.minRequests}`,
    );
  }
  if (summary.errorRate > thresholds.maxErrorRate) {
    failures.push(
      `error rate ${summary.errorRate.toFixed(6)} exceeds ${thresholds.maxErrorRate.toFixed(6)}`,
    );
  }
  if (summary.p95Ms === null || summary.p95Ms > thresholds.maxP95Ms) {
    failures.push(
      `p95 ${summary.p95Ms ?? "missing"}ms exceeds ${thresholds.maxP95Ms}ms`,
    );
  }
  for (const scenario of selected) {
    const scenarioSummary = summary.byScenario[scenario];
    if (!scenarioSummary.requests) {
      failures.push(`${scenario}: no request was executed`);
      continue;
    }
    if (scenarioSummary.errorRate > thresholds.maxErrorRate) {
      failures.push(
        `${scenario}: error rate ${scenarioSummary.errorRate.toFixed(6)} exceeds ${thresholds.maxErrorRate.toFixed(6)}`,
      );
    }
    if (
      scenarioSummary.p95Ms === null ||
      scenarioSummary.p95Ms > thresholds.maxP95Ms
    ) {
      failures.push(
        `${scenario}: p95 ${scenarioSummary.p95Ms ?? "missing"}ms exceeds ${thresholds.maxP95Ms}ms`,
      );
    }
  }
  return { passed: failures.length === 0, failures };
}

export function createLoadTestEvidence(input: {
  startedAt: string;
  endedAt: string;
  origin: string;
  vus: number;
  durationSeconds: number;
  maxRequests: number;
  timeoutMs: number;
  requireAll: boolean;
  resolution: LoadTestScenarioResolution;
  jobEnabled: boolean;
  thresholds: LoadTestThresholds;
  summary: ReturnType<typeof summarizeLoadTestSamples>;
  evaluation: ReturnType<typeof evaluateLoadTest>;
}) {
  return {
    schemaVersion: 1,
    kind: "q-academy-load-test-evidence",
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    target: { origin: input.origin },
    configuration: {
      vus: input.vus,
      durationSeconds: input.durationSeconds,
      maxRequests: input.maxRequests,
      timeoutMs: input.timeoutMs,
      requireAll: input.requireAll,
      requestedScenarios: input.resolution.requested,
      selectedScenarios: input.resolution.selected,
      skippedScenarios: input.resolution.skipped,
      jobMode: input.jobEnabled ? "single-dry-run" : "disabled",
    },
    thresholds: input.thresholds,
    summary: input.summary,
    evaluation: input.evaluation,
  };
}
