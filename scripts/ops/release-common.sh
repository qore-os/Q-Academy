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
PENDING_RELEASE_SCHEMA_VERSION=2
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
AI_PROVIDER_PREFLIGHT_TIMEOUT_SECONDS=90
STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS=1800
AI_TEXT_RUNTIME_CONTRACT=gpt-5.6-terra-chat-completions-v1
TRANSCRIPTION_RUNTIME_CONTRACT=openai-diarized-transcription-v1
DATABASE_SCHEMA_CONTRACT_LABEL=com.q-academy.database-schema-contract
LEGACY_COURSE_SECTIONS_SCHEMA_CONTRACT=legacy-course-sections
FLAT_COURSE_LESSONS_SCHEMA_CONTRACT=flat-course-lessons-v1
FLAT_COURSE_LESSONS_MIGRATION_TIMESTAMP=1786632153991
DATABASE_SCHEMA_RUNTIME_COMPONENTS=(
  app
  tenant-ops
  media-runner
  media-preflight
  dispatcher
)
MEDIA_STORAGE_RELEASE_STATE_VARIABLES=(
  MEDIA_S3_COMPATIBILITY_MODE
  MEDIA_S3_ENDPOINT
  MEDIA_S3_REGION
  MEDIA_S3_BUCKET
  MEDIA_S3_FORCE_PATH_STYLE
)

verify_ai_runtime_contract_images() {
  local release_tag="$1"
  local component image text_contract transcript_contract
  [[ "$release_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  for component in app tenant-ops media-runner media-preflight; do
    image="q-academy-${component}:${release_tag}"
    text_contract="$(docker image inspect --format '{{ index .Config.Labels "com.q-academy.ai-text-contract" }}' "$image" 2>/dev/null)" || return 1
    transcript_contract="$(docker image inspect --format '{{ index .Config.Labels "com.q-academy.transcription-contract" }}' "$image" 2>/dev/null)" || return 1
    [[ "$text_contract" == "$AI_TEXT_RUNTIME_CONTRACT" ]] || return 1
    [[ "$transcript_contract" == "$TRANSCRIPTION_RUNTIME_CONTRACT" ]] || return 1
  done
}

release_course_hierarchy_contract_state() {
  local release_tag="$1"
  local component image contract component_contract release_contract=""
  [[ "$release_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  for component in "${DATABASE_SCHEMA_RUNTIME_COMPONENTS[@]}"; do
    image="q-academy-${component}:${release_tag}"
    contract="$(
      docker image inspect --format \
        "{{ index .Config.Labels \"$DATABASE_SCHEMA_CONTRACT_LABEL\" }}" \
        "$image" 2>/dev/null
    )" || return 1
    case "$contract" in
      "$FLAT_COURSE_LESSONS_SCHEMA_CONTRACT")
        component_contract="$FLAT_COURSE_LESSONS_SCHEMA_CONTRACT"
        ;;
      ""|'<no value>'|"$LEGACY_COURSE_SECTIONS_SCHEMA_CONTRACT")
        component_contract="$LEGACY_COURSE_SECTIONS_SCHEMA_CONTRACT"
        ;;
      *)
        printf 'Release image %s has an unknown database schema contract.\n' "$image" >&2
        return 1
        ;;
    esac
    if [[ -n "$release_contract" && "$release_contract" != "$component_contract" ]]; then
      printf 'Release %s mixes incompatible database schema contracts.\n' "$release_tag" >&2
      return 1
    fi
    release_contract="$component_contract"
  done
  printf '%s' "$release_contract"
}

verify_database_schema_contract_images() {
  local release_tag="$1"
  local release_contract
  release_contract="$(release_course_hierarchy_contract_state "$release_tag")" || return 1
  [[ "$release_contract" == "$FLAT_COURSE_LESSONS_SCHEMA_CONTRACT" ]]
}

database_course_hierarchy_contract_state() {
  local state
  (($# > 0)) || {
    printf 'Compose command is required to inspect the database schema contract.\n' >&2
    return 1
  }
  state="$(
    "$@" exec -T \
      -e "Q_ACADEMY_FLAT_COURSE_MIGRATION_TIMESTAMP=$FLAT_COURSE_LESSONS_MIGRATION_TIMESTAMP" \
      postgres sh -euc '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      migration_table="$(
        psql \
          --host=127.0.0.1 \
          --username="$POSTGRES_USER" \
          --dbname="$POSTGRES_DB" \
          --set=ON_ERROR_STOP=1 \
          --tuples-only \
          --no-align \
          --command="select to_regclass('\''drizzle.__drizzle_migrations'\'')"
      )"
      if [ -z "$migration_table" ]; then
        printf "legacy-course-sections\n"
        exit 0
      fi
      psql \
        --host=127.0.0.1 \
        --username="$POSTGRES_USER" \
        --dbname="$POSTGRES_DB" \
        --set=ON_ERROR_STOP=1 \
        --tuples-only \
        --no-align \
        --command="select case when coalesce(max(created_at), 0) >= $Q_ACADEMY_FLAT_COURSE_MIGRATION_TIMESTAMP then '\''flat-course-lessons-v1'\'' else '\''legacy-course-sections'\'' end from drizzle.__drizzle_migrations"
    ' | tr -d '[:space:]'
  )" || return 1
  case "$state" in
    legacy-course-sections|flat-course-lessons-v1)
      printf '%s' "$state"
      ;;
    *)
      printf 'Database returned an invalid course hierarchy contract state.\n' >&2
      return 1
      ;;
  esac
}

verify_release_database_schema_contract() {
  local release_tag="$1"
  local database_contract release_contract
  shift
  database_contract="$(database_course_hierarchy_contract_state "$@")" || return 1
  release_contract="$(release_course_hierarchy_contract_state "$release_tag")" || return 1
  [[ "$database_contract" == "$release_contract" ]] || {
    printf 'Database schema contract %s does not match release %s contract %s. Use the exact compatible release or restore its verified database backup; a manual compatibility override is not accepted.\n' \
      "$database_contract" "$release_tag" "$release_contract" >&2
    return 1
  }
}

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

release_backup_evidence_sha256() {
  local from_tag="$1"
  local to_tag="$2"
  local controller_commit="$3"
  local backup_required="$4"
  local backup_path="$5"
  local backup_sha256="$6"
  local restore_verified="$7"

  printf '%s\0' \
    q-academy-predeploy-backup-v1 \
    "$from_tag" \
    "$to_tag" \
    "$controller_commit" \
    "$backup_required" \
    "$backup_path" \
    "$backup_sha256" \
    "$restore_verified" |
    sha256sum |
    awk '{ print $1 }'
}

verify_release_backup_evidence() {
  local from_tag="$1"
  local to_tag="$2"
  local controller_commit="$3"
  local backup_required="$4"
  local backup_path="$5"
  local backup_sha256="$6"
  local restore_verified="$7"
  local evidence_sha256="$8"
  local resolved_path actual_output actual_sha256 expected_evidence_sha256

  [[ -z "$from_tag" || "$from_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  [[ "$to_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || return 1
  [[ "$controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || return 1
  [[ "$to_tag" == "git-${controller_commit}" ]] || return 1
  [[ "$backup_required" == "true" || "$backup_required" == "false" ]] || return 1
  [[ "$restore_verified" == "true" || "$restore_verified" == "false" ]] || return 1
  [[ "$evidence_sha256" =~ ^[a-f0-9]{64}$ ]] || return 1

  if [[ "$backup_required" == "true" ]]; then
    [[ "$restore_verified" == "true" ]] || {
      printf 'Required pre-deployment backup lacks restore-verification evidence.\n' >&2
      return 1
    }
    [[ "$backup_path" =~ ^/[A-Za-z0-9._/-]+/q-academy-[0-9]{8}T[0-9]{6}Z[.]dump$ ]] || {
      printf 'Pre-deployment backup path is invalid.\n' >&2
      return 1
    }
    [[ "$backup_path" != *'/../'* && "$backup_path" != */.. && "$backup_path" != *'//'* ]] || {
      printf 'Pre-deployment backup path is not canonical.\n' >&2
      return 1
    }
    [[ "$backup_sha256" =~ ^[a-f0-9]{64}$ ]] || {
      printf 'Pre-deployment backup digest is invalid.\n' >&2
      return 1
    }
    [[ -f "$backup_path" && ! -L "$backup_path" ]] || {
      printf 'Pre-deployment backup is missing or unsafe: %s\n' "$backup_path" >&2
      return 1
    }
    resolved_path="$(readlink -f -- "$backup_path")" || return 1
    [[ "$resolved_path" == "$backup_path" ]] || {
      printf 'Pre-deployment backup path does not resolve to itself.\n' >&2
      return 1
    }
    [[ "$(stat -c '%u:%g:%a' -- "$backup_path")" == "0:0:600" ]] || {
      printf 'Pre-deployment backup must be root-owned with mode 0600.\n' >&2
      return 1
    }
    [[ -s "$backup_path" ]] || {
      printf 'Pre-deployment backup is empty.\n' >&2
      return 1
    }
    actual_output="$(sha256sum -- "$backup_path")" || return 1
    actual_sha256="${actual_output%% *}"
    [[ "$actual_sha256" == "$backup_sha256" ]] || {
      printf 'Pre-deployment backup digest does not match the pending release evidence.\n' >&2
      return 1
    }
  else
    [[ "$restore_verified" == "false" && -z "$backup_path" && -z "$backup_sha256" ]] || {
      printf 'Skipped pre-deployment backup contains contradictory evidence.\n' >&2
      return 1
    }
  fi

  expected_evidence_sha256="$(
    release_backup_evidence_sha256 \
      "$from_tag" \
      "$to_tag" \
      "$controller_commit" \
      "$backup_required" \
      "$backup_path" \
      "$backup_sha256" \
      "$restore_verified"
  )" || return 1
  [[ "$evidence_sha256" == "$expected_evidence_sha256" ]] || {
    printf 'Pre-deployment backup evidence is not bound to this release target.\n' >&2
    return 1
  }
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
  local schema from_tag to_tag controller_commit phase migrations_may_have_run
  local backup_required backup_path backup_sha256 restore_verified evidence_sha256 created_at

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
      allowed["PREDEPLOY_BACKUP_REQUIRED"] = 1
      allowed["PREDEPLOY_BACKUP_PATH"] = 1
      allowed["PREDEPLOY_BACKUP_SHA256"] = 1
      allowed["PREDEPLOY_BACKUP_RESTORE_VERIFIED"] = 1
      allowed["PREDEPLOY_BACKUP_EVIDENCE_SHA256"] = 1
      allowed["CREATED_AT"] = 1
    }
    !($1 in allowed) { invalid = 1 }
    END { exit (NR == 12 && !invalid) ? 0 : 1 }
  ' "$marker_file" || {
    printf 'Pending release marker must contain exactly the twelve contract fields.\n' >&2
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
  backup_required="$(production_env_value "$marker_file" PREDEPLOY_BACKUP_REQUIRED)" || return 1
  backup_path="$(production_env_value "$marker_file" PREDEPLOY_BACKUP_PATH)" || return 1
  backup_sha256="$(production_env_value "$marker_file" PREDEPLOY_BACKUP_SHA256)" || return 1
  restore_verified="$(production_env_value "$marker_file" PREDEPLOY_BACKUP_RESTORE_VERIFIED)" || return 1
  evidence_sha256="$(production_env_value "$marker_file" PREDEPLOY_BACKUP_EVIDENCE_SHA256)" || return 1
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
  verify_release_backup_evidence \
    "$from_tag" \
    "$to_tag" \
    "$controller_commit" \
    "$backup_required" \
    "$backup_path" \
    "$backup_sha256" \
    "$restore_verified" \
    "$evidence_sha256" || return 1
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
  local backup_required="$5"
  local backup_path="$6"
  local backup_sha256="$7"
  local restore_verified="$8"
  local evidence_sha256="$9"
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
  verify_release_backup_evidence \
    "$from_tag" \
    "$to_tag" \
    "$controller_commit" \
    "$backup_required" \
    "$backup_path" \
    "$backup_sha256" \
    "$restore_verified" \
    "$evidence_sha256" || return 1
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
    printf 'PREDEPLOY_BACKUP_REQUIRED=%s\n' "$backup_required"
    printf 'PREDEPLOY_BACKUP_PATH=%s\n' "$backup_path"
    printf 'PREDEPLOY_BACKUP_SHA256=%s\n' "$backup_sha256"
    printf 'PREDEPLOY_BACKUP_RESTORE_VERIFIED=%s\n' "$restore_verified"
    printf 'PREDEPLOY_BACKUP_EVIDENCE_SHA256=%s\n' "$evidence_sha256"
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
  local configured resolved owner mode size inline_value model

  model="$(production_env_value "$env_file" AI_MODEL)" || return 1
  [[ "$model" == "gpt-5.6-terra" ]] || {
    printf 'AI_MODEL must be exactly gpt-5.6-terra in production.\n' >&2
    return 1
  }

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

ai_api_key_file_is_configured() {
  local env_file="$1"
  local configured

  configured="$(production_env_value "$env_file" AI_API_KEY_SOURCE_FILE)" || return 2
  [[ -s "$configured" ]]
}

verify_openai_transcription_api_key_file() {
  local env_file="$1"
  local configured enabled resolved owner mode size inline_value legacy_value

  enabled="$(production_env_value "$env_file" MEDIA_TRANSCRIPTION_ENABLED)" || return 1
  [[ "$enabled" == "true" || "$enabled" == "false" ]] || {
    printf 'MEDIA_TRANSCRIPTION_ENABLED must be exactly true or false.\n' >&2
    return 1
  }

  configured="$(production_env_value "$env_file" OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE)" || return 1
  [[ "$configured" == /* && -f "$configured" && ! -L "$configured" ]] || {
    printf 'OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE must be an existing regular non-symlink file.\n' >&2
    return 1
  }
  resolved="$(readlink -f -- "$configured")" || return 1
  [[ "$resolved" == "$configured" ]] || {
    printf 'OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE must resolve to its exact configured path.\n' >&2
    return 1
  }
  owner="$(stat -c '%u:%g' "$configured")" || return 1
  mode="$(stat -c '%a' "$configured")" || return 1
  size="$(stat -c '%s' "$configured")" || return 1
  [[ "$owner" == "1001:1001" && "$mode" == "400" ]] || {
    printf 'OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE must be owned by 1001:1001 with mode 0400.\n' >&2
    return 1
  }
  [[ "$size" =~ ^[0-9]+$ ]] && (( size <= 1024 )) || {
    printf 'OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE must not exceed 1024 bytes.\n' >&2
    return 1
  }
  if [[ "$enabled" == "true" ]]; then
    (( size >= 8 )) || {
      printf 'Enabled transcription requires a non-empty bounded provider credential.\n' >&2
      return 1
    }
  else
    (( size == 0 )) || {
      printf 'Disabled transcription requires an empty credential placeholder file.\n' >&2
      return 1
    }
  fi

  inline_value="$(awk -F= '$1 == "OPENAI_TRANSCRIPTION_API_KEY" { sub(/^[^=]*=/, ""); print; exit }' "$env_file")" || return 1
  legacy_value="$(awk -F= '$1 == "OPENAI_API_KEY" { sub(/^[^=]*=/, ""); print; exit }' "$env_file")" || return 1
  [[ -z "$inline_value" && -z "$legacy_value" ]] || {
    printf 'Inline OpenAI transcription credentials must be removed from production.\n' >&2
    return 1
  }
}

verify_ai_credential_separation() {
  local env_file="$1"
  local enabled ai_key_file transcription_key_file comparison_status

  enabled="$(production_env_value "$env_file" MEDIA_TRANSCRIPTION_ENABLED)" || return 1
  [[ "$enabled" == "true" || "$enabled" == "false" ]] || return 1
  if [[ "$enabled" == "false" ]]; then
    return 0
  fi

  ai_key_file="$(production_env_value "$env_file" AI_API_KEY_SOURCE_FILE)" || return 1
  transcription_key_file="$(production_env_value "$env_file" OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE)" || return 1

  if python3 - "$ai_key_file" "$transcription_key_file" <<'PY'
import hmac
import os
import stat
import sys


def fail() -> None:
    raise SystemExit(2)


def open_stable_regular_file(path: str) -> tuple[int, os.stat_result]:
    if not os.path.isabs(path) or os.path.realpath(path) != path:
        fail()
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        fail()
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    opened = os.fstat(descriptor)
    if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
        os.close(descriptor)
        fail()
    return descriptor, opened


def read_bounded(descriptor: int, maximum: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = os.read(descriptor, min(4096, maximum + 1 - total))
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum:
            fail()


def path_still_names_open_file(path: str, opened: os.stat_result) -> bool:
    current = os.lstat(path)
    return stat.S_ISREG(current.st_mode) and (
        current.st_dev,
        current.st_ino,
    ) == (opened.st_dev, opened.st_ino)


descriptors: list[int] = []
try:
    text_path, transcription_path = sys.argv[1:3]
    if text_path == transcription_path:
        raise SystemExit(10)

    text_fd, text_opened = open_stable_regular_file(text_path)
    descriptors.append(text_fd)
    transcription_fd, transcription_opened = open_stable_regular_file(transcription_path)
    descriptors.append(transcription_fd)

    if text_opened.st_size > 16384 or not 8 <= transcription_opened.st_size <= 1024:
        fail()

    text_credential = read_bounded(text_fd, 16384)
    transcription_credential = read_bounded(transcription_fd, 1024)
    if not path_still_names_open_file(text_path, text_opened):
        fail()
    if not path_still_names_open_file(transcription_path, transcription_opened):
        fail()
    if hmac.compare_digest(text_credential, transcription_credential):
        raise SystemExit(10)
except (OSError, ValueError):
    fail()
finally:
    for descriptor in descriptors:
        os.close(descriptor)
PY
  then
    return 0
  else
    comparison_status=$?
  fi

  if (( comparison_status == 10 )); then
    printf 'Enabled transcription requires a credential distinct from the text AI credential.\n' >&2
  else
    printf 'AI credential separation could not be verified safely.\n' >&2
  fi
  return 1
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
