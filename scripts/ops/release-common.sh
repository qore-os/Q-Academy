#!/usr/bin/env bash

PINNED_IMAGE_VARIABLES=(
  NODE_IMAGE
  POSTGRES_IMAGE
  CLAMAV_IMAGE
  CURL_IMAGE
  PROMETHEUS_IMAGE
  NODE_EXPORTER_IMAGE
  CADDY_IMAGE
)

RELEASE_IMAGE_MANIFEST_VARIABLES=(
  Q_ACADEMY_APP_IMAGE
  Q_ACADEMY_MIGRATOR_IMAGE
  Q_ACADEMY_KEY_ROTATION_IMAGE
  Q_ACADEMY_TENANT_OPS_IMAGE
  Q_ACADEMY_MEDIA_RUNNER_IMAGE
  Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE
  Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE
)

MEDIA_WORK_MOUNT=/var/lib/q-academy-media-processing
MEDIA_WORK_SENTINEL=.q-academy-media-work-root
MEDIA_WORK_SENTINEL_VALUE=q-academy-media-processing-v1
RELEASE_LOCK_FILE_DEFAULT=/var/lock/q-academy-release.lock
BACKUP_LOCK_FILE_DEFAULT=/var/lock/q-academy-backup.lock
DATABASE_WRITER_SERVICES=(scheduler media-worker media-maintenance app media-runner)
DATABASE_RUNTIME_SERVICES=(app media-runner)
DATABASE_DISPATCHER_SERVICES=(scheduler media-worker media-maintenance)
DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS=1800
S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS=1200
MEDIA_PROCESSING_PREFLIGHT_TIMEOUT_SECONDS=1800
STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS=1800
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

assert_release_environment_writable() {
  local env_file="$1"
  local directory probe

  [[ -f "$env_file" && ! -L "$env_file" ]] || {
    printf 'Production environment must be a regular non-symlink file: %s\n' "$env_file" >&2
    return 1
  }
  [[ -r "$env_file" ]] || {
    printf 'Production environment is not readable: %s\n' "$env_file" >&2
    return 1
  }
  production_env_value "$env_file" APP_IMAGE_TAG >/dev/null || return 1
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
  local directory basename temporary

  assert_release_environment_writable "$env_file" || return 1
  [[ "$release_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || {
    printf 'Refusing to persist an invalid source-bound release tag.\n' >&2
    return 1
  }

  directory="$(dirname -- "$env_file")"
  basename="$(basename -- "$env_file")"
  umask 077
  temporary="$(mktemp "${directory}/.${basename}.tmp.XXXXXX")" || return 1
  if ! awk -v release_tag="$release_tag" '
    /^APP_IMAGE_TAG=/ { print "APP_IMAGE_TAG=" release_tag; next }
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
}
