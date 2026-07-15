import "server-only";

import { postgresClient } from "@/db";

export type OperationalAggregateMetrics = {
  apiRequests5m: number;
  apiErrors5m: number;
  apiDurationP95Ms5m: number;
  databaseConnections: number;
  activeLoginFailureAttempts: number;
  aiMessages5m: number;
  aiInputTokens5m: number;
  aiOutputTokens5m: number;
  aiLatencyP95Ms5m: number;
};

type AggregateRow = {
  api_requests_5m: number;
  api_errors_5m: number;
  api_duration_p95_ms_5m: number;
  database_connections: number;
  active_login_failure_attempts: number;
  ai_messages_5m: number;
  ai_input_tokens_5m: number;
  ai_output_tokens_5m: number;
  ai_latency_p95_ms_5m: number;
};

const metricNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

export async function readOperationalAggregateMetrics(
  now = new Date(),
): Promise<OperationalAggregateMetrics> {
  const windowStartsAt = new Date(now.getTime() - 5 * 60_000);
  const [row] = await postgresClient<AggregateRow[]>`
    select
      (
        select count(*)::int
        from api_audit_logs
        where created_at >= ${windowStartsAt}
      ) as api_requests_5m,
      (
        select count(*)::int
        from api_audit_logs
        where created_at >= ${windowStartsAt}
          and response_status >= 500
      ) as api_errors_5m,
      (
        select coalesce(
          percentile_cont(0.95) within group (order by duration_ms),
          0
        )::double precision
        from api_audit_logs
        where created_at >= ${windowStartsAt}
      ) as api_duration_p95_ms_5m,
      (
        select count(*)::int
        from pg_stat_activity
        where datname = current_database()
      ) as database_connections,
      (
        select coalesce(sum(attempts), 0)::double precision
        from auth_rate_limits
        where action = 'login'
          and reset_at > ${now}
      ) as active_login_failure_attempts,
      (
        select count(*)::int
        from ai_messages
        where role = 'assistant'
          and created_at >= ${windowStartsAt}
      ) as ai_messages_5m,
      (
        select coalesce(sum(input_tokens), 0)::double precision
        from ai_messages
        where role = 'assistant'
          and created_at >= ${windowStartsAt}
      ) as ai_input_tokens_5m,
      (
        select coalesce(sum(output_tokens), 0)::double precision
        from ai_messages
        where role = 'assistant'
          and created_at >= ${windowStartsAt}
      ) as ai_output_tokens_5m,
      (
        select coalesce(
          percentile_cont(0.95) within group (order by latency_ms),
          0
        )::double precision
        from ai_messages
        where role = 'assistant'
          and latency_ms is not null
          and created_at >= ${windowStartsAt}
      ) as ai_latency_p95_ms_5m
  `;

  return {
    apiRequests5m: metricNumber(row?.api_requests_5m),
    apiErrors5m: metricNumber(row?.api_errors_5m),
    apiDurationP95Ms5m: metricNumber(row?.api_duration_p95_ms_5m),
    databaseConnections: metricNumber(row?.database_connections),
    activeLoginFailureAttempts: metricNumber(
      row?.active_login_failure_attempts,
    ),
    aiMessages5m: metricNumber(row?.ai_messages_5m),
    aiInputTokens5m: metricNumber(row?.ai_input_tokens_5m),
    aiOutputTokens5m: metricNumber(row?.ai_output_tokens_5m),
    aiLatencyP95Ms5m: metricNumber(row?.ai_latency_p95_ms_5m),
  };
}
