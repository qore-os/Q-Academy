import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { authorizeInternalMetricsRequest } from "@/lib/internal-job-auth";
import { readJobQueueMetrics } from "@/lib/job-queue-metrics";
import { readMediaScanBacklogMetrics } from "@/lib/media/scan-worker";
import { readMediaProcessingBacklogMetrics } from "@/lib/media/processing-worker";
import {
  configuredTranscriptionProviderId,
  OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
  OPENAI_TRANSCRIPTION_RESULT_PROVIDER,
  TRANSCRIPT_PROCESSING_PROVIDER,
} from "@/lib/media/transcription-contract";
import { readClamAvSignatureStatusFromEnvironment } from "@/lib/media/clamav-signature-status";
import {
  readOperationalWorkerSuccess,
  type OperationalWorker,
} from "@/lib/operational-heartbeats";
import { readOperationalAggregateMetrics } from "@/lib/operational-aggregate-metrics";
import {
  renderPrometheusExposition,
  type PrometheusSample,
} from "@/lib/prometheus-exposition";
import {
  assertRuntimeServerEnvironment,
  getMetricsSecret,
  getRuntimeRole,
} from "@/lib/server-environment";
import { assertCurrentDatabaseSchema } from "@/lib/schema-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const runtimeStartedAtSeconds = Math.floor(Date.now() / 1_000);

function queueSamples(
  queue: string,
  metrics: { depth: number; failed: number; oldestAgeSeconds: number },
): PrometheusSample[] {
  const labels = { queue };
  return [
    {
      name: "q_academy_queue_depth",
      help: "Current number of queued Q-Academy jobs.",
      type: "gauge",
      labels,
      value: metrics.depth,
    },
    {
      name: "q_academy_queue_failed",
      help: "Current number of failed Q-Academy jobs.",
      type: "gauge",
      labels,
      value: metrics.failed,
    },
    {
      name: "q_academy_queue_oldest_age_seconds",
      help: "Age of the oldest queued Q-Academy job in seconds.",
      type: "gauge",
      labels,
      value: metrics.oldestAgeSeconds,
    },
  ];
}

function unauthorized(requestId: string) {
  return Response.json(
    {
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Ungueltiges Monitoring-Geheimnis.",
      requestId,
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
        "X-Request-Id": requestId,
      },
    },
  );
}

export async function GET(request: Request) {
  const requestId = randomUUID();
  if (!getMetricsSecret() || !authorizeInternalMetricsRequest(request)) {
    return unauthorized(requestId);
  }

  const runtimeRole = getRuntimeRole();
  const now = new Date();
  const samples: PrometheusSample[] = [
    {
      name: "q_academy_runtime_start_time_seconds",
      help: "Unix timestamp when the observed Q-Academy runtime started.",
      type: "gauge",
      labels: { runtime: runtimeRole },
      value: runtimeStartedAtSeconds,
    },
  ];
  let ready = 0;

  try {
    assertRuntimeServerEnvironment();
    if (runtimeRole === "app") {
      await assertCurrentDatabaseSchema();
      const [queues, aggregates] = await Promise.all([
        readJobQueueMetrics(now),
        readOperationalAggregateMetrics(now),
      ]);
      samples.push(
        ...queueSamples("email", queues.email),
        ...queueSamples("webhook", queues.webhooks),
        ...queueSamples("push", queues.push),
        ...queueSamples("native_push", queues.nativePush),
        ...queueSamples("exam_deadline", queues.examDeadlines),
        {
          name: "q_academy_api_requests_5m",
          help: "Authenticated API requests observed during the last five minutes.",
          type: "gauge",
          value: aggregates.apiRequests5m,
        },
        {
          name: "q_academy_api_errors_5m",
          help: "Authenticated API responses with a 5xx status during the last five minutes.",
          type: "gauge",
          value: aggregates.apiErrors5m,
        },
        {
          name: "q_academy_api_duration_p95_ms_5m",
          help: "P95 authenticated API response duration in milliseconds during the last five minutes.",
          type: "gauge",
          value: aggregates.apiDurationP95Ms5m,
        },
        {
          name: "q_academy_database_connections",
          help: "Current PostgreSQL connections to the Q-Academy database.",
          type: "gauge",
          value: aggregates.databaseConnections,
        },
        {
          name: "q_academy_auth_failed_attempts_active",
          help: "Aggregate login attempts in active failed-login rate-limit buckets.",
          type: "gauge",
          value: aggregates.activeLoginFailureAttempts,
        },
        {
          name: "q_academy_ai_messages_5m",
          help: "AI assistant messages persisted during the last five minutes.",
          type: "gauge",
          value: aggregates.aiMessages5m,
        },
        {
          name: "q_academy_ai_input_tokens_5m",
          help: "AI input tokens persisted during the last five minutes.",
          type: "gauge",
          value: aggregates.aiInputTokens5m,
        },
        {
          name: "q_academy_ai_output_tokens_5m",
          help: "AI output tokens persisted during the last five minutes.",
          type: "gauge",
          value: aggregates.aiOutputTokens5m,
        },
        {
          name: "q_academy_ai_latency_p95_ms_5m",
          help: "P95 AI provider latency in milliseconds during the last five minutes.",
          type: "gauge",
          value: aggregates.aiLatencyP95Ms5m,
        },
      );
    } else {
      await db.execute(sql`select 1`);
      const [backlog, processingBacklog] = await Promise.all([
        readMediaScanBacklogMetrics(now),
        readMediaProcessingBacklogMetrics(now),
      ]);
      const signatureStatus =
        await readClamAvSignatureStatusFromEnvironment(process.env, now);
      const transcriptProvider = configuredTranscriptionProviderId(process.env);
      const bundledOpenAi =
        transcriptProvider === OPENAI_TRANSCRIPTION_RESULT_PROVIDER;
      samples.push(
        ...queueSamples("media_scan", backlog),
        ...queueSamples("media_processing", processingBacklog),
        {
          name: "q_academy_media_transcription_contract_info",
          help: "Active Q-Academy media transcription contract.",
          type: "gauge",
          labels: {
            job_contract: TRANSCRIPT_PROCESSING_PROVIDER,
            provider: transcriptProvider,
            model: bundledOpenAi ? OPENAI_TRANSCRIPTION_MODEL : "none",
            response_format: bundledOpenAi
              ? OPENAI_TRANSCRIPTION_RESPONSE_FORMAT
              : "none",
          },
          value: 1,
        },
        {
          name: "q_academy_clamav_signature_timestamp_seconds",
          help: "Unix timestamp of the newest ClamAV daily signature database.",
          type: "gauge",
          value: signatureStatus.timestampSeconds,
        },
        {
          name: "q_academy_clamav_signature_age_seconds",
          help: "Age of the newest ClamAV daily signature database in seconds.",
          type: "gauge",
          value: signatureStatus.ageSeconds,
        },
        {
          name: "q_academy_clamav_signature_current",
          help: "Whether the ClamAV daily signature database satisfies the age gate.",
          type: "gauge",
          value: signatureStatus.current ? 1 : 0,
        },
      );
    }
    ready = 1;
  } catch {
    ready = 0;
  }

  samples.push({
    name: "q_academy_runtime_ready",
    help: "Whether the Q-Academy runtime and its database are ready.",
    type: "gauge",
    labels: { runtime: runtimeRole },
    value: ready,
  });

  const workers: OperationalWorker[] =
    runtimeRole === "app"
      ? ["scheduler"]
      : ["media-scan", "media-maintenance"];
  for (const worker of workers) {
    const timestamp = await readOperationalWorkerSuccess(worker, now);
    samples.push({
      name: "q_academy_worker_last_success_timestamp_seconds",
      help: "Unix timestamp of the latest successful worker dispatch.",
      type: "gauge",
      labels: { worker },
      value: timestamp,
    });
  }

  return new Response(renderPrometheusExposition(samples), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}
