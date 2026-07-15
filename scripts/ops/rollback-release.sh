#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"

target_tag="${1:-${ROLLBACK_TAG:-}}"
env_file="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"
compose_file="${COMPOSE_FILE:-compose.production.yml}"
state_file="${RELEASE_STATE_FILE:-/var/lib/q-academy/releases/current.env}"
pending_file="$PENDING_RELEASE_FILE_DEFAULT"
lock_file="${RELEASE_LOCK_FILE:-$RELEASE_LOCK_FILE_DEFAULT}"
requested_app_domain="${APP_DOMAIN:-}"
dry_run="${DRY_RUN:-false}"

fail() { printf 'Rollback aborted: %s\n' "$*" >&2; exit 1; }
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

rollback_completed=false
writers_stopped=false
caddy_activation_started=false
egress_enforcement_started=false
pending_release_guarded=false
release_lock_acquired=false
cleanup_failed_rollback() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$rollback_completed" != "true" ]]; then
    if [[ "$pending_release_guarded" == "true" && "$release_lock_acquired" == "true" && "$dry_run" != "true" ]]; then
      if stop_production_compose_project "$PRODUCTION_COMPOSE_PROJECT" >/dev/null 2>&1; then
        printf 'Pending rollback failed. Every Q-Academy container was stopped for investigation.\n' >&2
      else
        printf 'Pending rollback failed and the emergency Q-Academy stop could not be verified.\n' >&2
      fi
    elif [[ "$egress_enforcement_started" == "true" ]]; then
      if stop_production_compose_project "$PRODUCTION_COMPOSE_PROJECT" >/dev/null 2>&1; then
        printf 'Rollback failed after host-egress enforcement began. Every Q-Academy container was stopped for investigation.\n' >&2
      else
        printf 'Rollback failed after host-egress enforcement began and the emergency Q-Academy stop could not be verified.\n' >&2
      fi
    elif [[ "$writers_stopped" == "true" || "$caddy_activation_started" == "true" ]]; then
      "${compose[@]}" stop -t 30 caddy >/dev/null 2>&1 || true
      if [[ "$writers_stopped" == "true" ]]; then
        "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}" >/dev/null 2>&1 || true
        "${strato_compose[@]}" stop -t 30 "$STRATO_PRIVACY_SWEEPER_SERVICE" >/dev/null 2>&1 || true
        printf 'Rollback failed. Caddy and all application, media, and STRATO deletion writers remain stopped for investigation.\n' >&2
      fi
    fi
  fi
  exit "$exit_code"
}
trap cleanup_failed_rollback EXIT

if [[ -e "$pending_file" || -L "$pending_file" ]]; then
  pending_release_guarded=true
fi
command -v flock >/dev/null 2>&1 || fail "required command is missing: flock"
if [[ "$dry_run" != "true" && "$EUID" -ne 0 ]]; then
  fail "production rollback must run as root so the host egress policy can be enforced"
fi
[[ "$lock_file" == /* ]] || fail "release lock path must be absolute"
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
flock -n 9 || fail "another release operation is active"
release_lock_acquired=true

for command in docker curl findmnt flock git python3 sync timeout; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "working directory is not a Git repository"
[[ "$(cd -- "$repository_root" && pwd -P)" == "$(pwd -P)" ]] || fail "rollback must run from the repository root"
head_commit="$(git rev-parse --verify HEAD^{commit})" || fail "Git HEAD is not a commit"
[[ "$head_commit" =~ ^[a-f0-9]{40,64}$ ]] || fail "Git HEAD has an unsupported object id"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "Git worktree must be clean, including untracked files"
[[ -f "$state_file" && ! -L "$state_file" ]] || fail "release state not found or unsafe: $state_file"
[[ "$(stat -c '%u:%g:%a' "$state_file")" == "0:0:600" ]] || fail "release state must be root-owned with mode 0600"
state_schema="$(production_env_value "$state_file" SCHEMA_VERSION)" || fail "release state schema is invalid"
[[ "$state_schema" == "$RELEASE_STATE_SCHEMA_VERSION" ]] || fail "release state schema is unsupported"
controller_commit="$(production_env_value "$state_file" CONTROLLER_COMMIT)" || fail "release state CONTROLLER_COMMIT is invalid"
[[ "$controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid controller commit"
current_tag="$(production_env_value "$state_file" CURRENT_TAG)" || fail "release state CURRENT_TAG is invalid"
state_previous_tag="$(production_env_value "$state_file" PREVIOUS_TAG)" || fail "release state PREVIOUS_TAG is invalid"
[[ "$current_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid current tag"
[[ -z "$state_previous_tag" || "$state_previous_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid previous tag"

[[ -f "$env_file" && ! -L "$env_file" && -f "$compose_file" && ! -L "$compose_file" ]] ||
  fail "environment or Compose file missing or unsafe"
assert_release_environment_writable "$env_file" || fail "production environment cannot be updated atomically"
app_domain="$(production_env_value "$env_file" APP_DOMAIN)" || fail "production APP_DOMAIN is invalid"
[[ -n "$app_domain" && "$app_domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "production APP_DOMAIN is invalid"
[[ -z "$requested_app_domain" || "$requested_app_domain" == "$app_domain" ]] || fail "APP_DOMAIN override disagrees with the production environment"
verify_and_export_pinned_images "$env_file" || fail "production image pins are invalid"
verify_media_work_mount "$env_file" || fail "media work filesystem is invalid"
configure_media_s3_release_services "$env_file" || fail "media S3 compatibility mode is invalid"
configured_tag="$(production_env_value "$env_file" APP_IMAGE_TAG)" || fail "APP_IMAGE_TAG is invalid"
[[ "$configured_tag" == "$current_tag" ]] || fail "release state and production APP_IMAGE_TAG disagree"

pending_recovery=false
rollback_previous_tag="$current_tag"
if [[ -e "$pending_file" || -L "$pending_file" ]]; then
  validate_pending_release_marker "$pending_file" || fail "pending release marker is invalid"
  pending_from_tag="$(production_env_value "$pending_file" FROM_TAG)" || fail "pending release FROM_TAG is invalid"
  pending_to_tag="$(production_env_value "$pending_file" TO_TAG)" || fail "pending release TO_TAG is invalid"
  pending_controller_commit="$(production_env_value "$pending_file" CONTROLLER_COMMIT)" || fail "pending release CONTROLLER_COMMIT is invalid"
  [[ -n "$pending_from_tag" ]] || fail "an initial-install pending release can only be resumed forward or recovered from backup"
  [[ "$head_commit" == "$pending_controller_commit" ]] || fail "pending release belongs to a different controller checkout"
  [[ "$current_tag" == "$pending_from_tag" && "$configured_tag" == "$pending_from_tag" ]] ||
    fail "pending rollback requires CURRENT_TAG and APP_IMAGE_TAG to equal FROM_TAG"
  if [[ -z "$target_tag" ]]; then
    target_tag="$pending_from_tag"
  fi
  [[ "$target_tag" == "$pending_from_tag" ]] || fail "pending rollback target must equal FROM_TAG"
  rollback_previous_tag="$state_previous_tag"
  pending_recovery=true
else
  [[ "$controller_commit" == "$head_commit" ]] || fail "Git HEAD does not match the active release controller"
  if [[ -z "$target_tag" ]]; then
    target_tag="$state_previous_tag"
  fi
  [[ "$target_tag" != "$current_tag" ]] || fail "target is already active"
fi
[[ "$target_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "invalid source-bound rollback tag"
[[ "${CONFIRM_ROLLBACK_TAG:-}" == "$target_tag" ]] || fail "CONFIRM_ROLLBACK_TAG must equal the target"
[[ "${MIGRATIONS_BACKWARD_COMPATIBLE:-false}" == "true" ]] || fail "migration compatibility must be explicitly approved"

target_release_images=()
target_runtime_components=(app media-runner media-preflight s3-app-principal-preflight)
target_runtime_components+=(dispatcher caddy)
for component in "${target_runtime_components[@]}"; do
  target_release_images+=("q-academy-$component:$target_tag")
done
for target_image in "${target_release_images[@]}"; do
  docker image inspect "$target_image" >/dev/null 2>&1 ||
    fail "target release image is not present locally: $target_image"
done
export APP_IMAGE_TAG="$target_tag"
compose=(docker compose --env-file "$env_file" -f "$compose_file" "${MEDIA_S3_COMPOSE_PROFILE_ARGS[@]}")
strato_compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile strato)
monitoring_compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile monitoring)
run "${compose[@]}" config --quiet
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
run "${compose[@]}" run --rm --no-deps database-config-preflight
run "${compose[@]}" up -d --no-recreate --wait --wait-timeout 900 postgres clamav
run "${compose[@]}" run --rm --no-deps -e DATABASE_ROLE_MODE=validate database-role
run_with_timeout "$S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS" \
  "${compose[@]}" run --rm --no-deps s3-app-principal-preflight \
  --confirm-bucket "$media_bucket"
run_with_timeout "$MEDIA_PROCESSING_PREFLIGHT_TIMEOUT_SECONDS" \
  "${compose[@]}" run --rm --no-deps media-preflight \
  --confirm-bucket "$media_bucket"
if [[ "$dry_run" != "true" ]]; then
  writers_stopped=true
fi
run "${compose[@]}" stop -t 30 caddy
run "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"
run "${strato_compose[@]}" rm --force --stop "$STRATO_PRIVACY_SWEEPER_SERVICE"
run "${compose[@]}" up -d --no-deps --wait --wait-timeout 300 "${DATABASE_RUNTIME_SERVICES[@]}"
for runtime_service in "${DATABASE_RUNTIME_SERVICES[@]}"; do
  run "${compose[@]}" exec -T \
    -e "Q_ACADEMY_EXPECTED_RELEASE=$target_tag" \
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
run verify_external_release_readiness "$app_domain" "$target_tag"

if [[ "$dry_run" != "true" ]]; then
  persist_app_image_tag "$env_file" "$target_tag" || fail "could not persist APP_IMAGE_TAG"
  temporary_state="${state_file}.tmp.$$"
  umask 077
  {
    printf 'SCHEMA_VERSION=%s\n' "$RELEASE_STATE_SCHEMA_VERSION"
    printf 'CONTROLLER_COMMIT=%s\n' "$head_commit"
    printf 'CURRENT_TAG=%s\n' "$target_tag"
    printf 'PREVIOUS_TAG=%s\n' "$rollback_previous_tag"
    printf 'DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$temporary_state"
  sync "$temporary_state"
  mv -f "$temporary_state" "$state_file"
  sync -f "$(dirname -- "$state_file")"
  [[ "$(production_env_value "$env_file" APP_IMAGE_TAG)" == "$target_tag" ]] || fail "persisted APP_IMAGE_TAG is inconsistent"
  [[ "$(production_env_value "$state_file" CURRENT_TAG)" == "$target_tag" ]] || fail "persisted release state is inconsistent"
  [[ "$(production_env_value "$state_file" CONTROLLER_COMMIT)" == "$head_commit" ]] || fail "persisted release controller is inconsistent"
  if [[ "$pending_recovery" == "true" ]]; then
    remove_pending_release_marker "$pending_file" || fail "could not clear the recovered pending release marker"
  fi
fi

rollback_completed=true
writers_stopped=false
caddy_activation_started=false
egress_enforcement_started=false
pending_release_guarded=false
printf 'Rolled back application runtimes from %s to %s. Database was not changed.\n' "$current_tag" "$target_tag"
