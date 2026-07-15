import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(
  new URL("../compose.production.yml", import.meta.url),
  "utf8",
);
const prometheus = readFileSync(
  new URL("../deploy/observability/prometheus.yml", import.meta.url),
  "utf8",
);
const alerts = readFileSync(
  new URL("../deploy/observability/alerts.yml", import.meta.url),
  "utf8",
);
const backup = readFileSync(
  new URL("../scripts/ops/postgres-backup.sh", import.meta.url),
  "utf8",
);
const metricsRoute = readFileSync(
  new URL("../src/app/api/internal/metrics/route.ts", import.meta.url),
  "utf8",
);
const continuousIntegration = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const productionEnvironmentExample = readFileSync(
  new URL("../deploy/.env.production.example", import.meta.url),
  "utf8",
);

function serviceBlock(serviceName: string) {
  const escapedName = serviceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`^  ${escapedName}:[^\\r\\n]*$`, "m").exec(compose);
  assert.ok(start?.index !== undefined, `Missing ${serviceName} service`);
  const remaining = compose.slice(start.index + start[0].length);
  const nextService = remaining.search(
    /\r?\n  [a-z0-9][a-z0-9-]*:[^\r\n]*\r?\n/m,
  );
  return compose.slice(
    start.index,
    nextService === -1
      ? compose.length
      : start.index + start[0].length + nextService,
  );
}

test("monitoring profile is isolated and keeps Prometheus on loopback", () => {
  const app = serviceBlock("app");
  const mediaRunner = serviceBlock("media-runner");
  const prometheusService = serviceBlock("prometheus");
  const nodeExporter = serviceBlock("node-exporter");

  assert.match(prometheusService, /profiles: \["monitoring"\]/);
  assert.match(nodeExporter, /profiles: \["monitoring"\]/);
  assert.match(prometheusService, /image: \$\{PROMETHEUS_IMAGE:\?/);
  assert.match(nodeExporter, /image: \$\{NODE_EXPORTER_IMAGE:\?/);
  assert.match(prometheusService, /\/bin\/promtool.*check.*ready/);
  assert.match(prometheusService, /127\.0\.0\.1:\$\{PROMETHEUS_PORT:-9090}:9090/);
  assert.match(prometheusService, /app_metrics_token:ro/);
  assert.match(prometheusService, /media_metrics_token:ro/);
  assert.match(app, /METRICS_SECRET: \$\{METRICS_SECRET:/);
  assert.match(mediaRunner, /METRICS_SECRET: \$\{MEDIA_METRICS_SECRET:/);
  assert.match(nodeExporter, /collector\.textfile\.directory/);
  assert.doesNotMatch(nodeExporter, /ports:/);
  assert.doesNotMatch(app, /^      - observability$/m);
  assert.doesNotMatch(mediaRunner, /^      - observability$/m);
  assert.match(prometheusService, /^      - proxy$/m);
  assert.match(prometheusService, /^      - jobs$/m);
  assert.match(prometheusService, /^      - observability$/m);
  assert.match(compose, /^  observability:\s+driver: bridge\s+internal: true$/m);
  assert.match(productionEnvironmentExample, /^PROMETHEUS_PORT=9090$/m);
  assert.match(productionEnvironmentExample, /^PROMETHEUS_RETENTION=30d$/m);
  assert.match(
    productionEnvironmentExample,
    /^PROMETHEUS_APP_BEARER_TOKEN_FILE=\/etc\/q-academy\/prometheus-app-token$/m,
  );
  assert.match(
    productionEnvironmentExample,
    /^BACKUP_METRICS_DIR=\/var\/lib\/q-academy-observability$/m,
  );
});

test("Prometheus scrapes authenticated aggregate metrics and evaluates alerts", () => {
  assert.match(prometheus, /job_name: q-academy-app/);
  assert.match(prometheus, /job_name: q-academy-media-runner/);
  assert.equal(
    prometheus.match(/metrics_path: \/api\/internal\/metrics/g)?.length,
    2,
  );
  assert.equal(prometheus.match(/credentials_file:/g)?.length, 2);
  assert.match(prometheus, /node-exporter:9100/);

  for (const alert of [
    "QAcademyRuntimeNotReady",
    "QAcademySchedulerHeartbeatStale",
    "QAcademyMediaScanHeartbeatStale",
    "QAcademyClamAvSignatureMetricsMissing",
    "QAcademyClamAvUpdaterStalled",
    "QAcademyClamAvSignaturesStale",
    "QAcademyQueueBacklogHigh",
    "QAcademyQueueOldestJobStale",
    "QAcademyBackupMetricsMissing",
    "QAcademyBackupStale",
    "QAcademyBackupUnverified",
    "QAcademyBackupLastRunFailed",
    "QAcademyApiErrorRateHigh",
    "QAcademyApiLatencyHigh",
    "QAcademyDatabaseConnectionsHigh",
    "QAcademyLoginFailuresHigh",
    "QAcademyAiLatencyHigh",
  ]) {
    assert.match(alerts, new RegExp(`alert: ${alert}`));
  }
  assert.match(alerts, /absent\(q_academy_backup_last_success_timestamp_seconds\)/);
  assert.match(alerts, /q_academy_queue_failed > 0/);
  assert.match(alerts, /q_academy_clamav_signature_age_seconds > 108000/);
  assert.match(alerts, /q_academy_clamav_signature_current == 0/);
  assert.match(
    alerts,
    /q_academy_queue_depth\{queue=~"email\|webhook\|push\|native_push"\} > 500/,
  );
  assert.match(
    alerts,
    /q_academy_queue_oldest_age_seconds\{queue=~"email\|webhook\|push\|native_push"\} > 900/,
  );
  assert.match(
    continuousIntegration,
    /prom\/prometheus:v3\.13\.1@sha256:[a-f0-9]{64}/,
  );
  assert.match(continuousIntegration, /check rules \/etc\/prometheus\/alerts\.yml/);
  assert.match(continuousIntegration, /check config \/etc\/prometheus\/prometheus\.yml/);
});

test("metrics route fails closed and exports only fixed aggregate dimensions", () => {
  assert.match(
    metricsRoute,
    /if \(!getMetricsSecret\(\) \|\| !authorizeInternalMetricsRequest\(request\)\)/,
  );
  assert.match(metricsRoute, /text\/plain; version=0\.0\.4/);
  assert.match(metricsRoute, /q_academy_runtime_ready/);
  assert.match(metricsRoute, /q_academy_worker_last_success_timestamp_seconds/);
  assert.match(metricsRoute, /queueSamples\("email"/);
  assert.match(metricsRoute, /queueSamples\("push"/);
  assert.match(metricsRoute, /queueSamples\("native_push"/);
  assert.match(metricsRoute, /queueSamples\("media_scan"/);
  assert.match(metricsRoute, /q_academy_clamav_signature_timestamp_seconds/);
  assert.match(metricsRoute, /q_academy_clamav_signature_age_seconds/);
  assert.match(metricsRoute, /q_academy_clamav_signature_current/);
  assert.match(metricsRoute, /q_academy_api_requests_5m/);
  assert.match(metricsRoute, /q_academy_api_errors_5m/);
  assert.match(metricsRoute, /q_academy_api_duration_p95_ms_5m/);
  assert.match(metricsRoute, /q_academy_database_connections/);
  assert.match(metricsRoute, /q_academy_auth_failed_attempts_active/);
  assert.match(metricsRoute, /q_academy_ai_messages_5m/);
  assert.match(metricsRoute, /q_academy_ai_latency_p95_ms_5m/);
  assert.doesNotMatch(metricsRoute, /content|subject|emailAddress|userId|organizationId/);
});

test("backup script publishes atomic Node Exporter textfile metrics", () => {
  assert.match(backup, /BACKUP_METRICS_FILE=.*q-academy-backup\.prom/);
  assert.match(backup, /q_academy_backup_last_run_success/);
  assert.match(backup, /q_academy_backup_last_success_timestamp_seconds/);
  assert.match(backup, /q_academy_backup_last_verified_timestamp_seconds/);
  assert.match(backup, /chmod 644 -- "\$\{temporary_metrics\}"/);
  assert.match(
    backup,
    /mv -- "\$\{temporary_metrics\}" "\$\{BACKUP_METRICS_FILE\}"/,
  );
  assert.match(backup, /write_backup_metrics \|\| printf/);
});
