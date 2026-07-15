#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly COMPOSE_FILE="${ROOT_DIR}/compose.production.yml"
readonly ACKNOWLEDGEMENT="STAGING_APP_REPLICA_DRAIN"
readonly REQUEST_TIMEOUT_SECONDS=8
readonly SCALE_TIMEOUT_SECONDS=300
readonly DRAIN_TIMEOUT_SECONDS=120
readonly RECOVERY_TIMEOUT_SECONDS=300
readonly COMPOSE_TIMEOUT_SECONDS=120
readonly APP_STOP_TIMEOUT_SECONDS=30
readonly POLL_INTERVAL_SECONDS=3
readonly DRAIN_SUCCESS_SAMPLES=6

# shellcheck source=scripts/ops/drill-environment.sh
source "${ROOT_DIR}/scripts/ops/drill-environment.sh"

origin=""
confirm_origin=""
project_name=""
confirm_project_name=""
acknowledgement=""
env_file=""
session_cookie_file=""
validated_origin=""
validated_project_name=""
started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ended_at=""
failure_code="validation_failed"
drill_checks_passed=false
recovery_required=false
recovery_attempted=false
recovered=false
scaled_to_two=false
first_drain_observed=false
second_drain_observed=false
session_identity_stable=false
initial_topology_restored=false
initial_app_replicas=""
scaled_app_replicas=""
recovery_app_replicas=""
baseline_live_status=""
baseline_ready_status=""
baseline_session_status=""
scaled_live_status=""
scaled_ready_status=""
scaled_session_status=""
first_drain_live_status=""
first_drain_ready_status=""
first_drain_session_status=""
first_drain_session_stable=false
second_drain_live_status=""
second_drain_ready_status=""
second_drain_session_status=""
second_drain_session_stable=false
recovery_live_status=""
recovery_ready_status=""
recovery_session_status=""
recovery_session_stable=false
baseline_session_fingerprint=""
last_session_fingerprint=""
last_session_status=""
expected_app_image=""
session_body_file=""
work_directory=""
wait_failure_code=""
declare -a compose=()
declare -a app_container_ids=()
declare -a stopped_container_ids=()

usage() {
  cat >&2 <<'USAGE'
Usage:
  staging-app-replica-drain-drill.sh \
    --origin https://academy.staging.customer.tld \
    --confirm-origin https://academy.staging.customer.tld \
    --project-name q-academy-staging \
    --confirm-project-name q-academy-staging \
    --ack STAGING_APP_REPLICA_DRAIN \
    --env-file /opt/q-academy/staging.env \
    --session-cookie-file /run/q-academy/drill-session.cookies

Temporarily scales the confirmed staging app service to exactly two replicas,
drains each replica once, and restores the original replica count. The cookie
file must be a private curl-compatible cookie jar for a disposable staging
account. stdout contains exactly one JSON report; secrets and response bodies
are never emitted.
USAGE
}

log() {
  printf '%s\n' "$1" >&2
}

fail() {
  failure_code="$1"
  printf 'App replica resilience drill failed: %s\n' "$2" >&2
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
  printf '{"schemaVersion":1,"drill":"staging_app_replica_drain","status":"%s","failureCode":' \
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
  printf ',"checks":{"baseline":{"replicas":'
  json_number_or_null "${initial_app_replicas}"
  printf ',"live":'
  json_status_or_null "${baseline_live_status}"
  printf ',"ready":'
  json_status_or_null "${baseline_ready_status}"
  printf ',"session":'
  json_status_or_null "${baseline_session_status}"
  printf '},"scaled":{"replicas":'
  json_number_or_null "${scaled_app_replicas}"
  printf ',"live":'
  json_status_or_null "${scaled_live_status}"
  printf ',"ready":'
  json_status_or_null "${scaled_ready_status}"
  printf ',"session":'
  json_status_or_null "${scaled_session_status}"
  printf '},"firstDrain":{"live":'
  json_status_or_null "${first_drain_live_status}"
  printf ',"ready":'
  json_status_or_null "${first_drain_ready_status}"
  printf ',"session":'
  json_status_or_null "${first_drain_session_status}"
  printf ',"sessionStable":%s' "${first_drain_session_stable}"
  printf '},"secondDrain":{"live":'
  json_status_or_null "${second_drain_live_status}"
  printf ',"ready":'
  json_status_or_null "${second_drain_ready_status}"
  printf ',"session":'
  json_status_or_null "${second_drain_session_status}"
  printf ',"sessionStable":%s' "${second_drain_session_stable}"
  printf '},"recovery":{"replicas":'
  json_number_or_null "${recovery_app_replicas}"
  printf ',"live":'
  json_status_or_null "${recovery_live_status}"
  printf ',"ready":'
  json_status_or_null "${recovery_ready_status}"
  printf ',"session":'
  json_status_or_null "${recovery_session_status}"
  printf ',"sessionStable":%s' "${recovery_session_stable}"
  printf '}},"scaledToTwo":%s,"firstDrainObserved":%s,"secondDrainObserved":%s' \
    "${scaled_to_two}" "${first_drain_observed}" "${second_drain_observed}"
  printf ',"sessionIdentityStable":%s,"initialTopologyRestored":%s,"recoveryAttempted":%s,"recovered":%s}\n' \
    "${session_identity_stable}" "${initial_topology_restored}" \
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
      --proto '=https' \
      --tlsv1.2 \
      --request GET \
      --header 'Accept: application/json' \
      --header 'Cache-Control: no-cache' \
      --header 'User-Agent: q-academy-staging-app-drain/1.0' \
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

probe_session() {
  local status=""
  local fingerprint=""
  : >"${session_body_file}"
  if ! status="$(
    curl --silent --show-error \
      --output "${session_body_file}" \
      --write-out '%{http_code}' \
      --connect-timeout "${REQUEST_TIMEOUT_SECONDS}" \
      --max-time "${REQUEST_TIMEOUT_SECONDS}" \
      --proto '=https' \
      --tlsv1.2 \
      --request GET \
      --cookie "${session_cookie_file}" \
      --header 'Accept: application/json' \
      --header 'Cache-Control: no-cache' \
      --header 'User-Agent: q-academy-staging-app-drain/1.0' \
      "${validated_origin}/api/v1/me"
  )"; then
    status="000"
  fi
  last_session_status="${status}"
  last_session_fingerprint=""
  if [[ "${status}" != "200" ]]; then
    return 1
  fi
  if ! fingerprint="$(
    timeout --signal=TERM --kill-after=2s 10s node -e 'try{const fs=require("node:fs");const crypto=require("node:crypto");const input=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const data=input&&input.data;if(!data||typeof data.id!=="string"||typeof data.organizationId!=="string"||typeof data.sessionId!=="string")process.exit(2);process.stdout.write(crypto.createHash("sha256").update(data.id+"\0"+data.organizationId+"\0"+data.sessionId).digest("hex"))}catch{process.exit(3)}' \
      "${session_body_file}"
  )" || [[ ! "${fingerprint}" =~ ^[a-f0-9]{64}$ ]]; then
    return 1
  fi
  last_session_fingerprint="${fingerprint}"
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

running_app_replicas() {
  local container_ids=""
  if ! container_ids="$(run_compose_with_timeout ps --status running -q app)"; then
    return 1
  fi
  count_nonempty_lines "${container_ids}"
}

verify_app_container() {
  local container_id="$1"
  local labels=""
  [[ "${container_id}" =~ ^[a-f0-9]{12,64}$ ]] || return 1
  if ! labels="$(
    run_docker_with_timeout inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' \
      "${container_id}"
  )"; then
    return 1
  fi
  [[ "${labels}" == "${validated_project_name}|app" ]]
}

container_health() {
  local container_id="$1"
  run_docker_with_timeout inspect --format \
    '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}{{else}}stopped{{end}}' \
    "${container_id}"
}

running_app_container_ids() {
  run_compose_with_timeout ps --status running -q app
}

all_running_app_replicas_healthy() {
  local expected_count="$1"
  local container_ids=""
  local container_id=""
  local observed_count=""
  local expected_image=""
  local image=""
  container_ids="$(running_app_container_ids)" || return 1
  observed_count="$(count_nonempty_lines "${container_ids}")"
  [[ "${observed_count}" == "${expected_count}" ]] || return 1
  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    verify_app_container "${container_id}" || return 1
    [[ "$(container_health "${container_id}")" == "healthy" ]] || return 1
    image="$(
      run_docker_with_timeout inspect --format '{{.Image}}' "${container_id}"
    )" || return 1
    [[ "${image}" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
    if [[ -n "${expected_app_image}" && "${image}" != "${expected_app_image}" ]]; then
      return 1
    fi
    if [[ -z "${expected_image}" ]]; then
      expected_image="${image}"
    elif [[ "${image}" != "${expected_image}" ]]; then
      return 1
    fi
  done <<<"${container_ids}"
  if [[ -z "${expected_app_image}" ]]; then
    expected_app_image="${expected_image}"
  fi
}

wait_for_scaled_contract() {
  local expected_count="$1"
  local deadline=$((SECONDS + SCALE_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if all_running_app_replicas_healthy "${expected_count}"; then
      scaled_live_status="$(probe_status '/api/v1/health/live')"
      scaled_ready_status="$(probe_status '/api/v1/health/ready')"
      if probe_session; then
        scaled_session_status="${last_session_status}"
        if [[ "${scaled_live_status}" == "200" &&
              "${scaled_ready_status}" == "200" &&
              "${last_session_fingerprint}" == "${baseline_session_fingerprint}" ]]; then
          scaled_app_replicas="${expected_count}"
          return 0
        fi
      else
        scaled_session_status="${last_session_status}"
      fi
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

wait_for_single_replica_contract() {
  local phase="$1"
  local deadline=$((SECONDS + DRAIN_TIMEOUT_SECONDS))
  local live_status=""
  local ready_status=""
  local session_status=""
  local successful_samples=0
  wait_failure_code="replica_drain_timeout"
  while (( SECONDS < deadline )); do
    if all_running_app_replicas_healthy 1; then
      live_status="$(probe_status '/api/v1/health/live')"
      ready_status="$(probe_status '/api/v1/health/ready')"
      if ! probe_session; then
        session_status="${last_session_status}"
        wait_failure_code="application_or_session_regressed"
        return 1
      fi
      session_status="${last_session_status}"
      if [[ "${live_status}" != "200" || "${ready_status}" != "200" ||
            "${last_session_fingerprint}" != "${baseline_session_fingerprint}" ]]; then
        wait_failure_code="application_or_session_regressed"
        return 1
      fi
      successful_samples=$((successful_samples + 1))
      if (( successful_samples >= DRAIN_SUCCESS_SAMPLES )); then
        if [[ "${phase}" == "first" ]]; then
          first_drain_live_status="${live_status}"
          first_drain_ready_status="${ready_status}"
          first_drain_session_status="${session_status}"
          first_drain_session_stable=true
          first_drain_observed=true
        else
          second_drain_live_status="${live_status}"
          second_drain_ready_status="${ready_status}"
          second_drain_session_status="${session_status}"
          second_drain_session_stable=true
          second_drain_observed=true
        fi
        return 0
      fi
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  if [[ "${phase}" == "first" ]]; then
    first_drain_live_status="${live_status}"
    first_drain_ready_status="${ready_status}"
    first_drain_session_status="${session_status}"
  else
    second_drain_live_status="${live_status}"
    second_drain_ready_status="${ready_status}"
    second_drain_session_status="${session_status}"
  fi
  return 1
}

start_validated_container() {
  local container_id="$1"
  verify_app_container "${container_id}" || return 1
  recovery_attempted=true
  run_docker_with_timeout start "${container_id}" >/dev/null
}

wait_for_original_topology() {
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    recovery_app_replicas="$(running_app_replicas)" || return 1
    if all_running_app_replicas_healthy "${initial_app_replicas}"; then
      recovery_live_status="$(probe_status '/api/v1/health/live')"
      recovery_ready_status="$(probe_status '/api/v1/health/ready')"
      if probe_session; then
        recovery_session_status="${last_session_status}"
        if [[ "${recovery_live_status}" == "200" &&
              "${recovery_ready_status}" == "200" &&
              "${last_session_fingerprint}" == "${baseline_session_fingerprint}" ]]; then
          recovery_session_stable=true
          session_identity_stable=true
          initial_topology_restored=true
          recovered=true
          recovery_required=false
          return 0
        fi
      else
        recovery_session_status="${last_session_status}"
      fi
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

restore_original_topology() {
  local container_id=""
  recovery_attempted=true
  for container_id in "${stopped_container_ids[@]}"; do
    if verify_app_container "${container_id}"; then
      run_docker_with_timeout start "${container_id}" >/dev/null 2>&1 || true
    fi
  done
  log "Restoring the original staging app replica count..."
  if ! run_compose_with_timeout up -d --no-deps \
    --scale "app=${initial_app_replicas}" app 1>&2; then
    log "The bounded Compose scale command failed; recovery polling continues."
  fi
  wait_for_original_topology
}

cleanup_sensitive_files() {
  if [[ -n "${session_body_file}" && -f "${session_body_file}" ]]; then
    rm -f -- "${session_body_file}"
  fi
  if [[ -n "${work_directory}" && -d "${work_directory}" ]]; then
    rmdir -- "${work_directory}" 2>/dev/null || true
  fi
}

finish() {
  local incoming_status=$?
  local final_status="failed"
  local final_exit_status=1
  trap - EXIT
  trap '' INT TERM HUP
  set +e

  if [[ "${recovery_required}" == "true" &&
        "${initial_app_replicas}" =~ ^[12]$ ]]; then
    if ! restore_original_topology; then
      failure_code="recovery_failed"
      log "The original app replica count or public session contract did not recover inside the hard timeout."
    fi
  fi
  cleanup_sensitive_files

  if [[ "${incoming_status}" -eq 0 &&
        "${drill_checks_passed}" == "true" &&
        "${first_drain_observed}" == "true" &&
        "${second_drain_observed}" == "true" &&
        "${session_identity_stable}" == "true" &&
        "${initial_topology_restored}" == "true" &&
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
  origin confirm_origin project_name confirm_project_name acknowledgement \
  env_file session_cookie_file; do
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

for required_command in curl date docker id mktemp node sleep stat timeout; do
  command -v "${required_command}" >/dev/null 2>&1 ||
    fail "missing_prerequisite" "Required command is unavailable: ${required_command}."
done
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

work_directory="$(mktemp -d "${TMPDIR:-/tmp}/q-academy-app-drain.XXXXXX")" ||
  fail "missing_prerequisite" "A private temporary directory could not be created."
session_body_file="${work_directory}/session-response.json"
: >"${session_body_file}"

if ! build_q_academy_staging_compose_command \
  compose "${env_file}" "${project_name}" "${COMPOSE_FILE}"; then
  fail "compose_validation_failed" "A clean confirmed Compose command could not be constructed."
fi

if ! configured_services="$(run_compose_with_timeout config --services)"; then
  fail "compose_validation_failed" "The Compose model could not be rendered."
fi
for required_service in app caddy postgres; do
  service_found=false
  while IFS= read -r configured_service; do
    [[ "${configured_service}" == "${required_service}" ]] && service_found=true
  done <<<"${configured_services}"
  if [[ "${service_found}" != "true" ]]; then
    fail "compose_validation_failed" "Required Compose service is missing: ${required_service}."
  fi
done

initial_app_replicas="$(running_app_replicas)" ||
  fail "unsafe_initial_state" "The running app replica count could not be read."
if [[ "${initial_app_replicas}" != "1" && "${initial_app_replicas}" != "2" ]]; then
  fail "unsafe_initial_state" "The drill requires one or two initially running app replicas."
fi
if ! all_running_app_replicas_healthy "${initial_app_replicas}"; then
  fail "unhealthy_baseline" "Every initial app replica must be healthy, project-bound, and on one image."
fi
for required_running_service in caddy postgres; do
  service_count="$(
    run_compose_with_timeout ps --status running -q "${required_running_service}"
  )" || fail "unsafe_initial_state" "The running service state could not be read: ${required_running_service}."
  if [[ "$(count_nonempty_lines "${service_count}")" != "1" ]]; then
    fail "unsafe_initial_state" "Exactly one running ${required_running_service} service is required."
  fi
done

baseline_live_status="$(probe_status '/api/v1/health/live')"
baseline_ready_status="$(probe_status '/api/v1/health/ready')"
if ! probe_session; then
  baseline_session_status="${last_session_status}"
  fail "invalid_staging_session" "The disposable staging browser session did not authenticate at /api/v1/me."
fi
baseline_session_status="${last_session_status}"
baseline_session_fingerprint="${last_session_fingerprint}"
if [[ "${baseline_live_status}" != "200" || "${baseline_ready_status}" != "200" ]]; then
  fail "unhealthy_baseline" "Public live and ready probes must both return HTTP 200."
fi

recovery_required=true
failure_code="scale_failed"
log "Scaling the confirmed staging app service to exactly two replicas..."
if ! timeout --signal=TERM --kill-after=5s "${SCALE_TIMEOUT_SECONDS}s" \
  "${compose[@]}" up -d --no-deps --scale app=2 app 1>&2; then
  fail "scale_failed" "The bounded scale-to-two command failed; the EXIT trap will restore the original count."
fi
if ! wait_for_scaled_contract 2; then
  fail "scale_failed" "Two healthy same-image app replicas with a stable public session were not observed."
fi
scaled_to_two=true

mapfile -t app_container_ids < <(running_app_container_ids)
if [[ "${#app_container_ids[@]}" -ne 2 ||
      "${app_container_ids[0]}" == "${app_container_ids[1]}" ]]; then
  fail "scale_failed" "Exactly two distinct app container IDs were not observed."
fi
for app_container_id in "${app_container_ids[@]}"; do
  verify_app_container "${app_container_id}" ||
    fail "compose_identity_mismatch" "An app container does not belong to the confirmed project."
done

failure_code="first_drain_failed"
log "Draining the first validated app replica..."
stopped_container_ids+=("${app_container_ids[0]}")
if ! run_docker_with_timeout stop --time "${APP_STOP_TIMEOUT_SECONDS}" \
  "${app_container_ids[0]}" >/dev/null; then
  fail "first_drain_failed" "The first bounded app stop failed."
fi
if ! wait_for_single_replica_contract first; then
  fail "first_drain_failed" "Public health or session continuity failed while the first replica was stopped."
fi
if ! start_validated_container "${app_container_ids[0]}" ||
   ! wait_for_scaled_contract 2; then
  fail "recovery_failed" "The first app replica did not rejoin as a healthy same-image replica."
fi

failure_code="second_drain_failed"
log "Draining the second validated app replica..."
stopped_container_ids+=("${app_container_ids[1]}")
if ! run_docker_with_timeout stop --time "${APP_STOP_TIMEOUT_SECONDS}" \
  "${app_container_ids[1]}" >/dev/null; then
  fail "second_drain_failed" "The second bounded app stop failed."
fi
if ! wait_for_single_replica_contract second; then
  fail "second_drain_failed" "Public health or session continuity failed while the second replica was stopped."
fi
if ! start_validated_container "${app_container_ids[1]}" ||
   ! wait_for_scaled_contract 2; then
  fail "recovery_failed" "The second app replica did not rejoin as a healthy same-image replica."
fi

failure_code="recovery_failed"
if ! restore_original_topology; then
  fail "recovery_failed" "The original replica count and session contract were not restored."
fi

drill_checks_passed=true
failure_code=""
exit 0
