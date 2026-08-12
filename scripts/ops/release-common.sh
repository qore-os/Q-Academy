#!/usr/bin/env bash

PINNED_IMAGE_VARIABLES=(
  NODE_IMAGE
  POSTGRES_IMAGE
  CLAMAV_IMAGE
  PROMETHEUS_IMAGE
  NODE_EXPORTER_IMAGE
)

RELEASE_IMAGE_COMPONENTS=(
  postgres
  app
  migrator
  key-rotation
  tenant-ops
  media-runner
  media-preflight
  s3-app-principal-preflight
  dispatcher
  caddy
)

RELEASE_IMAGE_MANIFEST_VARIABLES=(
  Q_ACADEMY_POSTGRES_IMAGE
  Q_ACADEMY_APP_IMAGE
  Q_ACADEMY_MIGRATOR_IMAGE
  Q_ACADEMY_KEY_ROTATION_IMAGE
  Q_ACADEMY_TENANT_OPS_IMAGE
  Q_ACADEMY_MEDIA_RUNNER_IMAGE
  Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE
  Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE
  Q_ACADEMY_DISPATCHER_IMAGE
  Q_ACADEMY_CADDY_IMAGE
)

MEDIA_WORK_MOUNT=/var/lib/q-academy-media-processing
MEDIA_WORK_SENTINEL=.q-academy-media-work-root
MEDIA_WORK_SENTINEL_VALUE=q-academy-media-processing-v1
CADDY_SITES_DIRECTORY_DEFAULT=/etc/q-academy/caddy-sites
LEGACY_RELEASE_STATE_SCHEMA_VERSION=2
RELEASE_STATE_SCHEMA_VERSION=3
PENDING_RELEASE_SCHEMA_VERSION=1
PRODUCTION_COMPOSE_PROJECT=q-academy
RELEASE_LOCK_FILE_DEFAULT=/var/lock/q-academy-release.lock
BACKUP_LOCK_FILE_DEFAULT=/var/lock/q-academy-backup.lock
PENDING_RELEASE_FILE_DEFAULT=/var/lib/q-academy/releases/pending.env
DATABASE_WRITER_SERVICES=(scheduler media-worker media-maintenance app media-runner)
DATABASE_RUNTIME_SERVICES=(app media-runner)
DATABASE_DISPATCHER_SERVICES=(scheduler media-worker media-maintenance)
RELEASE_NETWORK_BOOTSTRAP_SERVICES=(app media-runner)
OBSERVABILITY_RUNTIME_SERVICES=(prometheus node-exporter)
DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS=1800
CADDY_WAIT_TIMEOUT_SECONDS=300
S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS=1200
MEDIA_PROCESSING_PREFLIGHT_TIMEOUT_SECONDS=1800
STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS=1800
MEDIA_STORAGE_RELEASE_STATE_VARIABLES=(
  MEDIA_S3_COMPATIBILITY_MODE
  MEDIA_S3_ENDPOINT
  MEDIA_S3_REGION
  MEDIA_S3_BUCKET
  MEDIA_S3_FORCE_PATH_STYLE
)

verify_caddy_sites_directory() {
  local env_file="$1"
  local directory entry entry_count=0

  directory="$(production_env_value "$env_file" CADDY_SITES_DIRECTORY)" || return 1
  [[ "$directory" =~ ^/[A-Za-z0-9._/-]+$ && "$directory" != *'/../'* && "$directory" != */.. ]] || return 1
  [[ -d "$directory" && ! -L "$directory" ]] || return 1
  [[ "$(stat -c '%u:%g:%a' "$directory")" == "0:0:755" ]] || return 1

  while IFS= read -r -d '' entry; do
    entry_count=$((entry_count + 1))
    (( entry_count <= 20 )) || return 1
    [[ "$entry" == *.caddy ]] || return 1
    [[ -f "$entry" && ! -L "$entry" ]] || return 1
    [[ "$(stat -c '%u:%g:%a' "$entry")" == "0:0:644" ]] || return 1
    [[ "$(stat -c '%s' "$entry")" -le 65536 ]] || return 1
  done < <(find "$directory" -mindepth 1 -maxdepth 1 -print0)
}

upgrade_legacy_release_state() {
  local state_file="$1"
  local env_file="$2"
  local persist="${3:-true}"
  local schema controller_commit current_tag previous_tag deployed_at configured_tag
  local app_container_id active_image name configured_value active_line active_value
  local temporary_state

  [[ "$persist" == "true" || "$persist" == "false" ]] || return 1
  schema="$(production_env_value "$state_file" SCHEMA_VERSION)" || return 1
  [[ "$schema" == "$LEGACY_RELEASE_STATE_SCHEMA_VERSION" ]] || return 1
  [[ -f "$state_file" && ! -L "$state_file" ]] || return 1
  [[ "$(stat -c '%u:%g:%a' "$state_file")" == "0:0:600" ]] || return 1

  controller_commit="$(production_env_value "$state_file" CONTROLLER_COMMIT)" || return 1
  current_tag="$(production_env_value "$state_file" CURRENT_TAG)" || return 1
  previous_tag="$(production_env_value "$state_file" PREVIOUS_TAG)" || return 1
  deployed_at="$(production_env_value "$state_file" DEPLOYED_AT)" || return 1
  configured_tag="$(production_env_value "$env_file" APP_IMAGE_TAG)" || return 1
  [[ "$controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || return 1
  [[ "$current_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  [[ -z "$previous_tag" || "$previous_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  [[ "$deployed_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  [[ "$configured_tag" == "$current_tag" ]] || return 1

  app_container_id="$(
    docker ps --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$PRODUCTION_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=app"
  )" || return 1
  [[ "$app_container_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  active_image="$(docker inspect --format '{{.Config.Image}}' "$app_container_id")" || return 1
  [[ "$active_image" == "q-academy-app:$current_tag" ]] || return 1

  for name in "${MEDIA_STORAGE_RELEASE_STATE_VARIABLES[@]}"; do
    configured_value="$(production_env_value "$env_file" "$name")" || return 1
    active_line="$(
      docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$app_container_id" |
        grep "^${name}="
    )" || return 1
    [[ "$active_line" != *$'\n'* ]] || return 1
    active_value="${active_line#*=}"
    [[ "$active_value" == "$configured_value" ]] || return 1
  done

  [[ "$persist" == "true" ]] || return 0

  temporary_state="${state_file}.upgrade.$$"
  [[ ! -e "$temporary_state" && ! -L "$temporary_state" ]] || return 1
  umask 077
  if ! {
    {
      printf 'SCHEMA_VERSION=%s\n' "$RELEASE_STATE_SCHEMA_VERSION"
      printf 'CONTROLLER_COMMIT=%s\n' "$controller_commit"
      printf 'CURRENT_TAG=%s\n' "$current_tag"
      printf 'PREVIOUS_TAG=%s\n' "$previous_tag"
      printf 'DEPLOYED_AT=%s\n' "$deployed_at"
      write_media_storage_release_state "$env_file"
    } >"$temporary_state" &&
      sync "$temporary_state" &&
      mv -f "$temporary_state" "$state_file" &&
      sync -f "$(dirname -- "$state_file")"
  }; then
    rm -f -- "$temporary_state"
    return 1
  fi
  validate_media_storage_release_state "$state_file"
}

validate_media_storage_release_state() {
  local state_file="$1"
  local name value

  for name in "${MEDIA_STORAGE_RELEASE_STATE_VARIABLES[@]}"; do
    value="$(production_env_value "$state_file" "$name")" || return 1
    [[ -n "$value" ]] || {
      printf '%s must not be empty in the release state.\n' "$name" >&2
      return 1
    }
  done
  value="$(production_env_value "$state_file" MEDIA_S3_COMPATIBILITY_MODE)" || return 1
  [[ "$value" == "versioned" || "$value" == "strato-hidrive" ]] || return 1
  value="$(production_env_value "$state_file" MEDIA_S3_ENDPOINT)" || return 1
  [[ "$value" =~ ^https://[^[:space:]]+$ ]] || return 1
  value="$(production_env_value "$state_file" MEDIA_S3_REGION)" || return 1
  [[ "$value" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  value="$(production_env_value "$state_file" MEDIA_S3_BUCKET)" || return 1
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$ ]] || return 1
  value="$(production_env_value "$state_file" MEDIA_S3_FORCE_PATH_STYLE)" || return 1
  [[ "$value" == "true" || "$value" == "false" ]]
}

media_storage_release_state_matches() {
  local state_file="$1"
  local env_file="$2"
  local name state_value configured_value

  for name in "${MEDIA_STORAGE_RELEASE_STATE_VARIABLES[@]}"; do
    state_value="$(production_env_value "$state_file" "$name")" || return 1
    configured_value="$(production_env_value "$env_file" "$name")" || return 1
    [[ "$state_value" == "$configured_value" ]] || return 1
  done
}

write_media_storage_release_state() {
  local env_file="$1"
  local name value

  for name in "${MEDIA_STORAGE_RELEASE_STATE_VARIABLES[@]}"; do
    value="$(production_env_value "$env_file" "$name")" || return 1
    printf '%s=%s\n' "$name" "$value"
  done
}

assert_media_storage_change_is_drained() {
  local state_file="$1"
  local env_file="$2"
  local active_binding_count="$3"

  if media_storage_release_state_matches "$state_file" "$env_file"; then
    return 0
  fi
  [[ "$active_binding_count" =~ ^[0-9]+$ ]] || {
    printf 'Active media-storage binding count is invalid.\n' >&2
    return 1
  }
  [[ "$active_binding_count" == "0" ]] || {
    printf 'Media storage identity cannot change while %s media object, derivative, privacy export, or multipart session binding(s) remain on the active provider. Run a verified object migration or remove them with the old provider configuration first.\n' \
      "$active_binding_count" >&2
    return 1
  }
}
STRATO_PRIVACY_SWEEPER_SERVICE=strato-privacy-sweeper
MEDIA_S3_COMPOSE_PROFILE_ARGS=()
MEDIA_S3_RELEASE_SERVICES=()

predeploy_backup_decision() {
  local initial_install="$1"
  local application_relation_count="$2"

  [[ "$initial_install" == "true" || "$initial_install" == "false" ]] || {
    printf 'Initial-install state must be true or false.\n' >&2
    return 1
  }
  [[ "$application_relation_count" =~ ^[0-9]+$ ]] || {
    printf 'Application relation count must be a non-negative integer.\n' >&2
    return 1
  }

  if [[ "$initial_install" == "true" && "$application_relation_count" == "0" ]]; then
    printf 'skip-empty-initial'
  else
    printf 'required'
  fi
}

production_env_value() {
  local env_file="$1"
  local name="$2"
  local count value

  count="$(grep -c "^${name}=" "$env_file" || true)"
  [[ "$count" == "1" ]] || {
    printf '%s must occur exactly once in %s.\n' "$name" "$env_file" >&2
    return 1
  }
  value="$(sed -n "s/^${name}=//p" "$env_file")"
  value="${value%$'\r'}"
  printf '%s' "$value"
}

validate_pending_release_marker() {
  local marker_file="$1"
  local schema from_tag to_tag controller_commit phase migrations_may_have_run created_at

  [[ "$marker_file" == /* ]] || {
    printf 'Pending release marker path must be absolute.\n' >&2
    return 1
  }
  [[ -f "$marker_file" && ! -L "$marker_file" ]] || {
    printf 'Pending release marker is missing or unsafe: %s\n' "$marker_file" >&2
    return 1
  }
  awk -F= '
    BEGIN {
      allowed["SCHEMA_VERSION"] = 1
      allowed["FROM_TAG"] = 1
      allowed["TO_TAG"] = 1
      allowed["CONTROLLER_COMMIT"] = 1
      allowed["PHASE"] = 1
      allowed["MIGRATIONS_MAY_HAVE_RUN"] = 1
      allowed["CREATED_AT"] = 1
    }
    !($1 in allowed) { invalid = 1 }
    END { exit (NR == 7 && !invalid) ? 0 : 1 }
  ' "$marker_file" || {
    printf 'Pending release marker must contain exactly the seven contract fields.\n' >&2
    return 1
  }
  [[ "$(stat -c '%u:%g:%a' "$marker_file")" == "0:0:600" ]] || {
    printf 'Pending release marker must be root-owned with mode 0600.\n' >&2
    return 1
  }
  schema="$(production_env_value "$marker_file" SCHEMA_VERSION)" || return 1
  from_tag="$(production_env_value "$marker_file" FROM_TAG)" || return 1
  to_tag="$(production_env_value "$marker_file" TO_TAG)" || return 1
  controller_commit="$(production_env_value "$marker_file" CONTROLLER_COMMIT)" || return 1
  phase="$(production_env_value "$marker_file" PHASE)" || return 1
  migrations_may_have_run="$(production_env_value "$marker_file" MIGRATIONS_MAY_HAVE_RUN)" || return 1
  created_at="$(production_env_value "$marker_file" CREATED_AT)" || return 1

  [[ "$schema" == "$PENDING_RELEASE_SCHEMA_VERSION" ]] || {
    printf 'Pending release marker schema is unsupported.\n' >&2
    return 1
  }
  [[ -z "$from_tag" || "$from_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || {
    printf 'Pending release FROM_TAG is invalid.\n' >&2
    return 1
  }
  [[ "$to_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || {
    printf 'Pending release TO_TAG is invalid.\n' >&2
    return 1
  }
  [[ -z "$from_tag" || "$from_tag" != "$to_tag" ]] || {
    printf 'Pending release must change the active tag.\n' >&2
    return 1
  }
  [[ "$controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || {
    printf 'Pending release CONTROLLER_COMMIT is invalid.\n' >&2
    return 1
  }
  [[ "$to_tag" == "git-${controller_commit}" ]] || {
    printf 'Pending release TO_TAG does not match CONTROLLER_COMMIT.\n' >&2
    return 1
  }
  [[ "$phase" == "migrations-may-have-run" && "$migrations_may_have_run" == "true" ]] || {
    printf 'Pending release migration phase is invalid.\n' >&2
    return 1
  }
  [[ "$created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
    printf 'Pending release timestamp is invalid.\n' >&2
    return 1
  }
}

write_pending_release_marker() {
  local marker_file="$1"
  local from_tag="$2"
  local to_tag="$3"
  local controller_commit="$4"
  local directory parent_directory directory_owner directory_mode temporary

  [[ "$EUID" -eq 0 ]] || {
    printf 'Only root may create the pending release marker.\n' >&2
    return 1
  }
  [[ "$marker_file" == /* ]] || {
    printf 'Pending release marker path must be absolute.\n' >&2
    return 1
  }
  [[ -z "$from_tag" || "$from_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  [[ "$to_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  [[ -z "$from_tag" || "$from_tag" != "$to_tag" ]] || return 1
  [[ "$controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || return 1
  [[ "$to_tag" == "git-${controller_commit}" ]] || return 1
  [[ ! -e "$marker_file" && ! -L "$marker_file" ]] || {
    printf 'Refusing to replace an existing pending release marker.\n' >&2
    return 1
  }

  directory="$(dirname -- "$marker_file")"
  if [[ -e "$directory" || -L "$directory" ]]; then
    [[ -d "$directory" && ! -L "$directory" ]] || {
      printf 'Pending release marker directory is unsafe.\n' >&2
      return 1
    }
    directory_owner="$(stat -c '%u:%g' "$directory")" || return 1
    directory_mode="$(stat -c '%a' "$directory")" || return 1
    [[ "$directory_owner" == "0:0" && "$directory_mode" == "700" ]] || {
      printf 'Existing pending release directory must be root-owned with mode 0700.\n' >&2
      return 1
    }
  else
    parent_directory="$(dirname -- "$directory")"
    [[ -d "$parent_directory" && ! -L "$parent_directory" ]] || {
      printf 'Pending release parent directory must already exist and be safe.\n' >&2
      return 1
    }
    [[ "$(stat -c '%u:%g' "$parent_directory")" == "0:0" ]] || {
      printf 'Pending release parent directory must be root-owned.\n' >&2
      return 1
    }
    directory_mode="$(stat -c '%a' "$parent_directory")" || return 1
    [[ "$directory_mode" =~ ^[0-7]*[0145][0145]$ ]] || {
      printf 'Pending release parent directory must not be group- or world-writable.\n' >&2
      return 1
    }
    mkdir -m 0700 -- "$directory" || return 1
  fi
  umask 077
  temporary="$(mktemp "${directory}/.pending-release.tmp.XXXXXX")" || return 1
  if ! {
    printf 'SCHEMA_VERSION=%s\n' "$PENDING_RELEASE_SCHEMA_VERSION"
    printf 'FROM_TAG=%s\n' "$from_tag"
    printf 'TO_TAG=%s\n' "$to_tag"
    printf 'CONTROLLER_COMMIT=%s\n' "$controller_commit"
    printf 'PHASE=migrations-may-have-run\n'
    printf 'MIGRATIONS_MAY_HAVE_RUN=true\n'
    printf 'CREATED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$temporary" ||
    ! chown root:root "$temporary" ||
    ! chmod 0600 "$temporary" ||
    ! sync "$temporary" ||
    ! mv -f -- "$temporary" "$marker_file" ||
    ! sync -f "$directory"; then
    rm -f -- "$temporary"
    return 1
  fi
  validate_pending_release_marker "$marker_file"
}

remove_pending_release_marker() {
  local marker_file="$1"

  [[ "$EUID" -eq 0 ]] || {
    printf 'Only root may remove the pending release marker.\n' >&2
    return 1
  }
  validate_pending_release_marker "$marker_file" || return 1
  rm -- "$marker_file" || return 1
  sync -f "$(dirname -- "$marker_file")"
}

compose_project_name() {
  local project_name

  (($# > 0)) || {
    printf 'Compose command is required to derive the project name.\n' >&2
    return 1
  }
  command -v python3 >/dev/null 2>&1 || {
    printf 'python3 is required to derive the Compose project name.\n' >&2
    return 1
  }
  project_name="$(
    "$@" config --format json \
      | python3 -c '
import json
import re
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(2)
name = payload.get("name") if isinstance(payload, dict) else None
if not isinstance(name, str) or re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", name) is None:
    raise SystemExit(3)
sys.stdout.write(name)
'
  )" || {
    printf 'Could not derive one safe Compose project name.\n' >&2
    return 1
  }
  [[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]{0,47}$ ]] || {
    printf 'Compose project name is invalid.\n' >&2
    return 1
  }
  printf '%s' "$project_name"
}

stop_production_compose_project() {
  local project_name="$1"
  local container_output container_id
  local -a container_ids=()

  [[ "$project_name" == "$PRODUCTION_COMPOSE_PROJECT" ]] || {
    printf 'Refusing to stop a project other than %s.\n' "$PRODUCTION_COMPOSE_PROJECT" >&2
    return 1
  }
  command -v docker >/dev/null 2>&1 || {
    printf 'docker is required to stop the production Compose project.\n' >&2
    return 1
  }
  container_output="$(
    docker ps --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$project_name"
  )" || {
    printf 'Could not enumerate the production Compose containers.\n' >&2
    return 1
  }
  [[ -n "$container_output" ]] || return 0
  mapfile -t container_ids <<<"$container_output"
  for container_id in "${container_ids[@]}"; do
    [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || {
      printf 'Docker returned an invalid production container identifier.\n' >&2
      return 1
    }
  done
  docker stop --time 30 "${container_ids[@]}" >/dev/null
}

verify_external_release_readiness() {
  local app_domain="$1"
  local expected_tag="$2"
  local response

  [[ "$app_domain" =~ ^[A-Za-z0-9.-]+$ ]] || {
    printf 'External readiness domain is invalid.\n' >&2
    return 1
  }
  [[ "$expected_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || {
    printf 'External readiness release tag is invalid.\n' >&2
    return 1
  }
  command -v curl >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  response="$(
    curl --fail --show-error --silent \
      --connect-timeout 10 --max-time 30 \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "https://${app_domain}/api/v1/health/ready"
  )" || return 1
  Q_ACADEMY_EXPECTED_RELEASE="$expected_tag" python3 -c '
import json
import os
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(2)
version = payload.get("data", {}).get("version") if isinstance(payload, dict) else None
if version != os.environ["Q_ACADEMY_EXPECTED_RELEASE"]:
    raise SystemExit(3)
' <<<"$response"
}

configure_media_s3_release_services() {
  local env_file="$1"
  local compatibility_mode limitations_accepted

  MEDIA_S3_COMPOSE_PROFILE_ARGS=()
  MEDIA_S3_RELEASE_SERVICES=()

  compatibility_mode="$(production_env_value "$env_file" MEDIA_S3_COMPATIBILITY_MODE)" || return 1
  limitations_accepted="$(production_env_value "$env_file" MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED)" || return 1
  [[ "$limitations_accepted" == "true" || "$limitations_accepted" == "false" ]] || {
    printf 'MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED must be exactly true or false.\n' >&2
    return 1
  }

  case "$compatibility_mode" in
    versioned)
      ;;
    strato-hidrive)
      [[ "$limitations_accepted" == "true" ]] || {
        printf 'MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED must be exactly true in strato-hidrive mode.\n' >&2
        return 1
      }
      MEDIA_S3_COMPOSE_PROFILE_ARGS=(--profile strato)
      MEDIA_S3_RELEASE_SERVICES=(strato-privacy-sweeper)
      ;;
    *)
      printf 'MEDIA_S3_COMPATIBILITY_MODE must be exactly versioned or strato-hidrive.\n' >&2
      return 1
      ;;
  esac

  printf -v MEDIA_S3_COMPATIBILITY_MODE '%s' "$compatibility_mode"
  printf -v MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED '%s' "$limitations_accepted"
  export MEDIA_S3_COMPATIBILITY_MODE MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED
}

verify_and_export_pinned_images() {
  local env_file="$1"
  local name value

  for name in "${PINNED_IMAGE_VARIABLES[@]}"; do
    value="$(production_env_value "$env_file" "$name")" || return 1
    if [[ ! "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
      printf '%s must be one explicit image reference pinned by a real sha256 digest.\n' "$name" >&2
      return 1
    fi
    printf -v "$name" '%s' "$value"
    export "$name"
  done
}

verify_release_image_manifest() {
  local manifest_file="$1"
  local expected_tag="$2"
  local host_platform="$3"
  local manifest_tag manifest_commit manifest_platform name value

  [[ -f "$manifest_file" && ! -L "$manifest_file" ]] || {
    printf 'Release image manifest must be a regular non-symlink file: %s\n' "$manifest_file" >&2
    return 1
  }
  manifest_tag="$(production_env_value "$manifest_file" Q_ACADEMY_RELEASE_TAG)" || return 1
  manifest_commit="$(production_env_value "$manifest_file" Q_ACADEMY_SOURCE_COMMIT)" || return 1
  manifest_platform="$(production_env_value "$manifest_file" Q_ACADEMY_IMAGE_PLATFORM)" || return 1

  [[ "$manifest_tag" == "$expected_tag" ]] || {
    printf 'Release image manifest tag does not match %s.\n' "$expected_tag" >&2
    return 1
  }
  [[ "$manifest_commit" == "${expected_tag#git-}" ]] || {
    printf 'Release image manifest commit does not match the source-bound tag.\n' >&2
    return 1
  }
  [[ "$manifest_platform" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || {
    printf 'Release image manifest contains an invalid platform.\n' >&2
    return 1
  }
  [[ "$manifest_platform" == "$host_platform" ]] || {
    printf 'Release image platform %s does not match Docker server platform %s.\n' "$manifest_platform" "$host_platform" >&2
    return 1
  }

  for name in "${RELEASE_IMAGE_MANIFEST_VARIABLES[@]}"; do
    value="$(production_env_value "$manifest_file" "$name")" || return 1
    if [[ ! "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
      printf '%s must be one explicit registry reference pinned by sha256 digest.\n' "$name" >&2
      return 1
    fi
    printf -v "$name" '%s' "$value"
    export "$name"
  done
}

verify_release_image_manifest_checksum() {
  local manifest_file="$1"
  local checksum_file="$2"
  local manifest_directory checksum_directory manifest_basename
  local actual_output actual_digest
  local -a checksum_lines

  [[ -f "$manifest_file" && ! -L "$manifest_file" ]] || {
    printf 'Release image manifest must be a regular non-symlink file: %s\n' "$manifest_file" >&2
    return 1
  }
  [[ -f "$checksum_file" && ! -L "$checksum_file" ]] || {
    printf 'Release image manifest checksum must be a regular non-symlink file: %s\n' "$checksum_file" >&2
    return 1
  }
  manifest_directory="$(cd -- "$(dirname -- "$manifest_file")" && pwd -P)" || return 1
  checksum_directory="$(cd -- "$(dirname -- "$checksum_file")" && pwd -P)" || return 1
  [[ "$manifest_directory" == "$checksum_directory" ]] || {
    printf 'Release image manifest and checksum must share one physical directory.\n' >&2
    return 1
  }

  mapfile -t checksum_lines <"$checksum_file" || return 1
  [[ "${#checksum_lines[@]}" == "1" ]] || {
    printf 'Release image manifest checksum must contain exactly one entry.\n' >&2
    return 1
  }
  manifest_basename="$(basename -- "$manifest_file")"
  actual_output="$(sha256sum -- "$manifest_file")" || return 1
  actual_digest="${actual_output%% *}"
  [[ "${checksum_lines[0]}" == "$actual_digest  $manifest_basename" ]] || {
    printf 'Release image manifest checksum is not bound to %s.\n' "$manifest_basename" >&2
    return 1
  }
}

verify_media_work_mount() {
  local env_file="$1"
  local configured resolved target options owner mode sentinel_value
  local -a mounted_targets

  configured="$(production_env_value "$env_file" MEDIA_PROCESSING_WORK_DIR)" || return 1
  [[ "$configured" == "$MEDIA_WORK_MOUNT" ]] || {
    printf 'MEDIA_PROCESSING_WORK_DIR must be exactly %s.\n' "$MEDIA_WORK_MOUNT" >&2
    return 1
  }
  command -v findmnt >/dev/null 2>&1 || {
    printf 'findmnt is required to verify the bounded media work filesystem.\n' >&2
    return 1
  }
  [[ -d "$configured" && ! -L "$configured" ]] || {
    printf 'Media work mount must be a real directory, not a symlink.\n' >&2
    return 1
  }
  resolved="$(readlink -f -- "$configured")" || return 1
  [[ "$resolved" == "$configured" ]] || {
    printf 'Media work mount path must resolve to its exact configured location.\n' >&2
    return 1
  }
  target="$(findmnt -n -o TARGET --target "$configured")" || return 1
  [[ "$target" == "$configured" ]] || {
    printf 'Media work directory must be its own mounted filesystem.\n' >&2
    return 1
  }
  mapfile -t mounted_targets < <(findmnt -R -n -o TARGET "$configured") || return 1
  if (( ${#mounted_targets[@]} != 1 )) || [[ "${mounted_targets[0]:-}" != "$configured" ]]; then
    printf 'Media work filesystem must not contain nested mounts.\n' >&2
    return 1
  fi
  options="$(findmnt -n -o OPTIONS --target "$configured")" || return 1
  for option in nodev nosuid noexec; do
    [[ ",$options," == *",$option,"* ]] || {
      printf 'Media work filesystem is missing mount option %s.\n' "$option" >&2
      return 1
    }
  done
  owner="$(stat -c '%u:%g' "$configured")" || return 1
  mode="$(stat -c '%a' "$configured")" || return 1
  [[ "$owner" == "0:0" && "$mode" == "755" ]] || {
    printf 'Media work mount must be root-owned with mode 0755.\n' >&2
    return 1
  }
  [[ -f "$configured/$MEDIA_WORK_SENTINEL" && ! -L "$configured/$MEDIA_WORK_SENTINEL" ]] || {
    printf 'Media work mount sentinel is missing or unsafe.\n' >&2
    return 1
  }
  sentinel_value="$(cat -- "$configured/$MEDIA_WORK_SENTINEL")" || return 1
  [[ "$sentinel_value" == "$MEDIA_WORK_SENTINEL_VALUE" ]] || {
    printf 'Media work mount sentinel has an invalid value.\n' >&2
    return 1
  }
  owner="$(stat -c '%u:%g' "$configured/$MEDIA_WORK_SENTINEL")" || return 1
  mode="$(stat -c '%a' "$configured/$MEDIA_WORK_SENTINEL")" || return 1
  [[ "$owner" == "0:0" && "$mode" == "444" ]] || {
    printf 'Media work mount sentinel must be root-owned with mode 0444.\n' >&2
    return 1
  }
  [[ -d "$configured/work" && ! -L "$configured/work" && -w "$configured/work" ]] || {
    printf 'Media work job directory is missing, unsafe, or not writable.\n' >&2
    return 1
  }
  owner="$(stat -c '%u:%g' "$configured/work")" || return 1
  mode="$(stat -c '%a' "$configured/work")" || return 1
  [[ "$owner" == "1001:1001" && "$mode" == "700" ]] || {
    printf 'Media work job directory must be owned by UID/GID 1001 with mode 0700.\n' >&2
    return 1
  }
}

verify_ai_api_key_file() {
  local env_file="$1"
  local configured resolved owner mode size inline_value

  configured="$(production_env_value "$env_file" AI_API_KEY_SOURCE_FILE)" || return 1
  [[ "$configured" == /* && -f "$configured" && ! -L "$configured" ]] || {
    printf 'AI_API_KEY_SOURCE_FILE must be an existing regular non-symlink file.\n' >&2
    return 1
  }
  resolved="$(readlink -f -- "$configured")" || return 1
  [[ "$resolved" == "$configured" ]] || {
    printf 'AI_API_KEY_SOURCE_FILE must resolve to its exact configured path.\n' >&2
    return 1
  }
  owner="$(stat -c '%u:%g' "$configured")" || return 1
  mode="$(stat -c '%a' "$configured")" || return 1
  size="$(stat -c '%s' "$configured")" || return 1
  [[ "$owner" == "1001:1001" && "$mode" == "400" ]] || {
    printf 'AI_API_KEY_SOURCE_FILE must be owned by 1001:1001 with mode 0400.\n' >&2
    return 1
  }
  [[ "$size" =~ ^[0-9]+$ ]] && (( size <= 16384 )) || {
    printf 'AI_API_KEY_SOURCE_FILE must not exceed 16384 bytes.\n' >&2
    return 1
  }
  inline_value="$(awk -F= '$1 == "AI_API_KEY" { sub(/^[^=]*=/, ""); print; exit }' "$env_file")" || return 1
  [[ -z "$inline_value" ]] || {
    printf 'AI_API_KEY must be removed from production; use AI_API_KEY_SOURCE_FILE.\n' >&2
    return 1
  }
}

verify_release_environment_security() {
  local env_file="$1"
  local directory directory_mode directory_mode_value resolved_directory

  [[ -f "$env_file" && ! -L "$env_file" ]] || {
    printf 'Production environment must be a regular non-symlink file: %s\n' "$env_file" >&2
    return 1
  }
  [[ -r "$env_file" ]] || {
    printf 'Production environment is not readable: %s\n' "$env_file" >&2
    return 1
  }
  [[ "$(stat -c '%u:%g' "$env_file")" == "0:0" ]] || {
    printf 'Production environment must be owned by root:root: %s\n' "$env_file" >&2
    return 1
  }
  [[ "$(stat -c '%a' "$env_file")" =~ ^(400|600)$ ]] || {
    printf 'Production environment mode must be 0400 or 0600: %s\n' "$env_file" >&2
    return 1
  }
  if LC_ALL=C grep -q $'\r' "$env_file"; then
    printf 'Production environment must use LF line endings: %s\n' "$env_file" >&2
    return 1
  fi
  production_env_value "$env_file" APP_IMAGE_TAG >/dev/null || return 1
  directory="$(dirname -- "$env_file")"
  [[ -d "$directory" && ! -L "$directory" ]] || {
    printf 'Production environment directory must be a regular directory: %s\n' "$directory" >&2
    return 1
  }
  resolved_directory="$(readlink -f -- "$directory")" || return 1
  [[ "$resolved_directory" == "$directory" ]] || {
    printf 'Production environment directory must not traverse symlinks: %s\n' "$directory" >&2
    return 1
  }
  [[ "$(stat -c '%u:%g' "$directory")" == "0:0" ]] || {
    printf 'Production environment directory must be owned by root:root: %s\n' "$directory" >&2
    return 1
  }
  directory_mode="$(stat -c '%a' "$directory")" || return 1
  [[ "$directory_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  directory_mode_value=$((8#$directory_mode))
  (( (directory_mode_value & 8#022) == 0 )) || {
    printf 'Production environment directory must not be group- or world-writable: %s\n' "$directory" >&2
    return 1
  }
}

assert_release_environment_writable() {
  local env_file="$1"
  local directory probe

  verify_release_environment_security "$env_file" || return 1
  directory="$(dirname -- "$env_file")"
  probe="$(mktemp "${directory}/.q-academy-env-write.XXXXXX")" || {
    printf 'Production environment directory is not atomically writable: %s\n' "$directory" >&2
    return 1
  }
  rm -f -- "$probe"
}

persist_app_image_tag() {
  local env_file="$1"
  local release_tag="$2"
  local postgres_image="${3:-}"
  local directory basename temporary

  assert_release_environment_writable "$env_file" || return 1
  [[ "$release_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || {
    printf 'Refusing to persist an invalid source-bound release tag.\n' >&2
    return 1
  }
  if [[ -n "$postgres_image" ]]; then
    [[ "$postgres_image" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || {
      printf 'Refusing to persist an invalid PostgreSQL image digest.\n' >&2
      return 1
    }
    production_env_value "$env_file" POSTGRES_IMAGE >/dev/null || return 1
  fi

  directory="$(dirname -- "$env_file")"
  basename="$(basename -- "$env_file")"
  umask 077
  temporary="$(mktemp "${directory}/.${basename}.tmp.XXXXXX")" || return 1
  if ! awk -v release_tag="$release_tag" -v postgres_image="$postgres_image" '
    /^APP_IMAGE_TAG=/ { print "APP_IMAGE_TAG=" release_tag; next }
    /^POSTGRES_IMAGE=/ && postgres_image != "" {
      print "POSTGRES_IMAGE=" postgres_image
      next
    }
    { print }
  ' "$env_file" >"$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! chmod --reference="$env_file" "$temporary" ||
    ! chown --reference="$env_file" "$temporary" ||
    ! sync "$temporary" ||
    ! mv -f -- "$temporary" "$env_file"; then
    rm -f -- "$temporary"
    return 1
  fi
  sync -f "$directory"
}
