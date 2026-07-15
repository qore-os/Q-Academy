#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly COMPOSE_FILE="${ROOT_DIR}/compose.production.yml"
readonly ACKNOWLEDGEMENT="STAGING_WORKER_OUTAGE"
readonly REQUEST_TIMEOUT_SECONDS=5
readonly QUEUE_GROWTH_TIMEOUT_SECONDS=240
readonly DRAIN_TIMEOUT_SECONDS=900
readonly RECOVERY_TIMEOUT_SECONDS=240
readonly COMPOSE_TIMEOUT_SECONDS=90
readonly WORKER_STOP_TIMEOUT_SECONDS=30
readonly POLL_INTERVAL_SECONDS=5

# shellcheck source=scripts/ops/drill-environment.sh
source "${ROOT_DIR}/scripts/ops/drill-environment.sh"

origin=""
confirm_origin=""
project_name=""
confirm_project_name=""
acknowledgement=""
env_file=""
validated_origin=""
validated_project_name=""
started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ended_at=""
failure_code="validation_failed"
drill_checks_passed=false
recovery_required=false
recovery_attempted=false
recovered=false
queue_increase_observed=false
drained=false
baseline_live_status=""
baseline_ready_status=""
outage_live_status=""
outage_ready_status=""
recovery_live_status=""
recovery_ready_status=""
baseline_queue_depth=""
baseline_failed_jobs=""
peak_queue_depth=""
peak_failed_jobs=""
recovery_queue_depth=""
recovery_failed_jobs=""
baseline_scheduler_replicas=""
baseline_media_worker_replicas=""
recovery_scheduler_replicas=""
recovery_media_worker_replicas=""
snapshot_depth=""
snapshot_failed=""
wait_failure_code=""
declare -a compose=()

usage() {
  cat >&2 <<'USAGE'
Usage:
  staging-worker-outage-drill.sh \
    --origin https://academy.staging.customer.tld \
    --confirm-origin https://academy.staging.customer.tld \
    --project-name q-academy-staging \
    --confirm-project-name q-academy-staging \
    --ack STAGING_WORKER_OUTAGE \
    --env-file /opt/q-academy/staging.env

Stops the scheduler and every media-worker replica in one explicitly confirmed
staging Compose project. While they are stopped, create one benign staging job
through the product UI. stdout contains exactly one JSON report; logs use
stderr. No environment value or credential is emitted.
USAGE
}

log() {
  printf '%s\n' "$1" >&2
}

fail() {
  failure_code="$1"
  printf 'Worker resilience drill failed: %s\n' "$2" >&2
  exit 1
}

require_option_value() {
  local option_name="$1"
  local option_value="${2:-}"
  if [[ -z "${option_value}" || "${option_value}" == --* ]]; then
    fail "invalid_arguments" "${option_name} requires a value."
  fi
}

set_option_once() {
  local option_name="$1"
  local current_value="$2"
  if [[ -n "${current_value}" ]]; then
    fail "invalid_arguments" "${option_name} may only be provided once."
  fi
}

json_string_or_null() {
  local value="$1"
  if [[ -z "${value}" ]]; then
    printf 'null'
  else
    printf '"%s"' "${value}"
  fi
}

json_number_or_null() {
  local value="$1"
  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    printf '%s' "${value}"
  else
    printf 'null'
  fi
}

json_status_or_null() {
  local value="$1"
  if [[ "${value}" =~ ^[1-5][0-9]{2}$ ]]; then
    printf '%s' "${value}"
  else
    printf 'null'
  fi
}

write_report() {
  local final_status="$1"
  printf '{"schemaVersion":1,"drill":"staging_worker_outage","status":"%s","failureCode":' \
    "${final_status}"
  if [[ "${final_status}" == "passed" ]]; then
    printf 'null'
  else
    json_string_or_null "${failure_code}"
  fi
  printf ',"origin":'
  json_string_or_null "${validated_origin}"
  printf ',"composeProject":'
  json_string_or_null "${validated_project_name}"
  printf ',"startedAt":"%s","endedAt":"%s"' "${started_at}" "${ended_at}"
  printf ',"checks":{"baseline":{"live":'
  json_status_or_null "${baseline_live_status}"
  printf ',"ready":'
  json_status_or_null "${baseline_ready_status}"
  printf ',"queueDepth":'
  json_number_or_null "${baseline_queue_depth}"
  printf ',"failedJobs":'
  json_number_or_null "${baseline_failed_jobs}"
  printf ',"schedulerReplicas":'
  json_number_or_null "${baseline_scheduler_replicas}"
  printf ',"mediaWorkerReplicas":'
  json_number_or_null "${baseline_media_worker_replicas}"
  printf '},"outage":{"live":'
  json_status_or_null "${outage_live_status}"
  printf ',"ready":'
  json_status_or_null "${outage_ready_status}"
  printf ',"peakQueueDepth":'
  json_number_or_null "${peak_queue_depth}"
  printf ',"failedJobs":'
  json_number_or_null "${peak_failed_jobs}"
  printf '},"recovery":{"live":'
  json_status_or_null "${recovery_live_status}"
  printf ',"ready":'
  json_status_or_null "${recovery_ready_status}"
  printf ',"queueDepth":'
  json_number_or_null "${recovery_queue_depth}"
  printf ',"failedJobs":'
  json_number_or_null "${recovery_failed_jobs}"
  printf ',"schedulerReplicas":'
  json_number_or_null "${recovery_scheduler_replicas}"
  printf ',"mediaWorkerReplicas":'
  json_number_or_null "${recovery_media_worker_replicas}"
  printf '}},"queueIncreaseObserved":%s,"drained":%s,"recoveryAttempted":%s,"recovered":%s}\n' \
    "${queue_increase_observed}" "${drained}" "${recovery_attempted}" "${recovered}"
}

run_compose_with_timeout() {
  timeout --signal=TERM --kill-after=5s "${COMPOSE_TIMEOUT_SECONDS}s" \
    "${compose[@]}" "$@"
}

run_docker_with_timeout() {
  timeout --signal=TERM --kill-after=5s "${COMPOSE_TIMEOUT_SECONDS}s" \
    "${Q_ACADEMY_DOCKER_BINARY}" --host "${Q_ACADEMY_DOCKER_ENDPOINT}" "$@"
}

probe_status() {
  local path="$1"
  local status=""
  if ! status="$(
    curl --silent --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --connect-timeout "${REQUEST_TIMEOUT_SECONDS}" \
      --max-time "${REQUEST_TIMEOUT_SECONDS}" \
      --proto '=https' \
      --tlsv1.2 \
      --request GET \
      --header 'Accept: application/json' \
      --header 'Cache-Control: no-cache' \
      --header 'User-Agent: q-academy-staging-worker-drill/1.0' \
      "${validated_origin}${path}"
  )"; then
    printf '000'
    return 0
  fi
  if [[ ! "${status}" =~ ^[1-5][0-9]{2}$ ]]; then
    printf '000'
    return 0
  fi
  printf '%s' "${status}"
}

count_nonempty_lines() {
  local value="$1"
  local line=""
  local count=0
  while IFS= read -r line; do
    [[ -n "${line}" ]] && count=$((count + 1))
  done <<<"${value}"
  printf '%s' "${count}"
}

running_replicas() {
  local service="$1"
  local container_ids=""
  if ! container_ids="$(run_compose_with_timeout ps --status running -q "${service}")"; then
    return 1
  fi
  count_nonempty_lines "${container_ids}"
}

verify_compose_container_labels() {
  local service="$1"
  local container_ids=""
  local container_id=""
  local labels=""
  if ! container_ids="$(run_compose_with_timeout ps --all -q "${service}")" ||
     [[ -z "${container_ids}" ]]; then
    return 1
  fi
  while IFS= read -r container_id; do
    [[ "${container_id}" =~ ^[a-f0-9]{12,64}$ ]] || return 1
    if ! labels="$(
      run_docker_with_timeout inspect --format \
        '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' \
        "${container_id}"
    )"; then
      return 1
    fi
    [[ "${labels}" == "${validated_project_name}|${service}" ]] || return 1
  done <<<"${container_ids}"
}

service_containers_healthy() {
  local service="$1"
  local expected_count="$2"
  local container_ids=""
  local container_id=""
  local observed_count=""
  local health=""
  if ! container_ids="$(run_compose_with_timeout ps --status running -q "${service}")"; then
    return 1
  fi
  observed_count="$(count_nonempty_lines "${container_ids}")"
  [[ "${observed_count}" == "${expected_count}" ]] || return 1
  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    if ! health="$(
      run_docker_with_timeout inspect --format \
        '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}{{else}}stopped{{end}}' \
        "${container_id}"
    )"; then
      return 1
    fi
    [[ "${health}" == "healthy" ]] || return 1
  done <<<"${container_ids}"
}

readonly METRICS_SNAPSHOT_SCRIPT='const secret=process.env.METRICS_SECRET;if(!secret)process.exit(2);fetch("http://127.0.0.1:3000/api/internal/metrics",{headers:{Authorization:"Bearer "+secret,Accept:"text/plain"}}).then(async(response)=>{if(!response.ok)process.exit(3);const body=await response.text();let depth=0;let failed=0;let depthSamples=0;let failedSamples=0;for(const line of body.split(/\r?\n/)){let match=line.match(/^q_academy_queue_depth(?:\{[^}]*\})?\s+([0-9]+)$/);if(match){depth+=Number(match[1]);depthSamples+=1;continue}match=line.match(/^q_academy_queue_failed(?:\{[^}]*\})?\s+([0-9]+)$/);if(match){failed+=Number(match[1]);failedSamples+=1}}if(depthSamples===0||failedSamples===0||!Number.isSafeInteger(depth)||!Number.isSafeInteger(failed))process.exit(4);process.stdout.write(depth+"|"+failed)}).catch(()=>process.exit(5))'

runtime_queue_snapshot() {
  local service="$1"
  local result=""
  if ! result="$(
    run_compose_with_timeout exec -T "${service}" node -e \
      "${METRICS_SNAPSHOT_SCRIPT}"
  )" || [[ ! "${result}" =~ ^[0-9]+\|[0-9]+$ ]]; then
    return 1
  fi
  printf '%s' "${result}"
}

read_queue_snapshot() {
  local app_snapshot=""
  local media_snapshot=""
  local app_depth=""
  local app_failed=""
  local media_depth=""
  local media_failed=""
  app_snapshot="$(runtime_queue_snapshot app)" || return 1
  media_snapshot="$(runtime_queue_snapshot media-runner)" || return 1
  IFS='|' read -r app_depth app_failed <<<"${app_snapshot}"
  IFS='|' read -r media_depth media_failed <<<"${media_snapshot}"
  snapshot_depth=$((app_depth + media_depth))
  snapshot_failed=$((app_failed + media_failed))
}

wait_for_worker_recovery() {
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    recovery_scheduler_replicas="$(running_replicas scheduler)" || return 1
    recovery_media_worker_replicas="$(running_replicas media-worker)" || return 1
    recovery_live_status="$(probe_status '/api/v1/health/live')"
    recovery_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${recovery_scheduler_replicas}" == "${baseline_scheduler_replicas}" &&
          "${recovery_media_worker_replicas}" == "${baseline_media_worker_replicas}" &&
          "${recovery_live_status}" == "200" &&
          "${recovery_ready_status}" == "200" ]] &&
       service_containers_healthy scheduler "${baseline_scheduler_replicas}" &&
       service_containers_healthy media-worker "${baseline_media_worker_replicas}"; then
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

recover_workers() {
  recovery_attempted=true
  log "Starting every stopped scheduler and media-worker container..."
  if ! run_compose_with_timeout start scheduler media-worker 1>&2; then
    log "The bounded Compose start command failed; recovery polling continues."
  fi
  if wait_for_worker_recovery; then
    recovered=true
    recovery_required=false
    return 0
  fi
  return 1
}

wait_for_queue_increase() {
  local deadline=$((SECONDS + QUEUE_GROWTH_TIMEOUT_SECONDS))
  wait_failure_code="queue_growth_not_observed"
  while (( SECONDS < deadline )); do
    outage_live_status="$(probe_status '/api/v1/health/live')"
    outage_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${outage_live_status}" != "200" || "${outage_ready_status}" != "200" ]]; then
      wait_failure_code="application_health_regressed"
      return 1
    fi
    if ! read_queue_snapshot; then
      wait_failure_code="queue_metrics_unavailable"
      return 1
    fi
    peak_queue_depth="${snapshot_depth}"
    peak_failed_jobs="${snapshot_failed}"
    if (( snapshot_depth > baseline_queue_depth )); then
      queue_increase_observed=true
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

wait_for_queue_drain() {
  local deadline=$((SECONDS + DRAIN_TIMEOUT_SECONDS))
  wait_failure_code="queue_drain_timeout"
  while (( SECONDS < deadline )); do
    recovery_live_status="$(probe_status '/api/v1/health/live')"
    recovery_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${recovery_live_status}" != "200" || "${recovery_ready_status}" != "200" ]]; then
      wait_failure_code="application_health_regressed"
      return 1
    fi
    if ! read_queue_snapshot; then
      wait_failure_code="queue_metrics_unavailable"
      return 1
    fi
    recovery_queue_depth="${snapshot_depth}"
    recovery_failed_jobs="${snapshot_failed}"
    if (( snapshot_depth <= baseline_queue_depth &&
          snapshot_failed <= baseline_failed_jobs )); then
      drained=true
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

finish() {
  local incoming_status=$?
  local final_status="failed"
  local final_exit_status=1
  trap - EXIT
  trap '' INT TERM HUP
  set +e

  if [[ "${recovery_required}" == "true" ]]; then
    if ! recover_workers; then
      failure_code="recovery_failed"
      log "Workers did not return to their initial running replica counts inside the hard timeout."
    fi
  fi

  if [[ "${incoming_status}" -eq 0 &&
        "${drill_checks_passed}" == "true" &&
        "${queue_increase_observed}" == "true" &&
        "${drained}" == "true" &&
        "${recovered}" == "true" ]]; then
    final_status="passed"
    final_exit_status=0
  elif [[ "${recovered}" != "true" && "${recovery_attempted}" == "true" ]]; then
    failure_code="recovery_failed"
  fi

  ended_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  write_report "${final_status}"
  exit "${final_exit_status}"
}

trap finish EXIT
trap 'failure_code="interrupted"; exit 130' INT
trap 'failure_code="terminated"; exit 143' TERM
trap 'failure_code="hangup"; exit 129' HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${origin}"
      origin="$2"
      shift 2
      ;;
    --confirm-origin)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${confirm_origin}"
      confirm_origin="$2"
      shift 2
      ;;
    --project-name)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${project_name}"
      project_name="$2"
      shift 2
      ;;
    --confirm-project-name)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${confirm_project_name}"
      confirm_project_name="$2"
      shift 2
      ;;
    --ack)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${acknowledgement}"
      acknowledgement="$2"
      shift 2
      ;;
    --env-file)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${env_file}"
      env_file="$2"
      shift 2
      ;;
    --help)
      usage
      trap - EXIT INT TERM HUP
      exit 0
      ;;
    --*)
      fail "invalid_arguments" "Unknown option: $1"
      ;;
    *)
      fail "invalid_arguments" "Positional arguments are not accepted."
      ;;
  esac
done

for required_value in \
  origin confirm_origin project_name confirm_project_name acknowledgement env_file; do
  if [[ -z "${!required_value}" ]]; then
    fail "invalid_arguments" "Missing required options; use --help for the exact invocation."
  fi
done

if [[ "${acknowledgement}" != "${ACKNOWLEDGEMENT}" ]]; then
  fail "acknowledgement_missing" "--ack must be exactly ${ACKNOWLEDGEMENT}."
fi
if ! validate_q_academy_staging_drill_target \
  "${env_file}" "${project_name}" "${confirm_project_name}" \
  "${origin}" "${confirm_origin}"; then
  fail "unsafe_staging_target" "Origin, project, or environment confirmation failed."
fi
validated_origin="${Q_ACADEMY_STAGING_ORIGIN}"
validated_project_name="${Q_ACADEMY_STAGING_PROJECT_NAME}"

for required_command in curl date docker sleep timeout; do
  command -v "${required_command}" >/dev/null 2>&1 ||
    fail "missing_prerequisite" "Required command is unavailable: ${required_command}."
done
if ! verify_q_academy_local_docker_socket; then
  fail "unsafe_docker_target" "A verified local Docker Unix socket is required."
fi

if ! build_q_academy_staging_compose_command \
  compose "${env_file}" "${project_name}" "${COMPOSE_FILE}"; then
  fail "compose_validation_failed" "A clean confirmed Compose command could not be constructed."
fi

if ! configured_services="$(run_compose_with_timeout config --services)"; then
  fail "compose_validation_failed" "The Compose model could not be rendered."
fi
for required_service in app caddy scheduler media-runner media-worker; do
  service_found=false
  while IFS= read -r configured_service; do
    [[ "${configured_service}" == "${required_service}" ]] && service_found=true
  done <<<"${configured_services}"
  if [[ "${service_found}" != "true" ]]; then
    fail "compose_validation_failed" "Required Compose service is missing: ${required_service}."
  fi
done

for verified_service in app caddy scheduler media-runner media-worker; do
  if ! verify_compose_container_labels "${verified_service}"; then
    fail "compose_identity_mismatch" "Container labels do not match the confirmed project/service: ${verified_service}."
  fi
done

baseline_scheduler_replicas="$(running_replicas scheduler)" ||
  fail "unsafe_initial_state" "The scheduler replica count could not be read."
baseline_media_worker_replicas="$(running_replicas media-worker)" ||
  fail "unsafe_initial_state" "The media-worker replica count could not be read."
if [[ "${baseline_scheduler_replicas}" != "1" ||
      "${baseline_media_worker_replicas}" != "2" ]]; then
  fail "unsafe_initial_state" "The production-shaped baseline requires one scheduler and exactly two media-worker replicas."
fi
if ! service_containers_healthy scheduler 1 ||
   ! service_containers_healthy media-worker 2; then
  fail "unhealthy_baseline" "Every scheduler and media-worker container must be healthy before the outage."
fi

for required_running_service in app caddy media-runner; do
  running_count="$(running_replicas "${required_running_service}")" ||
    fail "unsafe_initial_state" "The running state could not be read: ${required_running_service}."
  if [[ "${running_count}" != "1" ]]; then
    fail "unsafe_initial_state" "Exactly one running ${required_running_service} service is required."
  fi
done

log "Verifying healthy staging and queue baseline..."
baseline_live_status="$(probe_status '/api/v1/health/live')"
baseline_ready_status="$(probe_status '/api/v1/health/ready')"
if [[ "${baseline_live_status}" != "200" || "${baseline_ready_status}" != "200" ]]; then
  fail "unhealthy_baseline" "Both public health endpoints must return HTTP 200."
fi
if ! read_queue_snapshot; then
  fail "queue_metrics_unavailable" "Internal aggregate queue metrics could not be read without exposing their bearer secrets."
fi
baseline_queue_depth="${snapshot_depth}"
baseline_failed_jobs="${snapshot_failed}"

log "Stopping scheduler and all media-worker replicas for the confirmed staging project..."
recovery_required=true
failure_code="worker_stop_failed"
if ! run_compose_with_timeout stop --timeout "${WORKER_STOP_TIMEOUT_SECONDS}" \
  scheduler media-worker 1>&2; then
  fail "worker_stop_failed" "The bounded worker stop failed; the EXIT trap will still restart them."
fi
if [[ "$(running_replicas scheduler)" != "0" ||
      "$(running_replicas media-worker)" != "0" ]]; then
  fail "worker_stop_failed" "At least one stopped worker still appears as running."
fi

log "Workers are stopped. Create one benign email, webhook, push, exam-deadline, upload, or media-processing job in staging now."
failure_code="queue_growth_not_observed"
if ! wait_for_queue_increase; then
  fail "${wait_failure_code}" "No safe queue increase with live=ready=200 was observed inside the hard timeout."
fi

failure_code="recovery_failed"
if ! recover_workers; then
  fail "recovery_failed" "Workers did not return to their initial running replica counts."
fi

log "Workers are running again; waiting for the observed queue increase to drain..."
failure_code="queue_drain_timeout"
if ! wait_for_queue_drain; then
  fail "${wait_failure_code}" "Queue depth or failed-job count did not return to the baseline contract inside the hard timeout."
fi

drill_checks_passed=true
failure_code=""
exit 0
