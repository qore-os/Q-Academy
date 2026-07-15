export type HttpSloSample = {
  path: string;
  latencyMs: number;
  ok: boolean;
  status: number | null;
};

export type HttpSloThresholds = {
  maxErrorRate: number;
  maxP95Ms: number;
  minRequests: number;
};

function percentile(sorted: readonly number[], quantile: number) {
  if (!sorted.length) return null;
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index] ?? null;
}

export function summarizeHttpSloSamples(
  samples: readonly HttpSloSample[],
  elapsedMs: number,
) {
  const latencies = samples
    .map((sample) => sample.latencyMs)
    .sort((left, right) => left - right);
  const failed = samples.filter((sample) => !sample.ok).length;
  const statusCounts: Record<string, number> = {};
  for (const sample of samples) {
    const key = sample.status === null ? "network_error" : String(sample.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  const byPath = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.path))].sort().map((path) => {
      const pathSamples = samples.filter((sample) => sample.path === path);
      const pathLatencies = pathSamples
        .map((sample) => sample.latencyMs)
        .sort((left, right) => left - right);
      const pathFailed = pathSamples.filter((sample) => !sample.ok).length;
      return [
        path,
        {
          requests: pathSamples.length,
          failed: pathFailed,
          errorRate: pathSamples.length ? pathFailed / pathSamples.length : 0,
          p50Ms: percentile(pathLatencies, 0.5),
          p95Ms: percentile(pathLatencies, 0.95),
          p99Ms: percentile(pathLatencies, 0.99),
          maxMs: pathLatencies.at(-1) ?? null,
        },
      ];
    }),
  );
  return {
    elapsedMs,
    requests: samples.length,
    failed,
    errorRate: samples.length ? failed / samples.length : 0,
    requestsPerSecond: elapsedMs > 0 ? samples.length / (elapsedMs / 1_000) : 0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.at(-1) ?? null,
    statusCounts,
    byPath,
  };
}

export function evaluateHttpSlo(
  summary: ReturnType<typeof summarizeHttpSloSamples>,
  thresholds: HttpSloThresholds,
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
  return { passed: failures.length === 0, failures };
}
