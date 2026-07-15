#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly COMPOSE_FILE="${ROOT_DIR}/compose.production.yml"
readonly ACKNOWLEDGEMENT="STAGING_DATABASE_OUTAGE"
readonly REQUEST_TIMEOUT_SECONDS=5
readonly OUTAGE_TIMEOUT_SECONDS=60
readonly RECOVERY_TIMEOUT_SECONDS=240
readonly COMPOSE_TIMEOUT_SECONDS=90
readonly POSTGRES_STOP_TIMEOUT_SECONDS=30
readonly POLL_INTERVAL_SECONDS=2

origin=""
confirm_origin=""
acknowledgement=""
env_file=""
project_name=""
validated_origin=""
validated_project_name=""
started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ended_at=""
failure_code="validation_failed"
drill_checks_passed=false
recovery_required=false
recovery_attempted=false
recovered=false
baseline_live_status=""
baseline_ready_status=""
outage_live_status=""
outage_ready_status=""
recovery_live_status=""
recovery_ready_status=""
declare -a compose=()

usage() {
  cat >&2 <<'USAGE'
Usage:
  staging-database-outage-drill.sh \
    --origin https://academy.staging.example.com \
    --confirm-origin https://academy.staging.example.com \
    --ack STAGING_DATABASE_OUTAGE \
    --env-file /opt/q-academy/staging.env \
    --project-name q-academy-staging

Runs a controlled PostgreSQL outage against an explicitly named staging
Compose project. stdout contains exactly one JSON report; logs use stderr.
USAGE
}

log() {
  printf '%s\n' "$1" >&2
}

fail() {
  failure_code="$1"
  printf 'Resilience drill failed: %s\n' "$2" >&2
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
  printf '{"schemaVersion":1,"drill":"staging_database_outage","status":"%s","failureCode":' \
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
  printf '},"outage":{"live":'
  json_status_or_null "${outage_live_status}"
  printf ',"ready":'
  json_status_or_null "${outage_ready_status}"
  printf '},"recovery":{"live":'
  json_status_or_null "${recovery_live_status}"
  printf ',"ready":'
  json_status_or_null "${recovery_ready_status}"
  printf '}},"recoveryAttempted":%s,"recovered":%s}\n' \
    "${recovery_attempted}" "${recovered}"
}

run_compose_with_timeout() {
  timeout --signal=TERM --kill-after=5s "${COMPOSE_TIMEOUT_SECONDS}s" \
    "${compose[@]}" "$@"
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
      --header 'User-Agent: q-academy-staging-resilience-drill/1.0' \
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

wait_for_outage_contract() {
  local deadline=$((SECONDS + OUTAGE_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    outage_live_status="$(probe_status '/api/v1/health/live')"
    outage_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${outage_live_status}" == "200" &&
          "${outage_ready_status}" =~ ^[1-5][0-9]{2}$ &&
          "${outage_ready_status}" != "200" ]]; then
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

wait_for_recovery_contract() {
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    recovery_live_status="$(probe_status '/api/v1/health/live')"
    recovery_ready_status="$(probe_status '/api/v1/health/ready')"
    if [[ "${recovery_live_status}" == "200" &&
          "${recovery_ready_status}" == "200" ]]; then
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  return 1
}

recover_postgres() {
  local running_services_after_start=""
  local postgres_running=false
  recovery_attempted=true
  log "Starting PostgreSQL and waiting for external readiness recovery..."
  if ! run_compose_with_timeout start postgres 1>&2; then
    log "The bounded Compose start command failed; readiness polling continues."
  fi
  if wait_for_recovery_contract; then
    if ! running_services_after_start="$(
      run_compose_with_timeout ps --status running --services
    )"; then
      return 1
    fi
    while IFS= read -r running_service; do
      [[ "${running_service}" == "postgres" ]] && postgres_running=true
    done <<<"${running_services_after_start}"
    if [[ "${postgres_running}" != "true" ]]; then
      return 1
    fi
    recovered=true
    recovery_required=false
    return 0
  fi
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
    if ! recover_postgres; then
      failure_code="recovery_failed"
      log "PostgreSQL or external readiness did not recover inside the hard timeout."
    fi
  fi

  if [[ "${incoming_status}" -eq 0 &&
        "${drill_checks_passed}" == "true" &&
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
    --project-name)
      require_option_value "$1" "${2:-}"
      set_option_once "$1" "${project_name}"
      project_name="$2"
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

for required_value in origin confirm_origin acknowledgement env_file project_name; do
  if [[ -z "${!required_value}" ]]; then
    fail "invalid_arguments" "Missing required options; use --help for the exact invocation."
  fi
done

if [[ "${origin}" != "${confirm_origin}" ]]; then
  fail "origin_mismatch" "--confirm-origin must exactly match --origin."
fi
if [[ "${acknowledgement}" != "${ACKNOWLEDGEMENT}" ]]; then
  fail "acknowledgement_missing" "--ack must be exactly ${ACKNOWLEDGEMENT}."
fi
if [[ ! "${origin}" =~ ^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  fail "unsafe_origin" "--origin must be a canonical HTTPS DNS origin without credentials, port, path, query, or fragment."
fi

hostname="${origin#https://}"
if [[ "${hostname}" =~ ^[0-9.]+$ ||
      "${hostname}" == "localhost" ||
      "${hostname}" == *.localhost ||
      "${hostname}" == *.local ||
      "${hostname}" == *.internal ||
      "${hostname}" == *.invalid ||
      "${hostname}" == *.test ||
      "${hostname}" == *.example ]]; then
  fail "unsafe_origin" "Local, IP, reserved, and non-routable origins are forbidden."
fi

staging_host=false
production_host=false
IFS='.' read -r -a hostname_labels <<<"${hostname}"
for label in "${hostname_labels[@]}"; do
  case "${label}" in
    staging|stage|stg|preprod|sandbox) staging_host=true ;;
    prod|production|live) production_host=true ;;
  esac
done
if [[ "${staging_host}" != "true" || "${production_host}" == "true" ]]; then
  fail "unsafe_origin" "The origin must contain a dedicated staging label and no production label."
fi
validated_origin="${origin}"

if [[ ! "${project_name}" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ ]]; then
  fail "unsafe_project" "--project-name is not a valid explicit Compose project name."
fi
normalized_project="-${project_name//_/-}-"
if [[ "${normalized_project}" != *-staging-* &&
      "${normalized_project}" != *-stage-* &&
      "${normalized_project}" != *-stg-* &&
      "${normalized_project}" != *-preprod-* &&
      "${normalized_project}" != *-sandbox-* ]]; then
  fail "unsafe_project" "The Compose project name must contain a dedicated staging marker."
fi
if [[ "${normalized_project}" == *-prod-* ||
      "${normalized_project}" == *-production-* ||
      "${normalized_project}" == *-live-* ]]; then
  fail "unsafe_project" "Production-like Compose project names are forbidden."
fi
validated_project_name="${project_name}"

if [[ "${env_file}" != /* || ! -f "${env_file}" || -L "${env_file}" ||
      ! -r "${env_file}" ]]; then
  fail "unsafe_env_file" "--env-file must be an absolute path to a readable regular non-symlink file."
fi

env_app_domain=""
env_app_domain_seen=false
line_number=0
while IFS= read -r line || [[ -n "${line}" ]]; do
  line_number=$((line_number + 1))
  if [[ "${line}" == *$'\r'* ]]; then
    fail "unsafe_env_file" "The environment file contains unsupported carriage returns."
  fi
  [[ -z "${line}" || "${line}" == \#* ]] && continue
  [[ "${line}" == APP_DOMAIN=* ]] || continue
  if [[ "${env_app_domain_seen}" == "true" ]]; then
    fail "unsafe_env_file" "APP_DOMAIN may only occur once in the environment file."
  fi
  env_app_domain_seen=true
  env_app_domain="${line#APP_DOMAIN=}"
done <"${env_file}"
if [[ "${env_app_domain_seen}" != "true" || "${env_app_domain}" != "${hostname}" ]]; then
  fail "origin_env_mismatch" "The confirmed origin hostname must exactly match APP_DOMAIN in the environment file."
fi

for required_command in curl date docker sleep timeout; do
  command -v "${required_command}" >/dev/null 2>&1 ||
    fail "missing_prerequisite" "Required command is unavailable: ${required_command}."
done
if ! timeout --signal=TERM --kill-after=5s 20s docker compose version >/dev/null 2>&1; then
  fail "missing_prerequisite" "The Docker Compose plugin is unavailable."
fi
if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
  fail "unsafe_docker_target" "DOCKER_HOST and DOCKER_CONTEXT overrides are forbidden for this root-server drill."
fi
if ! docker_context="$(
  timeout --signal=TERM --kill-after=5s 20s docker context show
)" || [[ -z "${docker_context}" ]]; then
  fail "unsafe_docker_target" "The active Docker context could not be identified."
fi
if ! docker_endpoint="$(
  timeout --signal=TERM --kill-after=5s 20s \
    docker context inspect --format '{{.Endpoints.docker.Host}}' \
    "${docker_context}"
)" || [[ "${docker_endpoint}" != unix:///* ]]; then
  fail "unsafe_docker_target" "Only a local Unix-socket Docker context is allowed."
fi
if ! timeout --signal=TERM --kill-after=5s 20s docker info >/dev/null 2>&1; then
  fail "missing_prerequisite" "The Docker daemon is unavailable."
fi

compose=(
  docker compose
  --env-file "${env_file}"
  --project-name "${project_name}"
  -f "${COMPOSE_FILE}"
)

if ! configured_services="$(run_compose_with_timeout config --services)"; then
  fail "compose_validation_failed" "The production Compose model could not be rendered."
fi
for required_service in postgres app caddy; do
  service_found=false
  while IFS= read -r configured_service; do
    [[ "${configured_service}" == "${required_service}" ]] && service_found=true
  done <<<"${configured_services}"
  if [[ "${service_found}" != "true" ]]; then
    fail "compose_validation_failed" "The required Compose service is missing: ${required_service}."
  fi
done

if ! running_services="$(run_compose_with_timeout ps --status running --services)"; then
  fail "compose_validation_failed" "The running Compose services could not be inspected."
fi
for required_service in postgres app caddy; do
  service_running=false
  while IFS= read -r running_service; do
    [[ "${running_service}" == "${required_service}" ]] && service_running=true
  done <<<"${running_services}"
  if [[ "${service_running}" != "true" ]]; then
    fail "unsafe_initial_state" "The required Compose service is not running: ${required_service}."
  fi
done

log "Verifying healthy staging baseline before the outage..."
baseline_live_status="$(probe_status '/api/v1/health/live')"
baseline_ready_status="$(probe_status '/api/v1/health/ready')"
if [[ "${baseline_live_status}" != "200" || "${baseline_ready_status}" != "200" ]]; then
  fail "unhealthy_baseline" "Both health endpoints must return HTTP 200 before PostgreSQL is stopped."
fi

log "Stopping PostgreSQL for the confirmed staging project..."
recovery_required=true
failure_code="postgres_stop_failed"
if ! run_compose_with_timeout stop --timeout "${POSTGRES_STOP_TIMEOUT_SECONDS}" postgres 1>&2; then
  fail "postgres_stop_failed" "The bounded PostgreSQL stop command failed; recovery will still be attempted."
fi

if running_services="$(run_compose_with_timeout ps --status running --services)"; then
  while IFS= read -r running_service; do
    if [[ "${running_service}" == "postgres" ]]; then
      fail "postgres_stop_failed" "PostgreSQL still appears as a running Compose service."
    fi
  done <<<"${running_services}"
else
  fail "postgres_stop_failed" "The post-stop Compose state could not be inspected."
fi

log "Verifying liveness remains available while readiness fails closed..."
failure_code="outage_contract_failed"
if ! wait_for_outage_contract; then
  fail "outage_contract_failed" "Expected live=200 and ready!=200 were not observed inside the hard timeout."
fi

drill_checks_passed=true
failure_code="recovery_pending"
log "Outage contract passed; the EXIT trap now restores PostgreSQL."
exit 0
