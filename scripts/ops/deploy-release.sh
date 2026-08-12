#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"

release_tag="${1:-${RELEASE_TAG:-}}"
env_file="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"
compose_file="${COMPOSE_FILE:-compose.production.yml}"
state_file="${RELEASE_STATE_FILE:-/var/lib/q-academy/releases/current.env}"
pending_file="$PENDING_RELEASE_FILE_DEFAULT"
lock_file="${RELEASE_LOCK_FILE:-$RELEASE_LOCK_FILE_DEFAULT}"
backup_lock_file="${BACKUP_LOCK_FILE:-$BACKUP_LOCK_FILE_DEFAULT}"
requested_app_domain="${APP_DOMAIN:-}"
dry_run="${DRY_RUN:-false}"
release_image_mode="${RELEASE_IMAGE_MODE:-verified-manifest}"
release_image_manifest="${RELEASE_IMAGE_MANIFEST:-}"
release_attestation_bundle="${RELEASE_IMAGE_ATTESTATION_BUNDLE:-}"
release_github_repository="${RELEASE_GITHUB_REPOSITORY:-}"
release_signer_workflow="${RELEASE_SIGNER_WORKFLOW:-}"

fail() { printf 'Release aborted: %s\n' "$*" >&2; exit 1; }
run() {
  if [[ "$dry_run" == "true" ]]; then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}
run_with_timeout() {
  local timeout_seconds="$1"
  shift
  [[ "$timeout_seconds" =~ ^[1-9][0-9]{0,4}$ ]] || fail "preflight timeout is invalid"
  run timeout --foreground --signal=TERM --kill-after=30s "${timeout_seconds}s" "$@"
}

release_completed=false
writers_stopped=false
caddy_activation_started=false
egress_enforcement_started=false
pending_release_guarded=false
release_lock_acquired=false
cleanup_failed_release() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$release_completed" != "true" ]]; then
    if [[ "$pending_release_guarded" == "true" && "$release_lock_acquired" == "true" && "$dry_run" != "true" ]]; then
      if stop_production_compose_project "$PRODUCTION_COMPOSE_PROJECT" >/dev/null 2>&1; then
        printf 'Release recovery failed with a pending marker. Every Q-Academy container was stopped for investigation.\n' >&2
      else
        printf 'Release recovery failed with a pending marker and the emergency Q-Academy stop could not be verified.\n' >&2
      fi
    elif [[ "$egress_enforcement_started" == "true" ]]; then
      if stop_production_compose_project "$PRODUCTION_COMPOSE_PROJECT" >/dev/null 2>&1; then
        printf 'Release failed after host-egress enforcement began. Every Q-Academy container was stopped for investigation.\n' >&2
      else
        printf 'Release failed after host-egress enforcement began and the emergency Q-Academy stop could not be verified.\n' >&2
      fi
    elif [[ "$writers_stopped" == "true" || "$caddy_activation_started" == "true" ]]; then
      "${compose[@]}" stop -t 30 caddy >/dev/null 2>&1 || true
      if [[ "$writers_stopped" == "true" ]]; then
        "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}" >/dev/null 2>&1 || true
        "${strato_compose[@]}" stop -t 30 "$STRATO_PRIVACY_SWEEPER_SERVICE" >/dev/null 2>&1 || true
        printf 'Release failed. Caddy and all application, media, and STRATO deletion writers remain stopped for investigation.\n' >&2
      fi
    fi
  fi
  exit "$exit_code"
}
trap cleanup_failed_release EXIT

if [[ -e "$pending_file" || -L "$pending_file" ]]; then
  pending_release_guarded=true
fi
command -v flock >/dev/null 2>&1 || fail "required command is missing: flock"
if [[ "$dry_run" != "true" && "$EUID" -ne 0 ]]; then
  fail "production release must run as root so the host egress policy can be enforced"
fi
[[ "$lock_file" == /* ]] || fail "release lock path must be absolute"
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
flock -n 9 || fail "another release operation is active"
release_lock_acquired=true

[[ -f "$env_file" ]] || fail "environment file not found: $env_file"
[[ -f "$compose_file" ]] || fail "Compose file not found: $compose_file"
[[ -x scripts/ops/postgres-backup.sh ]] || fail "backup script is not executable"

for command in docker curl findmnt flock git python3 sync timeout; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "working directory is not a Git repository"
[[ "$(cd -- "$repository_root" && pwd -P)" == "$(pwd -P)" ]] || fail "release must run from the repository root"
head_commit="$(git rev-parse --verify HEAD^{commit})" || fail "Git HEAD is not a commit"
[[ "$head_commit" =~ ^[a-f0-9]{40,64}$ ]] || fail "Git HEAD has an unsupported object id"
expected_tag="git-${head_commit}"
[[ "$release_tag" == "$expected_tag" ]] || fail "release tag must equal git-<full HEAD>: $expected_tag"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "Git worktree must be clean, including untracked files"

assert_release_environment_writable "$env_file" || fail "production environment cannot be updated atomically"
app_domain="$(production_env_value "$env_file" APP_DOMAIN)" || fail "production APP_DOMAIN is invalid"
[[ -n "$app_domain" && "$app_domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "production APP_DOMAIN is invalid"
[[ -z "$requested_app_domain" || "$requested_app_domain" == "$app_domain" ]] || fail "APP_DOMAIN override disagrees with the production environment"
verify_and_export_pinned_images "$env_file" || fail "production image pins are invalid"
verify_media_work_mount "$env_file" || fail "media work filesystem is invalid"
verify_ai_api_key_file "$env_file" || fail "AI API key file is invalid"
verify_caddy_sites_directory "$env_file" || fail "external Caddy sites directory is invalid"
configure_media_s3_release_services "$env_file" || fail "media S3 compatibility mode is invalid"

[[ "$lock_file" != "$backup_lock_file" ]] || fail "release and backup lock files must be distinct"

previous_tag=""
state_file_present=false
media_storage_identity_changed=false
legacy_release_state_dry_run=false
if [[ -e "$state_file" || -L "$state_file" ]]; then
  [[ -f "$state_file" && ! -L "$state_file" ]] || fail "release state must be a regular non-symlink file: $state_file"
  [[ "$(stat -c '%u:%g:%a' "$state_file")" == "0:0:600" ]] || fail "release state must be root-owned with mode 0600"
  state_file_present=true
  state_schema="$(production_env_value "$state_file" SCHEMA_VERSION)" || fail "release state schema is invalid"
  if [[ "$state_schema" == "$LEGACY_RELEASE_STATE_SCHEMA_VERSION" ]]; then
    if [[ "$dry_run" == "true" ]]; then
      upgrade_legacy_release_state "$state_file" "$env_file" false ||
        fail "legacy release state could not be bound to the active media storage identity"
      legacy_release_state_dry_run=true
      state_schema="$RELEASE_STATE_SCHEMA_VERSION"
      printf 'DRY-RUN: validated legacy release state upgrade without persisting it\n'
    else
      upgrade_legacy_release_state "$state_file" "$env_file" ||
        fail "legacy release state could not be bound to the active media storage identity"
      state_schema="$(production_env_value "$state_file" SCHEMA_VERSION)" || fail "upgraded release state schema is invalid"
    fi
  fi
  [[ "$state_schema" == "$RELEASE_STATE_SCHEMA_VERSION" ]] || fail "release state schema is unsupported"
  if [[ "$legacy_release_state_dry_run" != "true" ]]; then
    validate_media_storage_release_state "$state_file" || fail "release state media storage identity is invalid"
  fi
  state_controller_commit="$(production_env_value "$state_file" CONTROLLER_COMMIT)" || fail "release state CONTROLLER_COMMIT is invalid"
  [[ "$state_controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid controller commit"
  previous_tag="$(production_env_value "$state_file" CURRENT_TAG)" || fail "release state CURRENT_TAG is invalid"
  [[ "$previous_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid current tag"
  if [[ "$legacy_release_state_dry_run" != "true" ]] &&
     ! media_storage_release_state_matches "$state_file" "$env_file"; then
    media_storage_identity_changed=true
  fi
fi
configured_tag="$(production_env_value "$env_file" APP_IMAGE_TAG)" || fail "APP_IMAGE_TAG is invalid"
[[ -z "$configured_tag" || "$configured_tag" =~ ^git-[a-f0-9]{40,64}$ ]] ||
  fail "production APP_IMAGE_TAG is not a valid source-bound release tag"

resume_failed_release=false
pending_from_tag=""
if [[ -e "$pending_file" || -L "$pending_file" ]]; then
  validate_pending_release_marker "$pending_file" || fail "pending release marker is invalid"
  pending_from_tag="$(production_env_value "$pending_file" FROM_TAG)" || fail "pending release FROM_TAG is invalid"
  pending_to_tag="$(production_env_value "$pending_file" TO_TAG)" || fail "pending release TO_TAG is invalid"
  pending_controller_commit="$(production_env_value "$pending_file" CONTROLLER_COMMIT)" || fail "pending release CONTROLLER_COMMIT is invalid"
  [[ "$pending_to_tag" == "$release_tag" ]] || fail "pending release belongs to a different target"
  [[ "$pending_controller_commit" == "$head_commit" ]] || fail "pending release belongs to a different controller checkout"
  [[ "${CONFIRM_RESUME_FAILED_RELEASE:-}" == "$pending_to_tag" ]] ||
    fail "CONFIRM_RESUME_FAILED_RELEASE must equal the pending TO_TAG"
  if [[ "$state_file_present" == "true" ]]; then
    [[ "$previous_tag" == "$pending_from_tag" || "$previous_tag" == "$pending_to_tag" ]] ||
      fail "release state does not match the pending release transition"
    if [[ "$previous_tag" == "$pending_to_tag" && "$configured_tag" != "$pending_to_tag" ]]; then
      fail "completed pending release state requires its target APP_IMAGE_TAG"
    fi
    if [[ "$previous_tag" == "$pending_to_tag" && "$state_controller_commit" != "$pending_controller_commit" ]]; then
      fail "completed pending release state belongs to a different controller"
    fi
  else
    [[ -z "$pending_from_tag" ]] || fail "pending release FROM_TAG requires an active release state"
  fi
  [[ "$configured_tag" == "$pending_from_tag" || "$configured_tag" == "$pending_to_tag" ]] ||
    fail "production APP_IMAGE_TAG does not match the pending release transition"
  previous_tag="$pending_from_tag"
  resume_failed_release=true
else
  if [[ -n "$previous_tag" && "$configured_tag" != "$previous_tag" ]]; then
    fail "release state and production APP_IMAGE_TAG disagree"
  fi
  if [[ -z "$configured_tag" ]]; then
    [[ "$state_file_present" == "false" ]] || fail "release state exists while production APP_IMAGE_TAG is empty"
  elif [[ -z "$previous_tag" ]]; then
    previous_tag="$configured_tag"
  fi
  [[ "$previous_tag" != "$release_tag" ]] || fail "release target is already active"
fi
initial_install=false
if [[ -z "$previous_tag" ]]; then
  initial_install=true
fi

export APP_IMAGE_TAG="$release_tag"
compose=(docker compose --env-file "$env_file" -f "$compose_file" "${MEDIA_S3_COMPOSE_PROFILE_ARGS[@]}")
strato_compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile strato)
monitoring_compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile monitoring)

run docker build --pull --target release-verifier \
  --build-arg "NODE_IMAGE=$NODE_IMAGE" \
  --tag q-academy-release-verifier:local .
run docker run --rm --network none \
  --volume "$PWD:/workspace:ro" \
  --workdir /workspace \
  q-academy-release-verifier:local

verified_local_release_images=()
for component in "${RELEASE_IMAGE_COMPONENTS[@]}"; do
  verified_local_release_images+=("q-academy-$component:$release_tag")
done
local_build_release_images=("${verified_local_release_images[@]:1}")
target_release_images=()
verified_postgres_image=""
case "$release_image_mode" in
  verified-manifest)
    [[ -n "$release_image_manifest" ]] || fail "RELEASE_IMAGE_MANIFEST is required in verified-manifest mode"
    for command in sha256sum gh; do
      command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
    done
    release_image_checksum="${RELEASE_IMAGE_MANIFEST_SHA256_FILE:-${release_image_manifest}.sha256}"
    release_attestation_bundle="${release_attestation_bundle:-$(dirname -- "$release_image_manifest")/release-images.intoto.jsonl}"
    [[ -f "$release_attestation_bundle" && ! -L "$release_attestation_bundle" ]] || fail "release attestation bundle is missing or unsafe"
    [[ -n "$release_github_repository" && "$release_github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "RELEASE_GITHUB_REPOSITORY must be owner/repository"
    [[ -n "$release_signer_workflow" && "$release_signer_workflow" =~ ^([A-Za-z0-9.-]+/)?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+\.ya?ml$ ]] || fail "RELEASE_SIGNER_WORKFLOW is invalid"
    manifest_directory="$(cd -- "$(dirname -- "$release_image_manifest")" && pwd -P)" || fail "manifest directory is unavailable"
    bundle_directory="$(cd -- "$(dirname -- "$release_attestation_bundle")" && pwd -P)" || fail "attestation directory is unavailable"
    [[ "$manifest_directory" == "$bundle_directory" ]] || fail "manifest and attestation bundle must share one physical directory"
    verify_release_image_manifest_checksum "$release_image_manifest" "$release_image_checksum" || fail "release image manifest checksum verification failed"
    run gh attestation verify "$release_image_manifest" \
      --repo "$release_github_repository" \
      --bundle "$release_attestation_bundle" \
      --signer-workflow "$release_signer_workflow" \
      --source-digest "$head_commit" \
      --deny-self-hosted-runners
    host_platform="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')" || fail "Docker server platform is unavailable"
    verify_release_image_manifest "$release_image_manifest" "$release_tag" "$host_platform" || fail "release image manifest is invalid"
    verified_postgres_image="$Q_ACADEMY_POSTGRES_IMAGE"
    export POSTGRES_IMAGE="$verified_postgres_image"
    run "${compose[@]}" config --quiet
    source_release_images=(
      "$Q_ACADEMY_POSTGRES_IMAGE"
      "$Q_ACADEMY_APP_IMAGE"
      "$Q_ACADEMY_MIGRATOR_IMAGE"
      "$Q_ACADEMY_KEY_ROTATION_IMAGE"
      "$Q_ACADEMY_TENANT_OPS_IMAGE"
      "$Q_ACADEMY_MEDIA_RUNNER_IMAGE"
      "$Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE"
      "$Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE"
      "$Q_ACADEMY_DISPATCHER_IMAGE"
      "$Q_ACADEMY_CADDY_IMAGE"
    )
    for index in "${!source_release_images[@]}"; do
      source_image="${source_release_images[$index]}"
      local_image="${verified_local_release_images[$index]}"
      run docker pull "$source_image"
      if [[ "$dry_run" != "true" ]]; then
        source_image_id="$(docker image inspect --format '{{.Id}}' "$source_image")" || fail "pulled release image is unavailable: $source_image"
        if local_image_id="$(docker image inspect --format '{{.Id}}' "$local_image" 2>/dev/null)"; then
          [[ "$local_image_id" == "$source_image_id" ]] || fail "local release tag points to different content: $local_image"
        else
          docker image tag "$source_image" "$local_image"
        fi
      else
        run docker image tag "$source_image" "$local_image"
      fi
    done
    target_release_images=("${verified_local_release_images[@]}")
    ;;
  local-build)
    run "${compose[@]}" config --quiet
    for image in "${local_build_release_images[@]}"; do
      if docker image inspect "$image" >/dev/null 2>&1; then
        fail "immutable release image already exists: $image"
      fi
    done
    run "${compose[@]}" build --pull app migrate key-rotation tenant-admin-ops media-runner media-preflight s3-app-principal-preflight scheduler caddy
    target_release_images=("${local_build_release_images[@]}")
    ;;
  *)
    fail "RELEASE_IMAGE_MODE must be verified-manifest or local-build"
    ;;
esac

for target_image in "${target_release_images[@]}"; do
  if [[ "$dry_run" == "true" ]]; then
    run docker image inspect "$target_image"
  else
    docker image inspect "$target_image" >/dev/null 2>&1 ||
      fail "target release image is not present locally: $target_image"
  fi
done

project_name="$(compose_project_name "${compose[@]}")" || fail "Compose project name is unavailable"
[[ "$project_name" == "$PRODUCTION_COMPOSE_PROJECT" ]] || fail "production Compose project must be exactly $PRODUCTION_COMPOSE_PROJECT"
run "${compose[@]}" create --no-build --no-recreate \
  "${RELEASE_NETWORK_BOOTSTRAP_SERVICES[@]}"
if [[ "$dry_run" != "true" ]]; then
  egress_enforcement_started=true
fi
run bash "$ROOT_DIR/scripts/ops/docker-egress-firewall.sh" apply \
  --project "$project_name"
run bash "$ROOT_DIR/scripts/ops/docker-egress-firewall.sh" verify \
  --project "$project_name"

media_bucket="$(production_env_value "$env_file" MEDIA_S3_BUCKET)" || fail "MEDIA_S3_BUCKET is invalid"
run "${compose[@]}" up -d --no-recreate --wait --wait-timeout 300 postgres
run "${compose[@]}" run --rm --no-deps database-config-preflight
run "${compose[@]}" run --rm --no-deps -e DATABASE_ROLE_MODE=validate database-role
run_with_timeout "$S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS" \
  "${compose[@]}" run --rm --no-deps s3-app-principal-preflight \
  --confirm-bucket "$media_bucket"

application_relation_count=1
if [[ "$initial_install" == "true" ]]; then
  if [[ "$dry_run" == "true" ]]; then
    printf 'DRY-RUN: inspect the fresh database for application relations before deciding whether a backup is required\n'
    application_relation_count=0
  else
    application_relation_count="$(
      "${compose[@]}" exec -T postgres sh -euc '
        export PGPASSWORD="$POSTGRES_PASSWORD"
        psql \
          --host=127.0.0.1 \
          --username="$POSTGRES_USER" \
          --dbname="$POSTGRES_DB" \
          --set=ON_ERROR_STOP=1 \
          --tuples-only \
          --no-align \
          --command="select count(*) from pg_class relation_record join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace where namespace_record.nspname in ('\''public'\'', '\''drizzle'\'') and relation_record.relkind in ('\''r'\'', '\''p'\'', '\''S'\'', '\''v'\'', '\''m'\'', '\''f'\'')"
      ' | tr -d '[:space:]'
    )"
  fi
fi
backup_decision="$(predeploy_backup_decision "$initial_install" "$application_relation_count")" || fail "could not determine the pre-deployment backup requirement"
mkdir -p "$(dirname "$backup_lock_file")"
exec 8>"$backup_lock_file"
[[ -f "$backup_lock_file" && ! -L "$backup_lock_file" ]] || fail "backup lock must be a regular non-symlink file"
flock -n 8 || fail "another backup or restore operation is active"
if [[ "$backup_decision" == "required" ]]; then
  run env \
    Q_ACADEMY_APP_IMAGE_TAG_OVERRIDE="$release_tag" \
    Q_ACADEMY_BACKUP_LOCK_FD=8 \
    BACKUP_LOCK_FILE="$backup_lock_file" \
    scripts/ops/postgres-backup.sh
else
  printf 'Fresh database has no application relations; no pre-deployment backup is required.\n'
fi

if [[ "$dry_run" != "true" ]]; then
  writers_stopped=true
fi
run "${compose[@]}" stop -t 30 caddy
run "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"
run "${strato_compose[@]}" rm --force --stop "$STRATO_PRIVACY_SWEEPER_SERVICE"
if [[ "$media_storage_identity_changed" == "true" ]]; then
  if [[ "$dry_run" == "true" ]]; then
    printf 'DRY-RUN: verify that no S3 media object, derivative, privacy export, or multipart session remains after stopping every writer before changing media storage identity\n'
  else
    active_media_storage_binding_count="$(
      "${compose[@]}" exec -T postgres sh -euc '
        export PGPASSWORD="$POSTGRES_PASSWORD"
        psql \
          --host=127.0.0.1 \
          --username="$POSTGRES_USER" \
          --dbname="$POSTGRES_DB" \
          --set=ON_ERROR_STOP=1 \
          --tuples-only \
          --no-align \
          --command="select ((select count(*) from public.media_upload_sessions) + (select count(*) from public.media_assets where storage_driver = '\''s3'\'' and (staging_deleted_at is null or storage_deleted_at is null)) + (select count(*) from public.media_asset_derivatives where storage_driver = '\''s3'\'') + (select count(*) from public.privacy_export_artifacts where storage_driver = '\''s3'\'' and deleted_at is null))::bigint"
      ' | tr -d '[:space:]'
    )"
    assert_media_storage_change_is_drained \
      "$state_file" "$env_file" "$active_media_storage_binding_count" ||
      fail "media storage change requires a verified migration or fully empty provider bindings"
  fi
fi
if [[ "$resume_failed_release" == "true" ]]; then
  printf 'Explicitly resuming pending release %s from %s; migrations may already have run.\n' \
    "$release_tag" "${previous_tag:-initial-install}"
else
  run write_pending_release_marker "$pending_file" "$previous_tag" "$release_tag" "$head_commit"
  if [[ "$dry_run" != "true" ]]; then
    pending_release_guarded=true
  fi
fi
run "${compose[@]}" up -d --wait --wait-timeout 900 postgres clamav
run_with_timeout "$MEDIA_PROCESSING_PREFLIGHT_TIMEOUT_SECONDS" \
  "${compose[@]}" run --rm --no-deps media-preflight \
  --confirm-bucket "$media_bucket"
run "${compose[@]}" run --rm --no-deps database-config-preflight
run "${compose[@]}" run --rm --no-deps database-role
run "${compose[@]}" run --rm --no-deps migrate
run "${compose[@]}" run --rm --no-deps database-permissions
run "${compose[@]}" up -d --no-deps --wait --wait-timeout 300 "${DATABASE_RUNTIME_SERVICES[@]}"
for runtime_service in "${DATABASE_RUNTIME_SERVICES[@]}"; do
  run "${compose[@]}" exec -T \
    -e "Q_ACADEMY_EXPECTED_RELEASE=$release_tag" \
    "$runtime_service" node -e \
    "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(async(response)=>{const body=await response.json().catch(()=>null);if(!response.ok||body?.data?.version!==process.env.Q_ACADEMY_EXPECTED_RELEASE)process.exit(1)}).catch(()=>process.exit(1))"
done
run "${compose[@]}" up -d --no-deps --wait \
  --wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \
  "${DATABASE_DISPATCHER_SERVICES[@]}"
if (( ${#MEDIA_S3_RELEASE_SERVICES[@]} > 0 )); then
  run "${compose[@]}" up -d --no-deps --wait \
    --wait-timeout "$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS" \
    "${MEDIA_S3_RELEASE_SERVICES[@]}"
fi
run "${monitoring_compose[@]}" up -d --no-deps --wait --wait-timeout 300 \
  "${OBSERVABILITY_RUNTIME_SERVICES[@]}"
run "${compose[@]}" run --rm --no-deps caddy-volume-init
if [[ "$dry_run" != "true" ]]; then
  caddy_activation_started=true
fi
run "${compose[@]}" up -d --no-deps --force-recreate --wait \
  --wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy
run verify_external_release_readiness "$app_domain" "$release_tag"
run "${compose[@]}" ps

if [[ "$dry_run" != "true" ]]; then
  persist_app_image_tag "$env_file" "$release_tag" "$verified_postgres_image" || fail "could not persist release image pins"
  mkdir -p "$(dirname "$state_file")"
  temporary_state="${state_file}.tmp.$$"
  umask 077
  {
    printf 'SCHEMA_VERSION=%s\n' "$RELEASE_STATE_SCHEMA_VERSION"
    printf 'CONTROLLER_COMMIT=%s\n' "$head_commit"
    printf 'CURRENT_TAG=%s\n' "$release_tag"
    printf 'PREVIOUS_TAG=%s\n' "$previous_tag"
    printf 'DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    write_media_storage_release_state "$env_file"
  } >"$temporary_state"
  sync "$temporary_state"
  mv -f "$temporary_state" "$state_file"
  sync -f "$(dirname -- "$state_file")"
  [[ "$(production_env_value "$env_file" APP_IMAGE_TAG)" == "$release_tag" ]] || fail "persisted APP_IMAGE_TAG is inconsistent"
  [[ "$(production_env_value "$state_file" CURRENT_TAG)" == "$release_tag" ]] || fail "persisted release state is inconsistent"
  [[ "$(production_env_value "$state_file" CONTROLLER_COMMIT)" == "$head_commit" ]] || fail "persisted release controller is inconsistent"
  remove_pending_release_marker "$pending_file" || fail "could not clear the completed pending release marker"
fi

release_completed=true
writers_stopped=false
caddy_activation_started=false
egress_enforcement_started=false
pending_release_guarded=false
printf 'Release %s is ready. Previous release: %s\n' "$release_tag" "${previous_tag:-none}"
