#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly COMPOSE_FILE="${ROOT_DIR}/compose.production.yml"
readonly JSON_HELPER="${ROOT_DIR}/scripts/ops/staging-storage-drill-json.mjs"
readonly ACKNOWLEDGEMENT="STAGING_STORAGE_PIPELINE_OUTAGE"
readonly REQUEST_TIMEOUT_SECONDS=10
readonly COMPOSE_TIMEOUT_SECONDS=120
readonly DISPATCH_TIMEOUT_SECONDS=120
readonly PREFLIGHT_TIMEOUT_SECONDS=1800
readonly RECOVERY_TIMEOUT_SECONDS=360
readonly WORKER_STOP_TIMEOUT_SECONDS=30
readonly POLL_INTERVAL_SECONDS=5

# shellcheck source=scripts/ops/drill-environment.sh
source "${ROOT_DIR}/scripts/ops/drill-environment.sh"

origin=""
confirm_origin=""
project_name=""
confirm_project_name=""
bucket=""
confirm_bucket=""
acknowledgement=""
env_file=""
session_cookie_file=""
validated_origin=""
validated_project_name=""
validated_bucket=""
validated_storage_endpoint=""
started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ended_at=""
failure_code="validation_failed"
drill_checks_passed=false
recovery_required=false
recovery_attempted=false
recovered=false
network_restored=false
workers_restored=false
storage_outage_observed=false
outage_app_storage_reachable=false
retry_observed=false
asset_ready=false
download_verified=false
test_data_deletion_requested=false
provider_canary_cleanup_verified=false
workers_stopped=false
egress_disconnected=false
asset_cleanup_required=false
preflight_cleanup_required=false
baseline_live_status=""
baseline_ready_status=""
baseline_session_status=""
baseline_storage_reachable=false
baseline_queue_depth=""
baseline_failed_jobs=""
baseline_processing_queue_depth=""
baseline_processing_failed_jobs=""
baseline_media_worker_replicas=""
outage_live_status=""
outage_ready_status=""
outage_queue_depth=""
outage_failed_jobs=""
outage_processing_queue_depth=""
outage_processing_failed_jobs=""
recovery_live_status=""
recovery_ready_status=""
recovery_storage_reachable=false
recovery_queue_depth=""
recovery_failed_jobs=""
recovery_processing_queue_depth=""
recovery_processing_failed_jobs=""
recovery_media_worker_replicas=""
snapshot_depth=""
snapshot_failed=""
snapshot_processing_depth=""
snapshot_processing_failed=""
asset_id=""
asset_created=false
asset_status=""
media_runner_container_id=""
egress_network_id=""
egress_network_name=""
preflight_container_name=""
work_directory=""
session_response_file=""
create_body_file=""
create_response_file=""
upload_config_file=""
upload_error_file=""
canary_file=""
complete_response_file=""
asset_response_file=""
dispatch_response_file=""
download_file=""
download_headers_file=""
download_config_file=""
download_error_file=""
delete_response_file=""
preflight_output_file=""
declare -a compose=()
declare -a sensitive_files=()

usage() {
  cat >&2 <<'USAGE'
Usage:
  staging-storage-pipeline-outage-drill.sh \
    --origin https://academy.staging.customer.tld \
    --confirm-origin https://academy.staging.customer.tld \
    --project-name q-academy-staging \
    --confirm-project-name q-academy-staging \
    --bucket q-academy-staging-media \
    --confirm-bucket q-academy-staging-media \
    --ack STAGING_STORAGE_PIPELINE_OUTAGE \
    --env-file /opt/q-academy/staging.env \
    --session-cookie-file /run/q-academy/drill-member.cookies

The cookie jar must belong to an active disposable staging member. The drill
uploads one small unbound text asset, proves a storage retry while only the
confirmed media-runner egress is detached, restores the network and workers,
verifies the immutable download, requests deletion, and runs the destructive
media provider canary with verified cleanup. stdout is one secret-free JSON
report; operational logs use stderr.
USAGE
}

log() {
  printf '%s\n' "$1" >&2
}

fail() {
  failure_code="$1"
  printf 'Storage pipeline resilience drill failed: %s\n' "$2" >&2
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
  printf '{"schemaVersion":1,"drill":"staging_storage_pipeline_outage","status":"%s","failureCode":' \
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
  printf ',"session":'
  json_status_or_null "${baseline_session_status}"
  printf ',"storageReachable":%s,"queueDepth":' "${baseline_storage_reachable}"
  json_number_or_null "${baseline_queue_depth}"
  printf ',"failedJobs":'
  json_number_or_null "${baseline_failed_jobs}"
  printf ',"processingQueueDepth":'
  json_number_or_null "${baseline_processing_queue_depth}"
  printf ',"processingFailedJobs":'
  json_number_or_null "${baseline_processing_failed_jobs}"
  printf ',"mediaWorkerReplicas":'
  json_number_or_null "${baseline_media_worker_replicas}"
  printf '},"outage":{"live":'
  json_status_or_null "${outage_live_status}"
  printf ',"ready":'
  json_status_or_null "${outage_ready_status}"
  printf ',"runnerStorageUnreachable":%s,"appStorageReachable":%s,"retryObserved":%s,"queueDepth":' \
    "${storage_outage_observed}" "${outage_app_storage_reachable}" \
    "${retry_observed}"
  json_number_or_null "${outage_queue_depth}"
  printf ',"failedJobs":'
  json_number_or_null "${outage_failed_jobs}"
  printf ',"processingQueueDepth":'
  json_number_or_null "${outage_processing_queue_depth}"
  printf ',"processingFailedJobs":'
  json_number_or_null "${outage_processing_failed_jobs}"
  printf '},"recovery":{"live":'
  json_status_or_null "${recovery_live_status}"
  printf ',"ready":'
  json_status_or_null "${recovery_ready_status}"
  printf ',"storageReachable":%s,"assetReady":%s,"downloadVerified":%s,"queueDepth":' \
    "${recovery_storage_reachable}" "${asset_ready}" "${download_verified}"
  json_number_or_null "${recovery_queue_depth}"
  printf ',"failedJobs":'
  json_number_or_null "${recovery_failed_jobs}"
  printf ',"processingQueueDepth":'
  json_number_or_null "${recovery_processing_queue_depth}"
  printf ',"processingFailedJobs":'
  json_number_or_null "${recovery_processing_failed_jobs}"
  printf ',"mediaWorkerReplicas":'
  json_number_or_null "${recovery_media_worker_replicas}"
  printf '}},"networkRestored":%s,"workersRestored":%s' \
    "${network_restored}" "${workers_restored}"
  printf ',"testDataDeletionRequested":%s,"providerCanaryCleanupVerified":%s' \
    "${test_data_deletion_requested}" "${provider_canary_cleanup_verified}"
  printf ',"recoveryAttempted":%s,"recovered":%s}\n' \
    "${recovery_attempted}" "${recovered}"
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
      --noproxy '*' \
      --proto '=https' \
      --tlsv1.2 \
      --request GET \
      --header 'Accept: application/json' \
      --header 'Cache-Control: no-cache' \
      --header 'User-Agent: q-academy-staging-storage-drill/1.0' \
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

session_api_request() {
  local method="$1"
  local path="$2"
  local output_file="$3"
  local body_file="${4:-}"
  local status=""
  local -a request=(
    curl --silent --show-error
    --output "${output_file}"
    --write-out '%{http_code}'
    --connect-timeout "${REQUEST_TIMEOUT_SECONDS}"
    --max-time "${REQUEST_TIMEOUT_SECONDS}"
    --noproxy '*'
    --proto '=https'
    --tlsv1.2
    --request "${method}"
    --cookie "${session_cookie_file}"
    --header 'Accept: application/json'
    --header 'Cache-Control: no-cache'
    --header 'User-Agent: q-academy-staging-storage-drill/1.0'
  )
  if [[ "${method}" != "GET" ]]; then
    request+=(--header "Origin: ${validated_origin}")
  fi
  if [[ -n "${body_file}" ]]; then
    request+=(--header 'Content-Type: application/json' --data-binary "@${body_file}")
  fi
  if ! status="$("${request[@]}" "${validated_origin}${path}")"; then
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

running_container_ids() {
  local service="$1"
  run_compose_with_timeout ps --status running -q "${service}"
}

running_replicas() {
  local service="$1"
  local ids=""
  ids="$(running_container_ids "${service}")" || return 1
  count_nonempty_lines "${ids}"
}

verify_project_service_container() {
  local container_id="$1"
  local expected_service="$2"
  local labels=""
  [[ "${container_id}" =~ ^[a-f0-9]{12,64}$ ]] || return 1
  labels="$(
    run_docker_with_timeout inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' \
      "${container_id}"
  )" || return 1
  [[ "${labels}" == "${validated_project_name}|${expected_service}" ]]
}

verify_service_containers() {
  local service="$1"
  local expected_count="$2"
  local require_health="$3"
  local ids=""
  local id=""
  local count=""
  local health=""
  ids="$(running_container_ids "${service}")" || return 1
  count="$(count_nonempty_lines "${ids}")"
  [[ "${count}" == "${expected_count}" ]] || return 1
  while IFS= read -r id; do
    [[ -n "${id}" ]] || continue
    verify_project_service_container "${id}" "${service}" || return 1
    if [[ "${require_health}" == "true" ]]; then
      health="$(
        run_docker_with_timeout inspect --format \
          '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}{{else}}stopped{{end}}' \
          "${id}"
      )" || return 1
      [[ "${health}" == "healthy" ]] || return 1
    fi
  done <<<"${ids}"
}

readonly STORAGE_PROBE_SCRIPT='const expectedEndpoint=process.argv[1];const expectedBucket=process.argv[2];const raw=process.env.MEDIA_S3_ENDPOINT;let endpoint;try{endpoint=new URL(raw)}catch{process.exit(2)}if(raw!==expectedEndpoint||process.env.MEDIA_S3_BUCKET!==expectedBucket||endpoint.protocol!=="https:"||endpoint.username||endpoint.password||endpoint.pathname!=="/"||endpoint.search||endpoint.hash)process.exit(3);fetch(endpoint,{method:"HEAD",redirect:"manual",signal:AbortSignal.timeout(10000)}).then((response)=>{if(response.status<100||response.status>599)process.exit(4);process.stdout.write("reachable")}).catch(()=>process.exit(5))'

storage_endpoint_reachable() {
  local result=""
  result="$(
    run_compose_with_timeout exec -T media-runner node -e \
      "${STORAGE_PROBE_SCRIPT}" "${validated_storage_endpoint}" "${validated_bucket}"
  )" || return 1
  [[ "${result}" == "reachable" ]]
}

app_storage_endpoint_reachable() {
  local result=""
  result="$(
    run_compose_with_timeout exec -T app node -e \
      "${STORAGE_PROBE_SCRIPT}" "${validated_storage_endpoint}" "${validated_bucket}"
  )" || return 1
  [[ "${result}" == "reachable" ]]
}

readonly MEDIA_METRICS_SCRIPT='const secret=process.env.METRICS_SECRET;if(!secret)process.exit(2);fetch("http://127.0.0.1:3000/api/internal/metrics",{headers:{Authorization:"Bearer "+secret,Accept:"text/plain"},signal:AbortSignal.timeout(10000)}).then(async(response)=>{if(!response.ok)process.exit(3);const body=await response.text();const scanDepth=body.match(/^q_academy_queue_depth\{queue="media_scan"\}\s+([0-9]+)$/m);const scanFailed=body.match(/^q_academy_queue_failed\{queue="media_scan"\}\s+([0-9]+)$/m);const processingDepth=body.match(/^q_academy_queue_depth\{queue="media_processing"\}\s+([0-9]+)$/m);const processingFailed=body.match(/^q_academy_queue_failed\{queue="media_processing"\}\s+([0-9]+)$/m);if(!scanDepth||!scanFailed||!processingDepth||!processingFailed)process.exit(4);process.stdout.write(scanDepth[1]+"|"+scanFailed[1]+"|"+processingDepth[1]+"|"+processingFailed[1])}).catch(()=>process.exit(5))'

read_media_queue_snapshot() {
  local result=""
  result="$(
    run_compose_with_timeout exec -T media-runner node -e \
      "${MEDIA_METRICS_SCRIPT}"
  )" || return 1
  [[ "${result}" =~ ^[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+$ ]] || return 1
  IFS='|' read -r snapshot_depth snapshot_failed snapshot_processing_depth \
    snapshot_processing_failed <<<"${result}"
}

readonly MEDIA_DISPATCH_SCRIPT='const secret=process.env.CRON_SECRET;if(!secret)process.exit(2);fetch("http://127.0.0.1:3000/api/internal/jobs/media/dispatch?limit=1",{method:"POST",headers:{Authorization:"Bearer "+secret,Accept:"application/json"},signal:AbortSignal.timeout(110000)}).then(async(response)=>{if(!response.ok)process.exit(3);const body=await response.text();JSON.parse(body);process.stdout.write(body)}).catch(()=>process.exit(4))'

dispatch_one_media_job() {
  : >"${dispatch_response_file}"
  timeout --signal=TERM --kill-after=5s "${DISPATCH_TIMEOUT_SECONDS}s" \
    "${compose[@]}" exec -T media-runner node -e \
      "${MEDIA_DISPATCH_SCRIPT}" >"${dispatch_response_file}"
}

container_network_state() {
  local state=""
  state="$(
    run_docker_with_timeout inspect --format \
      "{{if index .NetworkSettings.Networks \"${egress_network_name}\"}}attached{{else}}detached{{end}}" \
      "${media_runner_container_id}"
  )" || return 1
  printf '%s' "${state}"
}

connect_media_runner_egress() {
  recovery_attempted=true
  if [[ "$(container_network_state)" != "attached" ]]; then
    run_docker_with_timeout network connect --alias media-runner \
      "${egress_network_id}" "${media_runner_container_id}" >/dev/null || return 1
  fi
  [[ "$(container_network_state)" == "attached" ]] || return 1
  egress_disconnected=false
  network_restored=true
}

wait_for_worker_recovery() {
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    recovery_media_worker_replicas="$(running_replicas media-worker)" || return 1
    recovery_live_status="$(probe_status '/api/v1/health/live')"
    recovery_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${recovery_media_worker_replicas}" == "${baseline_media_worker_replicas}" &&
          "${recovery_live_status}" == "200" &&
          "${recovery_ready_status}" == "200" ]] &&
       verify_service_containers media-worker "${baseline_media_worker_replicas}" true; then
      workers_stopped=false
      workers_restored=true
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

restore_media_workers() {
  recovery_attempted=true
  run_compose_with_timeout start media-worker >/dev/null 2>&1 || true
  wait_for_worker_recovery
}

read_asset_status() {
  local status=""
  local http_status=""
  : >"${asset_response_file}"
  http_status="$(
    session_api_request GET "/api/media-assets/${asset_id}" \
      "${asset_response_file}"
  )"
  [[ "${http_status}" == "200" ]] || return 1
  status="$(
    node "${JSON_HELPER}" read-asset-status \
      "${asset_response_file}" "${asset_id}" 2>/dev/null
  )" || return 1
  printf '%s' "${status}"
}

wait_for_asset_ready() {
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    recovery_live_status="$(probe_status '/api/v1/health/live')"
    recovery_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${recovery_live_status}" != "200" || "${recovery_ready_status}" != "200" ]]; then
      return 1
    fi
    asset_status="$(read_asset_status)" || return 1
    case "${asset_status}" in
      ready)
        asset_ready=true
        return 0
        ;;
      failed|quarantined|deleted)
        return 1
        ;;
    esac
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

cleanup_test_asset() {
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))
  local status=""
  while [[ "${asset_cleanup_required}" == "true" ]] &&
        (( SECONDS < deadline )); do
    : >"${delete_response_file}"
    status="$(
      session_api_request DELETE "/api/media-assets/${asset_id}" \
        "${delete_response_file}"
    )"
    if [[ "${status}" == "200" ]] &&
       node "${JSON_HELPER}" validate-asset \
         "${delete_response_file}" "${asset_id}" deleted >/dev/null 2>&1; then
      asset_cleanup_required=false
      test_data_deletion_requested=true
      return 0
    fi
    if [[ "${status}" == "404" ]]; then
      asset_cleanup_required=false
      test_data_deletion_requested=true
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  [[ "${asset_cleanup_required}" != "true" ]]
}

remove_preflight_container() {
  local container_id=""
  local labels=""
  local remaining=""
  [[ "${preflight_cleanup_required}" == "true" ]] || return 0
  container_id="$(
    run_docker_with_timeout ps --all \
      --filter "name=^/${preflight_container_name}$" --format '{{.ID}}'
  )" || return 1
  if [[ -z "${container_id}" ]]; then
    preflight_cleanup_required=false
    return 0
  fi
  [[ "$(count_nonempty_lines "${container_id}")" == "1" &&
    "${container_id}" =~ ^[a-f0-9]{12,64}$ ]] || return 1
  labels="$(
    run_docker_with_timeout inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}' \
      "${container_id}"
  )" || return 1
  [[ "${labels}" == "${validated_project_name}|media-preflight|True" ||
    "${labels}" == "${validated_project_name}|media-preflight|true" ]] || return 1
  run_docker_with_timeout rm --force "${container_id}" >/dev/null || return 1
  remaining="$(
    run_docker_with_timeout ps --all \
      --filter "name=^/${preflight_container_name}$" --format '{{.ID}}'
  )" || return 1
  [[ -z "${remaining}" ]] || return 1
  preflight_cleanup_required=false
}

run_recovery_media_preflight() {
  preflight_cleanup_required=true
  : >"${preflight_output_file}"
  if ! timeout --signal=TERM --kill-after=10s "${PREFLIGHT_TIMEOUT_SECONDS}s" \
    "${compose[@]}" --profile operations run --name "${preflight_container_name}" \
      --no-deps media-preflight --confirm-bucket "${validated_bucket}" \
      >"${preflight_output_file}" 2>&1; then
    return 1
  fi
  node "${JSON_HELPER}" validate-preflight \
    "${preflight_output_file}" >/dev/null 2>&1 || return 1
  provider_canary_cleanup_verified=true
  remove_preflight_container
}

cleanup_sensitive_files() {
  local file=""
  local cleanup_ok=true
  for file in "${sensitive_files[@]}"; do
    if [[ -n "${file}" && ( -e "${file}" || -L "${file}" ) ]]; then
      rm -f -- "${file}" || cleanup_ok=false
    fi
    if [[ -n "${file}" && ( -e "${file}" || -L "${file}" ) ]]; then
      cleanup_ok=false
    fi
  done
  if [[ -n "${work_directory}" && ( -d "${work_directory}" || -L "${work_directory}" ) ]]; then
    rmdir -- "${work_directory}" 2>/dev/null || cleanup_ok=false
  fi
  [[ -z "${work_directory}" || ! -e "${work_directory}" ]] || cleanup_ok=false
  [[ "${cleanup_ok}" == "true" ]]
}

finish() {
  local incoming_status=$?
  local final_status="failed"
  local final_exit_status=1
  local recovery_ok=true
  trap - EXIT
  trap '' INT TERM HUP
  set +e

  if [[ "${recovery_required}" == "true" ]]; then
    recovery_attempted=true
    if [[ "${egress_disconnected}" == "true" ]]; then
      connect_media_runner_egress || recovery_ok=false
    fi
    if [[ "${workers_stopped}" == "true" ]]; then
      restore_media_workers || recovery_ok=false
    fi
    if [[ "${asset_cleanup_required}" == "true" ]]; then
      cleanup_test_asset || recovery_ok=false
    fi
  fi
  if [[ "${preflight_cleanup_required}" == "true" ]]; then
    recovery_attempted=true
    remove_preflight_container || recovery_ok=false
  fi

  if [[ "${recovery_required}" == "true" &&
        -n "${media_runner_container_id}" &&
        -n "${egress_network_name}" ]]; then
    if [[ "$(container_network_state)" == "attached" ]]; then
      network_restored=true
    else
      recovery_ok=false
    fi
    if storage_endpoint_reachable && app_storage_endpoint_reachable; then
      recovery_storage_reachable=true
    else
      recovery_ok=false
    fi
  fi
  if [[ "${recovery_required}" == "true" &&
        "${baseline_media_worker_replicas}" =~ ^[0-9]+$ ]]; then
    recovery_media_worker_replicas="$(running_replicas media-worker)"
    [[ "${recovery_media_worker_replicas}" == "${baseline_media_worker_replicas}" ]] ||
      recovery_ok=false
    verify_service_containers media-worker "${baseline_media_worker_replicas}" true ||
      recovery_ok=false
  fi
  if [[ "${recovery_required}" == "true" ]]; then
    recovery_live_status="$(probe_status '/api/v1/health/live')"
    recovery_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${recovery_live_status}" != "200" ||
          "${recovery_ready_status}" != "200" ]]; then
      recovery_ok=false
    fi
    for recovery_service in app caddy postgres clamav media-runner; do
      verify_service_containers "${recovery_service}" 1 true || recovery_ok=false
    done
    if read_media_queue_snapshot; then
      recovery_queue_depth="${snapshot_depth}"
      recovery_failed_jobs="${snapshot_failed}"
      recovery_processing_queue_depth="${snapshot_processing_depth}"
      recovery_processing_failed_jobs="${snapshot_processing_failed}"
      if [[ "${recovery_queue_depth}" != "0" ||
            "${recovery_failed_jobs}" != "0" ||
            "${recovery_processing_queue_depth}" != "0" ||
            "${recovery_processing_failed_jobs}" != "0" ]]; then
        recovery_ok=false
      fi
    else
      recovery_ok=false
    fi
  fi

  if [[ "${recovery_ok}" == "true" &&
        "${network_restored}" == "true" &&
        "${workers_restored}" == "true" &&
        "${asset_cleanup_required}" != "true" ]]; then
    recovered=true
  elif [[ "${recovery_attempted}" == "true" ]]; then
    recovered=false
    failure_code="recovery_failed"
    log "The confirmed staging media topology or disposable test-data cleanup did not recover."
  fi

  if ! cleanup_sensitive_files; then
    recovery_ok=false
    recovered=false
    failure_code="evidence_cleanup_failed"
    log "Private storage-drill evidence could not be removed completely."
  fi

  if [[ "${incoming_status}" -eq 0 &&
        "${drill_checks_passed}" == "true" &&
        "${storage_outage_observed}" == "true" &&
        "${retry_observed}" == "true" &&
        "${asset_ready}" == "true" &&
        "${download_verified}" == "true" &&
        "${test_data_deletion_requested}" == "true" &&
        "${provider_canary_cleanup_verified}" == "true" &&
        "${recovered}" == "true" ]]; then
    final_status="passed"
    final_exit_status=0
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
    --bucket)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${bucket}"
      bucket="$2"
      shift 2
      ;;
    --confirm-bucket)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${confirm_bucket}"
      confirm_bucket="$2"
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
    --session-cookie-file)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${session_cookie_file}"
      session_cookie_file="$2"
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
  origin confirm_origin project_name confirm_project_name bucket confirm_bucket \
  acknowledgement env_file session_cookie_file; do
  if [[ -z "${!required_value}" ]]; then
    fail "invalid_arguments" "Missing required options; use --help for the exact invocation."
  fi
done

if [[ "${acknowledgement}" != "${ACKNOWLEDGEMENT}" ]]; then
  fail "acknowledgement_missing" "--ack must be exactly ${ACKNOWLEDGEMENT}."
fi
if ! validate_q_academy_staging_storage_drill_target \
  "${env_file}" "${project_name}" "${confirm_project_name}" \
  "${origin}" "${confirm_origin}" "${bucket}" "${confirm_bucket}"; then
  fail "unsafe_staging_target" "Origin, project, bucket, or environment confirmation failed."
fi
validated_origin="${Q_ACADEMY_STAGING_ORIGIN}"
validated_project_name="${Q_ACADEMY_STAGING_PROJECT_NAME}"
validated_bucket="${Q_ACADEMY_STAGING_MEDIA_S3_BUCKET}"
validated_storage_endpoint="${Q_ACADEMY_STAGING_MEDIA_S3_ENDPOINT}"

for required_command in curl date docker id mktemp node sha256sum sleep stat timeout; do
  command -v "${required_command}" >/dev/null 2>&1 ||
    fail "missing_prerequisite" "A required command is unavailable."
done
if [[ ! -f "${JSON_HELPER}" || -L "${JSON_HELPER}" || ! -r "${JSON_HELPER}" ]]; then
  fail "missing_prerequisite" "The private JSON evidence validator is unavailable."
fi
if ! verify_q_academy_local_docker_socket; then
  fail "unsafe_docker_target" "A verified local Docker Unix socket is required."
fi

if [[ "${session_cookie_file}" != /* || "${session_cookie_file}" == *"="* ||
      ! -f "${session_cookie_file}" || -L "${session_cookie_file}" ||
      ! -r "${session_cookie_file}" ]]; then
  fail "unsafe_session_file" "The cookie jar must be an absolute readable regular non-symlink file without '=' in its path."
fi
session_file_mode="$(stat -c '%a' -- "${session_cookie_file}")" ||
  fail "unsafe_session_file" "The cookie jar permissions could not be inspected."
session_file_owner="$(stat -c '%u' -- "${session_cookie_file}")" ||
  fail "unsafe_session_file" "The cookie jar owner could not be inspected."
session_file_size="$(stat -c '%s' -- "${session_cookie_file}")" ||
  fail "unsafe_session_file" "The cookie jar size could not be inspected."
if [[ ! "${session_file_mode}" =~ ^[0-7]{3,4}$ ]] ||
   (( (8#${session_file_mode} & 077) != 0 )) ||
   [[ "${session_file_owner}" != "$(id -u)" ]] ||
   [[ ! "${session_file_size}" =~ ^[0-9]+$ ]] ||
   (( session_file_size < 1 || session_file_size > 16384 )); then
  fail "unsafe_session_file" "The cookie jar must be owned by the operator, private, non-empty, and at most 16 KiB."
fi

temp_root="${TMPDIR:-/tmp}"
if [[ "${temp_root}" != /* || ! -d "${temp_root}" || -L "${temp_root}" ]]; then
  fail "unsafe_temporary_directory" "TMPDIR must be an absolute existing non-symlink directory."
fi
work_directory="$(mktemp -d "${temp_root}/q-academy-storage-drill.XXXXXX")" ||
  fail "missing_prerequisite" "A private temporary directory could not be created."
work_directory_mode="$(stat -c '%a' -- "${work_directory}")" ||
  fail "unsafe_temporary_directory" "The temporary directory permissions could not be inspected."
if [[ "${work_directory_mode}" != "700" ]]; then
  fail "unsafe_temporary_directory" "The temporary directory must use mode 0700."
fi

session_response_file="${work_directory}/session.json"
create_body_file="${work_directory}/create.json"
create_response_file="${work_directory}/create-response.json"
upload_config_file="${work_directory}/upload.curl"
upload_error_file="${work_directory}/upload-error.log"
canary_file="${work_directory}/q-academy-storage-drill.txt"
complete_response_file="${work_directory}/complete-response.json"
asset_response_file="${work_directory}/asset-response.json"
dispatch_response_file="${work_directory}/dispatch-response.json"
download_file="${work_directory}/downloaded-canary.txt"
download_headers_file="${work_directory}/download-headers.txt"
download_config_file="${work_directory}/download.curl"
download_error_file="${work_directory}/download-error.log"
delete_response_file="${work_directory}/delete-response.json"
preflight_output_file="${work_directory}/media-preflight.log"
sensitive_files=(
  "${session_response_file}" "${create_body_file}" "${create_response_file}"
  "${upload_config_file}" "${upload_error_file}" "${canary_file}"
  "${complete_response_file}" "${asset_response_file}"
  "${dispatch_response_file}" "${download_file}" "${download_headers_file}"
  "${download_config_file}" "${download_error_file}" "${delete_response_file}"
  "${preflight_output_file}"
)
for sensitive_file in "${sensitive_files[@]}"; do
  : >"${sensitive_file}"
done
rm -f -- "${upload_config_file}" "${download_config_file}"

if ! build_q_academy_staging_compose_command \
  compose "${env_file}" "${project_name}" "${COMPOSE_FILE}"; then
  fail "compose_validation_failed" "A clean confirmed Compose command could not be constructed."
fi

if ! configured_services="$(
  run_compose_with_timeout --profile operations config --services
)"; then
  fail "compose_validation_failed" "The Compose model could not be rendered."
fi
for required_service in app caddy postgres clamav media-runner media-worker media-preflight; do
  service_found=false
  while IFS= read -r configured_service; do
    [[ "${configured_service}" == "${required_service}" ]] && service_found=true
  done <<<"${configured_services}"
  if [[ "${service_found}" != "true" ]]; then
    fail "compose_validation_failed" "A required Compose service is missing."
  fi
done

for baseline_service in app caddy postgres clamav media-runner; do
  if ! verify_service_containers "${baseline_service}" 1 true; then
    fail "unsafe_initial_state" "Every required singleton service must be healthy and project-bound."
  fi
done
baseline_media_worker_replicas="$(running_replicas media-worker)" ||
  fail "unsafe_initial_state" "The media-worker replica count could not be read."
if [[ "${baseline_media_worker_replicas}" != "2" ]] ||
   ! verify_service_containers media-worker 2 true; then
  fail "unsafe_initial_state" "Exactly two healthy project-bound media workers are required."
fi
media_runner_container_id="$(running_container_ids media-runner)" ||
  fail "unsafe_initial_state" "The media-runner container could not be identified."
[[ "$(count_nonempty_lines "${media_runner_container_id}")" == "1" ]] ||
  fail "unsafe_initial_state" "Exactly one media-runner container is required."
verify_project_service_container "${media_runner_container_id}" media-runner ||
  fail "compose_identity_mismatch" "The media-runner does not belong to the confirmed project."

egress_network_id="$(
  run_docker_with_timeout network ls \
    --filter "label=com.docker.compose.project=${validated_project_name}" \
    --filter 'label=com.docker.compose.network=egress' \
    --format '{{.ID}}'
)" || fail "unsafe_initial_state" "The project egress network could not be identified."
if [[ "$(count_nonempty_lines "${egress_network_id}")" != "1" ||
      ! "${egress_network_id}" =~ ^[a-f0-9]{12,64}$ ]]; then
  fail "unsafe_initial_state" "Exactly one labeled project egress network is required."
fi
network_contract="$(
  run_docker_with_timeout network inspect --format \
    '{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}|{{.Driver}}|{{.Internal}}|{{.Name}}' \
    "${egress_network_id}"
)" || fail "unsafe_initial_state" "The egress network contract could not be read."
IFS='|' read -r network_project network_role network_driver network_internal \
  egress_network_name <<<"${network_contract}"
if [[ "${network_project}" != "${validated_project_name}" ||
      "${network_role}" != "egress" || "${network_driver}" != "bridge" ||
      "${network_internal}" != "false" ||
      ! "${egress_network_name}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$ ]]; then
  fail "unsafe_initial_state" "The labeled project egress network is not a safe bridge network."
fi
if [[ "$(container_network_state)" != "attached" ]]; then
  fail "unsafe_initial_state" "The media-runner is not attached to the confirmed egress network."
fi

baseline_live_status="$(probe_status '/api/v1/health/live')"
baseline_ready_status="$(probe_status '/api/v1/health/ready')"
: >"${session_response_file}"
baseline_session_status="$(
  session_api_request GET '/api/v1/me' "${session_response_file}"
)"
if [[ "${baseline_live_status}" != "200" || "${baseline_ready_status}" != "200" ||
      "${baseline_session_status}" != "200" ]] ||
   ! node "${JSON_HELPER}" validate-session \
      "${session_response_file}" >/dev/null 2>&1; then
  fail "unhealthy_baseline" "Health and a disposable active member session must be valid."
fi
if storage_endpoint_reachable && app_storage_endpoint_reachable; then
  baseline_storage_reachable=true
else
  fail "storage_unavailable" "The exact configured bucket and endpoint are not reachable from both app and media-runner."
fi
if ! read_media_queue_snapshot; then
  fail "queue_metrics_unavailable" "Media queue metrics could not be read without exposing credentials."
fi
baseline_queue_depth="${snapshot_depth}"
baseline_failed_jobs="${snapshot_failed}"
baseline_processing_queue_depth="${snapshot_processing_depth}"
baseline_processing_failed_jobs="${snapshot_processing_failed}"
if [[ "${baseline_queue_depth}" != "0" || "${baseline_failed_jobs}" != "0" ||
      "${baseline_processing_queue_depth}" != "0" ||
      "${baseline_processing_failed_jobs}" != "0" ]]; then
  fail "unsafe_initial_state" "The media scan and processing queues must both be empty and failure-free before this drill."
fi

asset_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" ||
  fail "missing_prerequisite" "A disposable asset identity could not be generated."
[[ "${asset_id}" =~ ^[0-9a-f-]{36}$ ]] ||
  fail "missing_prerequisite" "The disposable asset identity is invalid."
if ! node -e 'const {randomBytes}=require("node:crypto");process.stdout.write("Q-Academy staging storage resilience canary v1 "+randomBytes(32).toString("hex")+"\n")' \
  >"${canary_file}"; then
  fail "missing_prerequisite" "Unique disposable canary content could not be generated."
fi
canary_size="$(stat -c '%s' -- "${canary_file}")" ||
  fail "missing_prerequisite" "The canary size could not be read."
printf '{"purpose":"community","clientUploadId":"%s","originalFileName":"q-academy-storage-drill.txt","declaredMimeType":"text/plain","sizeBytes":%s}\n' \
  "${asset_id}" "${canary_size}" >"${create_body_file}"
preflight_suffix="${asset_id//-/}"
preflight_container_name="${validated_project_name}-storage-drill-${preflight_suffix:0:12}"

log "Stopping the two confirmed staging media dispatchers..."
recovery_required=true
workers_stopped=true
failure_code="worker_stop_failed"
if ! run_compose_with_timeout stop --timeout "${WORKER_STOP_TIMEOUT_SECONDS}" \
  media-worker >/dev/null; then
  fail "worker_stop_failed" "The bounded media-worker stop failed; the EXIT trap will restart it."
fi
if [[ "$(running_replicas media-worker)" != "0" ]]; then
  fail "worker_stop_failed" "At least one media-worker still appears as running."
fi

log "Detaching only the confirmed media-runner from its project egress network..."
failure_code="egress_disconnect_failed"
egress_disconnected=true
if ! run_docker_with_timeout network disconnect \
  "${egress_network_id}" "${media_runner_container_id}" >/dev/null; then
  fail "egress_disconnect_failed" "The bounded project egress disconnect failed."
fi
if [[ "$(container_network_state)" != "detached" ]]; then
  fail "egress_disconnect_failed" "The media-runner still appears on the egress network."
fi
if storage_endpoint_reachable; then
  fail "storage_outage_not_observed" "Storage remained reachable after the isolated egress detach."
fi
storage_outage_observed=true
if app_storage_endpoint_reachable; then
  outage_app_storage_reachable=true
else
  fail "storage_outage_scope_failed" "The app lost its independently bound storage path during runner isolation."
fi
outage_live_status="$(probe_status '/api/v1/health/live')"
outage_ready_status="$(probe_status '/api/v1/health/ready')"
if [[ "${outage_live_status}" != "200" || "${outage_ready_status}" != "200" ]]; then
  fail "application_health_regressed" "The public application regressed during the media storage isolation."
fi

log "Creating and uploading one unbound disposable staging member asset..."
asset_cleanup_required=true
: >"${create_response_file}"
create_status="$(
  session_api_request POST '/api/media-assets' \
    "${create_response_file}" "${create_body_file}"
)"
if [[ "${create_status}" != "201" ]]; then
  fail "test_asset_create_failed" "The disposable upload intent was not created."
fi
asset_created=true
if ! node "${JSON_HELPER}" write-upload-config \
  "${create_response_file}" "${session_response_file}" "${asset_id}" \
  "${canary_file}" \
  "${upload_config_file}" "${validated_storage_endpoint}" \
  "${validated_bucket}" >/dev/null 2>&1; then
  fail "test_asset_create_failed" "The upload authorization contract was invalid."
fi
upload_status="$(curl --config "${upload_config_file}" 2>"${upload_error_file}")" ||
  fail "test_asset_upload_failed" "The disposable object upload failed."
if [[ "${upload_status}" != "200" ]]; then
  fail "test_asset_upload_failed" "The storage provider rejected the disposable object upload."
fi
: >"${complete_response_file}"
complete_status="$(
  session_api_request POST "/api/media-assets/${asset_id}/complete" \
    "${complete_response_file}"
)"
if [[ "${complete_status}" != "200" ]] ||
   ! node "${JSON_HELPER}" validate-asset \
      "${complete_response_file}" "${asset_id}" uploaded >/dev/null 2>&1; then
  fail "test_asset_complete_failed" "The uploaded object did not enter the media scan queue."
fi

log "Dispatching the isolated asset once and requiring an explicit retry result..."
failure_code="storage_retry_not_observed"
if ! dispatch_one_media_job ||
   ! node "${JSON_HELPER}" validate-dispatch \
      "${dispatch_response_file}" retrying >/dev/null 2>&1; then
  fail "storage_retry_not_observed" "The isolated storage access did not produce the expected safe media retry."
fi
retry_observed=true
asset_status="$(read_asset_status)" ||
  fail "storage_retry_not_observed" "The disposable asset status could not be read."
if [[ "${asset_status}" != "uploaded" ]]; then
  fail "storage_retry_not_observed" "The retrying asset did not return to the durable uploaded state."
fi
if ! node "${JSON_HELPER}" validate-retry-asset \
  "${asset_response_file}" "${asset_id}" >/dev/null 2>&1; then
  fail "storage_retry_not_observed" "The canary did not record its first retry as an exact storage-unavailable failure."
fi
if ! read_media_queue_snapshot; then
  fail "queue_metrics_unavailable" "Media queue metrics were unavailable during the outage."
fi
outage_queue_depth="${snapshot_depth}"
outage_failed_jobs="${snapshot_failed}"
outage_processing_queue_depth="${snapshot_processing_depth}"
outage_processing_failed_jobs="${snapshot_processing_failed}"
if [[ "${outage_queue_depth}" != "1" || "${outage_failed_jobs}" != "0" ||
      "${outage_processing_queue_depth}" != "0" ||
      "${outage_processing_failed_jobs}" != "0" ]]; then
  fail "storage_retry_not_observed" "The outage must retain exactly one scan canary while both media queues remain failure-free and processing stays empty."
fi
outage_live_status="$(probe_status '/api/v1/health/live')"
outage_ready_status="$(probe_status '/api/v1/health/ready')"
if [[ "${outage_live_status}" != "200" || "${outage_ready_status}" != "200" ]]; then
  fail "application_health_regressed" "The public application regressed after the storage retry."
fi

log "Restoring the exact media-runner egress network and both dispatchers..."
failure_code="recovery_failed"
if ! connect_media_runner_egress; then
  fail "recovery_failed" "The confirmed media-runner egress network did not reconnect."
fi
if storage_endpoint_reachable && app_storage_endpoint_reachable; then
  recovery_storage_reachable=true
else
  fail "recovery_failed" "The storage endpoint remained unavailable after reconnect."
fi
if ! restore_media_workers; then
  fail "recovery_failed" "The original two healthy media-worker replicas did not recover."
fi

log "Waiting for the retried canary to scan and drain through the restored pipeline..."
if ! wait_for_asset_ready; then
  fail "asset_recovery_failed" "The disposable asset did not reach ready without a health regression."
fi
if ! read_media_queue_snapshot; then
  fail "queue_metrics_unavailable" "Recovered media queue metrics could not be read."
fi
recovery_queue_depth="${snapshot_depth}"
recovery_failed_jobs="${snapshot_failed}"
recovery_processing_queue_depth="${snapshot_processing_depth}"
recovery_processing_failed_jobs="${snapshot_processing_failed}"
if [[ "${recovery_queue_depth}" != "0" || "${recovery_failed_jobs}" != "0" ||
      "${recovery_processing_queue_depth}" != "0" ||
      "${recovery_processing_failed_jobs}" != "0" ]]; then
  fail "queue_drain_failed" "The media scan and processing queues did not return to the clean baseline."
fi

log "Verifying the immutable recovered download without exposing its signed URL..."
download_redirect_status="$(
  curl --silent --show-error \
    --output /dev/null \
    --dump-header "${download_headers_file}" \
    --write-out '%{http_code}' \
    --connect-timeout "${REQUEST_TIMEOUT_SECONDS}" \
    --max-time "${REQUEST_TIMEOUT_SECONDS}" \
    --noproxy '*' \
    --proto '=https' \
    --tlsv1.2 \
    --cookie "${session_cookie_file}" \
    --header 'Accept: text/plain' \
    --header 'Cache-Control: no-cache' \
    --header 'User-Agent: q-academy-staging-storage-drill/1.0' \
    "${validated_origin}/api/media-assets/${asset_id}/download"
)" || fail "download_verification_failed" "The recovered canary download failed."
if [[ "${download_redirect_status}" != "307" ]]; then
  fail "download_verification_failed" "The recovered canary did not return the private S3 download contract."
fi
: >"${download_file}"
if ! node "${JSON_HELPER}" write-download-config \
  "${download_headers_file}" "${session_response_file}" "${asset_id}" \
  "${download_config_file}" "${download_file}" \
  "${validated_storage_endpoint}" "${validated_bucket}" >/dev/null 2>&1; then
  fail "download_verification_failed" "The recovered download authorization targeted an unconfirmed storage location."
fi
download_status="$(
  curl --config "${download_config_file}" 2>"${download_error_file}"
)" || fail "download_verification_failed" "The confirmed storage download failed."
if [[ "${download_status}" != "200" ]]; then
  fail "download_verification_failed" "The recovered canary download did not return HTTP 200."
fi
read -r canary_hash _ < <(sha256sum -- "${canary_file}")
read -r download_hash _ < <(sha256sum -- "${download_file}")
if [[ ! "${canary_hash}" =~ ^[a-f0-9]{64}$ ||
      "${canary_hash}" != "${download_hash}" ]]; then
  fail "download_verification_failed" "The recovered immutable object differs from the uploaded canary."
fi
download_verified=true

log "Requesting deletion of the unbound disposable asset..."
if ! cleanup_test_asset; then
  fail "test_data_cleanup_failed" "The disposable asset deletion request did not complete."
fi

log "Running the full staging media provider canary and requiring verified cleanup..."
if ! run_recovery_media_preflight; then
  fail "provider_preflight_failed" "The restored media provider preflight or its cleanup contract failed."
fi

recovery_live_status="$(probe_status '/api/v1/health/live')"
recovery_ready_status="$(probe_status '/api/v1/health/ready')"
recovery_media_worker_replicas="$(running_replicas media-worker)" ||
  fail "recovery_failed" "The recovered media-worker count could not be read."
if [[ "${recovery_live_status}" != "200" || "${recovery_ready_status}" != "200" ||
      "${recovery_media_worker_replicas}" != "${baseline_media_worker_replicas}" ]] ||
   ! verify_service_containers media-worker "${baseline_media_worker_replicas}" true ||
   [[ "$(container_network_state)" != "attached" ]] ||
   ! storage_endpoint_reachable ||
   ! app_storage_endpoint_reachable; then
  fail "recovery_failed" "The final staging media topology did not match its healthy baseline."
fi
network_restored=true
workers_restored=true
recovered=true
recovery_required=false
drill_checks_passed=true
failure_code=""
exit 0
