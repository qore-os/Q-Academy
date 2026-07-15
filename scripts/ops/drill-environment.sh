#!/usr/bin/env bash

activate_q_academy_drill_environment() {
  if [[ $# -ne 2 ]]; then
    printf 'Usage: activate_q_academy_drill_environment ENV_FILE PROJECT_NAME\n' >&2
    return 2
  fi

  local environment_file="$1"
  local expected_project_name="$2"
  local line=""
  local line_number=0
  local name=""
  local value=""
  local required_name=""
  local -a environment_names=(
    COMPOSE_PROJECT_NAME APP_IMAGE_TAG NODE_IMAGE POSTGRES_IMAGE
    CLAMAV_IMAGE PROMETHEUS_IMAGE NODE_EXPORTER_IMAGE
    APP_DOMAIN CADDY_SITE_ADDRESSES ACME_EMAIL
    POSTGRES_DB POSTGRES_BOOTSTRAP_USER POSTGRES_BOOTSTRAP_PASSWORD
    OWNER_POSTGRES_USER OWNER_POSTGRES_PASSWORD
    APP_POSTGRES_USER APP_POSTGRES_PASSWORD
    MEDIA_POSTGRES_USER MEDIA_POSTGRES_PASSWORD
    SESSION_SECRET AUTH_RATE_LIMIT_SECRET CADDY_TLS_ASK_SECRET
    WEBHOOK_ENCRYPTION_KEY WEBHOOK_ENCRYPTION_KEY_ID
    DATA_ENCRYPTION_KEY DATA_ENCRYPTION_KEY_ID
    MFA_RECOVERY_PEPPER MFA_RECOVERY_PEPPER_ID PRIVACY_SUBJECT_HMAC_SECRET
    EXAM_SELECTION_SECRET CRON_SECRET MEDIA_CRON_SECRET
    METRICS_SECRET MEDIA_METRICS_SECRET
    EMAIL_DELIVERY_WEBHOOK_URL EMAIL_DELIVERY_WEBHOOK_SECRET
    EMAIL_DELIVERY_INBOUND_SECRET LEGAL_IMPRINT_URL LEGAL_PRIVACY_URL
    SUPPORT_EMAIL WEB_PUSH_VAPID_PUBLIC_KEY WEB_PUSH_VAPID_PRIVATE_KEY
    WEB_PUSH_VAPID_SUBJECT MEDIA_PROCESSING_WORK_DIR MEDIA_S3_ENDPOINT
    MEDIA_S3_REGION MEDIA_S3_BUCKET MEDIA_S3_APP_ACCESS_KEY_ID
    MEDIA_S3_APP_SECRET_ACCESS_KEY MEDIA_S3_ACCESS_KEY_ID
    MEDIA_S3_SECRET_ACCESS_KEY
  )
  local -A allowed_names=()
  local -A seen_names=()

  if [[ ! -f "${environment_file}" || -L "${environment_file}" ||
        ! -r "${environment_file}" ]]; then
    printf 'Drill environment must be a readable regular non-symlink file.\n' >&2
    return 1
  fi
  if [[ ! "${expected_project_name}" =~ ^qacademy-drill-[a-f0-9]{12}$ ]]; then
    printf 'Drill project name is invalid: %s\n' "${expected_project_name}" >&2
    return 1
  fi

  for required_name in "${environment_names[@]}"; do
    allowed_names["${required_name}"]=true
  done

  # Parse the generated dotenv file as data. Never evaluate its values as shell.
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line_number=$((line_number + 1))
    if [[ "${line}" == *$'\r'* || "${line}" != *=* ]]; then
      printf 'Invalid drill environment line %s.\n' "${line_number}" >&2
      return 1
    fi
    name="${line%%=*}"
    value="${line#*=}"
    if [[ ! "${name}" =~ ^[A-Z][A-Z0-9_]*$ ]] ||
       [[ -z "${allowed_names[${name}]+present}" ]]; then
      printf 'Unexpected drill environment name on line %s: %s\n' \
        "${line_number}" "${name:-missing}" >&2
      return 1
    fi
    if [[ -n "${seen_names[${name}]+present}" ]]; then
      printf 'Duplicate drill environment name on line %s: %s\n' \
        "${line_number}" "${name}" >&2
      return 1
    fi
    seen_names["${name}"]=true
    declare -g "${name}"
    printf -v "${name}" '%s' "${value}"
    export "${name}"
  done <"${environment_file}"

  for required_name in "${environment_names[@]}"; do
    if [[ -z "${seen_names[${required_name}]+present}" ]]; then
      printf 'Generated drill environment is missing %s.\n' \
        "${required_name}" >&2
      return 1
    fi
  done
  if [[ "${COMPOSE_PROJECT_NAME:-}" != "${expected_project_name}" ]]; then
    printf 'Generated drill project identity does not match the expected project.\n' >&2
    return 1
  fi
  for required_name in \
    APP_IMAGE_TAG NODE_IMAGE POSTGRES_IMAGE POSTGRES_DB \
    POSTGRES_BOOTSTRAP_USER POSTGRES_BOOTSTRAP_PASSWORD \
    OWNER_POSTGRES_USER OWNER_POSTGRES_PASSWORD \
    APP_POSTGRES_USER APP_POSTGRES_PASSWORD \
    MEDIA_POSTGRES_USER MEDIA_POSTGRES_PASSWORD; do
    if [[ -z "${!required_name:-}" ]]; then
      printf 'Generated drill environment has an empty %s.\n' \
        "${required_name}" >&2
      return 1
    fi
  done
}

validate_q_academy_staging_drill_target() {
  if [[ $# -ne 5 ]]; then
    printf 'Usage: validate_q_academy_staging_drill_target ENV_FILE PROJECT_NAME CONFIRM_PROJECT_NAME ORIGIN CONFIRM_ORIGIN\n' >&2
    return 2
  fi

  local environment_file="$1"
  local project_name="$2"
  local confirm_project_name="$3"
  local origin="$4"
  local confirm_origin="$5"
  local hostname=""
  local normalized_project=""
  local line=""
  local line_number=0
  local name=""
  local env_app_domain=""
  local env_compose_project=""
  local env_app_domain_seen=false
  local env_compose_project_seen=false
  local staging_host=false
  local production_host=false
  local label=""
  local -a hostname_labels=()
  local -a project_labels=()
  local -A environment_names_seen=()

  Q_ACADEMY_STAGING_ENV_FILE=""
  Q_ACADEMY_STAGING_PROJECT_NAME=""
  Q_ACADEMY_STAGING_ORIGIN=""
  Q_ACADEMY_STAGING_HOSTNAME=""

  if [[ "${origin}" != "${confirm_origin}" ]]; then
    printf 'The confirmed staging origin must exactly match the requested origin.\n' >&2
    return 1
  fi
  if [[ "${project_name}" != "${confirm_project_name}" ]]; then
    printf 'The confirmed Compose project must exactly match the requested project.\n' >&2
    return 1
  fi
  if [[ ! "${origin}" =~ ^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    printf 'The staging origin must be a canonical HTTPS DNS origin without credentials, port, path, query, or fragment.\n' >&2
    return 1
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
    printf 'Local, IP, reserved, and non-routable staging origins are forbidden.\n' >&2
    return 1
  fi

  IFS='.' read -r -a hostname_labels <<<"${hostname}"
  for label in "${hostname_labels[@]}"; do
    case "${label}" in
      staging|stage|stg|preprod|sandbox) staging_host=true ;;
      prod*|live*) production_host=true ;;
    esac
  done
  if [[ "${staging_host}" != "true" || "${production_host}" == "true" ]]; then
    printf 'The origin must contain an exact staging label and no production label.\n' >&2
    return 1
  fi

  if [[ ! "${project_name}" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ ]]; then
    printf 'The explicit Compose project name is invalid.\n' >&2
    return 1
  fi
  normalized_project="-${project_name//_/-}-"
  if [[ "${normalized_project}" != *-staging-* &&
        "${normalized_project}" != *-stage-* &&
        "${normalized_project}" != *-stg-* &&
        "${normalized_project}" != *-preprod-* &&
        "${normalized_project}" != *-sandbox-* ]]; then
    printf 'The Compose project must contain an exact staging marker.\n' >&2
    return 1
  fi
  if [[ "${normalized_project}" == *-prod-* ||
        "${normalized_project}" == *-production-* ||
        "${normalized_project}" == *-live-* ]]; then
    printf 'Production-like Compose project names are forbidden.\n' >&2
    return 1
  fi
  IFS='-' read -r -a project_labels <<<"${project_name//_/-}"
  for label in "${project_labels[@]}"; do
    case "${label}" in
      prod*|live*)
        printf 'Production-like Compose project names are forbidden.\n' >&2
        return 1
        ;;
    esac
  done

  if [[ "${environment_file}" != /* || ! -f "${environment_file}" ||
        -L "${environment_file}" || ! -r "${environment_file}" ]]; then
    printf 'The staging environment must be an absolute readable regular non-symlink file.\n' >&2
    return 1
  fi

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line_number=$((line_number + 1))
    if [[ "${line}" == *$'\r'* ]]; then
      printf 'The staging environment contains unsupported carriage returns on line %s.\n' "${line_number}" >&2
      return 1
    fi
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    if [[ "${line}" != *=* ]]; then
      printf 'The staging environment line %s is not a canonical assignment.\n' "${line_number}" >&2
      return 1
    fi
    name="${line%%=*}"
    if [[ ! "${name}" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
      printf 'The staging environment name on line %s is invalid.\n' "${line_number}" >&2
      return 1
    fi
    if [[ -n "${environment_names_seen[${name}]+present}" ]]; then
      printf 'The staging environment name %s occurs more than once.\n' "${name}" >&2
      return 1
    fi
    environment_names_seen["${name}"]=true
    case "${name}" in
      APP_DOMAIN)
        if [[ "${env_app_domain_seen}" == "true" ]]; then
          printf 'APP_DOMAIN may only occur once in the staging environment.\n' >&2
          return 1
        fi
        env_app_domain_seen=true
        env_app_domain="${line#APP_DOMAIN=}"
        ;;
      COMPOSE_PROJECT_NAME)
        if [[ "${env_compose_project_seen}" == "true" ]]; then
          printf 'COMPOSE_PROJECT_NAME may only occur once in the staging environment.\n' >&2
          return 1
        fi
        env_compose_project_seen=true
        env_compose_project="${line#COMPOSE_PROJECT_NAME=}"
        ;;
    esac
  done <"${environment_file}"

  if [[ "${env_app_domain_seen}" != "true" ||
        "${env_app_domain}" != "${hostname}" ]]; then
    printf 'The confirmed staging hostname must exactly match APP_DOMAIN.\n' >&2
    return 1
  fi
  if [[ "${env_compose_project_seen}" != "true" ||
        "${env_compose_project}" != "${project_name}" ]]; then
    printf 'The confirmed staging project must exactly match COMPOSE_PROJECT_NAME.\n' >&2
    return 1
  fi

  Q_ACADEMY_STAGING_ENV_FILE="${environment_file}"
  Q_ACADEMY_STAGING_PROJECT_NAME="${project_name}"
  Q_ACADEMY_STAGING_ORIGIN="${origin}"
  Q_ACADEMY_STAGING_HOSTNAME="${hostname}"
}

validate_q_academy_staging_storage_drill_target() {
  if [[ $# -ne 7 ]]; then
    printf 'Usage: validate_q_academy_staging_storage_drill_target ENV_FILE PROJECT_NAME CONFIRM_PROJECT_NAME ORIGIN CONFIRM_ORIGIN BUCKET CONFIRM_BUCKET\n' >&2
    return 2
  fi

  local environment_file="$1"
  local project_name="$2"
  local confirm_project_name="$3"
  local origin="$4"
  local confirm_origin="$5"
  local bucket="$6"
  local confirm_bucket="$7"
  local line=""
  local env_bucket=""
  local env_endpoint=""
  local env_compatibility_mode=""
  local bucket_seen=false
  local endpoint_seen=false
  local compatibility_mode_seen=false
  local normalized_bucket=""
  local storage_hostname=""
  local label=""
  local -a bucket_labels=()

  Q_ACADEMY_STAGING_MEDIA_S3_BUCKET=""
  Q_ACADEMY_STAGING_MEDIA_S3_ENDPOINT=""
  Q_ACADEMY_STAGING_MEDIA_S3_COMPATIBILITY_MODE=""

  validate_q_academy_staging_drill_target \
    "${environment_file}" "${project_name}" "${confirm_project_name}" \
    "${origin}" "${confirm_origin}" || return 1

  if [[ "${bucket}" != "${confirm_bucket}" ]]; then
    printf 'The confirmed staging media bucket must exactly match the requested bucket.\n' >&2
    return 1
  fi
  if [[ ! "${bucket}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ||
        "${bucket}" == *..* || "${bucket}" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    printf 'The staging media bucket must be a DNS-compatible non-IP bucket name.\n' >&2
    return 1
  fi
  normalized_bucket="-${bucket//./-}-"
  if [[ "${normalized_bucket}" != *-staging-* &&
        "${normalized_bucket}" != *-stage-* &&
        "${normalized_bucket}" != *-stg-* &&
        "${normalized_bucket}" != *-preprod-* &&
        "${normalized_bucket}" != *-sandbox-* ]]; then
    printf 'The media bucket must contain an exact staging marker.\n' >&2
    return 1
  fi
  IFS='.-' read -r -a bucket_labels <<<"${bucket}"
  for label in "${bucket_labels[@]}"; do
    case "${label}" in
      prod*|live*)
        printf 'Production-like media bucket names are forbidden.\n' >&2
        return 1
        ;;
    esac
  done

  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    case "${line%%=*}" in
      MEDIA_S3_BUCKET)
        [[ "${bucket_seen}" == "false" ]] || return 1
        bucket_seen=true
        env_bucket="${line#MEDIA_S3_BUCKET=}"
        ;;
      MEDIA_S3_ENDPOINT)
        [[ "${endpoint_seen}" == "false" ]] || return 1
        endpoint_seen=true
        env_endpoint="${line#MEDIA_S3_ENDPOINT=}"
        ;;
      MEDIA_S3_COMPATIBILITY_MODE)
        [[ "${compatibility_mode_seen}" == "false" ]] || return 1
        compatibility_mode_seen=true
        env_compatibility_mode="${line#MEDIA_S3_COMPATIBILITY_MODE=}"
        ;;
    esac
  done <"${environment_file}"

  if [[ "${bucket_seen}" != "true" || "${env_bucket}" != "${bucket}" ]]; then
    printf 'The confirmed staging media bucket must exactly match MEDIA_S3_BUCKET.\n' >&2
    return 1
  fi
  if [[ "${endpoint_seen}" != "true" ||
        ! "${env_endpoint}" =~ ^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    printf 'MEDIA_S3_ENDPOINT must be a canonical external HTTPS DNS origin.\n' >&2
    return 1
  fi
  if [[ "${compatibility_mode_seen}" != "true" ||
        ( "${env_compatibility_mode}" != "versioned" &&
          "${env_compatibility_mode}" != "strato-hidrive" ) ]]; then
    printf 'MEDIA_S3_COMPATIBILITY_MODE must be exactly versioned or strato-hidrive.\n' >&2
    return 1
  fi
  storage_hostname="${env_endpoint#https://}"
  if [[ "${storage_hostname}" == "example.com" ||
        "${storage_hostname}" == *.example.com ||
        "${storage_hostname}" == "example.net" ||
        "${storage_hostname}" == *.example.net ||
        "${storage_hostname}" == "example.org" ||
        "${storage_hostname}" == *.example.org ||
        "${storage_hostname}" == *.localhost ||
        "${storage_hostname}" == *.local ||
        "${storage_hostname}" == *.internal ||
        "${storage_hostname}" == *.invalid ||
        "${storage_hostname}" == *.test ||
        "${storage_hostname}" == *.example ]]; then
    printf 'Reserved and non-routable media storage endpoints are forbidden.\n' >&2
    return 1
  fi

  Q_ACADEMY_STAGING_MEDIA_S3_BUCKET="${bucket}"
  Q_ACADEMY_STAGING_MEDIA_S3_ENDPOINT="${env_endpoint}"
  Q_ACADEMY_STAGING_MEDIA_S3_COMPATIBILITY_MODE="${env_compatibility_mode}"
}

verify_q_academy_local_docker_socket() {
  if [[ $# -ne 0 ]]; then
    printf 'Usage: verify_q_academy_local_docker_socket\n' >&2
    return 2
  fi

  local docker_context=""
  local docker_endpoint=""
  local docker_binary=""
  local socket_path=""

  Q_ACADEMY_DOCKER_CONTEXT=""
  Q_ACADEMY_DOCKER_ENDPOINT=""
  Q_ACADEMY_DOCKER_BINARY=""

  docker_binary="$(command -v docker)" || {
    printf 'Docker is required for a staging drill.\n' >&2
    return 1
  }
  if [[ "${docker_binary}" != /* || ! -x "${docker_binary}" ]]; then
    printf 'Docker must resolve to an absolute executable path.\n' >&2
    return 1
  fi
  command -v timeout >/dev/null 2>&1 || {
    printf 'GNU timeout is required for a staging drill.\n' >&2
    return 1
  }
  if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
    printf 'DOCKER_HOST and DOCKER_CONTEXT overrides are forbidden for staging drills.\n' >&2
    return 1
  fi
  if ! timeout --signal=TERM --kill-after=5s 20s docker compose version >/dev/null 2>&1; then
    printf 'The Docker Compose plugin is unavailable.\n' >&2
    return 1
  fi
  if ! docker_context="$(
    timeout --signal=TERM --kill-after=5s 20s docker context show
  )" || [[ -z "${docker_context}" ]]; then
    printf 'The active Docker context could not be identified.\n' >&2
    return 1
  fi
  if ! docker_endpoint="$(
    timeout --signal=TERM --kill-after=5s 20s \
      docker context inspect --format '{{.Endpoints.docker.Host}}' \
      "${docker_context}"
  )" || [[ "${docker_endpoint}" != unix:///* ]]; then
    printf 'Only an active local Unix-socket Docker context is allowed.\n' >&2
    return 1
  fi
  socket_path="${docker_endpoint#unix://}"
  if [[ ! -S "${socket_path}" ]]; then
    printf 'The active Docker endpoint is not a local Unix socket.\n' >&2
    return 1
  fi
  if ! timeout --signal=TERM --kill-after=5s 20s docker info >/dev/null 2>&1; then
    printf 'The local Docker daemon is unavailable.\n' >&2
    return 1
  fi

  Q_ACADEMY_DOCKER_CONTEXT="${docker_context}"
  Q_ACADEMY_DOCKER_ENDPOINT="${docker_endpoint}"
  Q_ACADEMY_DOCKER_BINARY="${docker_binary}"
}

build_q_academy_staging_compose_command() {
  if [[ $# -ne 4 ]]; then
    printf 'Usage: build_q_academy_staging_compose_command ARRAY_NAME ENV_FILE PROJECT_NAME COMPOSE_FILE\n' >&2
    return 2
  fi

  local target_name="$1"
  local environment_file="$2"
  local project_name="$3"
  local compose_file="$4"

  if [[ ! "${target_name}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    printf 'The Compose command array name is invalid.\n' >&2
    return 1
  fi
  local -n target="${target_name}"
  if [[ -z "${Q_ACADEMY_DOCKER_BINARY:-}" ||
        "${environment_file}" != "${Q_ACADEMY_STAGING_ENV_FILE:-}" ||
        "${project_name}" != "${Q_ACADEMY_STAGING_PROJECT_NAME:-}" ]]; then
    printf 'The staging target and local Docker socket must be validated before building a Compose command.\n' >&2
    return 1
  fi
  if [[ "${compose_file}" != /* || ! -f "${compose_file}" ||
        -L "${compose_file}" || ! -r "${compose_file}" ]]; then
    printf 'The Compose file must be an absolute readable regular non-symlink file.\n' >&2
    return 1
  fi
  if [[ -z "${PATH:-}" || -z "${HOME:-}" ]]; then
    printf 'PATH and HOME are required to construct the clean Compose environment.\n' >&2
    return 1
  fi

  # Shell variables override --env-file in Compose. Start from an empty child
  # environment so only the explicitly confirmed dotenv file supplies model
  # values. Preserve Docker configuration paths already bound to the verified
  # local Unix-socket context.
  target=(env -i "PATH=${PATH}" "HOME=${HOME}")
  if [[ -n "${DOCKER_CONFIG:-}" ]]; then
    target+=("DOCKER_CONFIG=${DOCKER_CONFIG}")
  fi
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    target+=("XDG_CONFIG_HOME=${XDG_CONFIG_HOME}")
  fi
  if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    target+=("XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR}")
  fi
  target+=(
    "${Q_ACADEMY_DOCKER_BINARY}" --host "${Q_ACADEMY_DOCKER_ENDPOINT}" compose
    --env-file "${environment_file}"
    --project-name "${project_name}"
    -f "${compose_file}"
  )
}
