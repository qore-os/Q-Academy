#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"

target_tag="${1:-${ROLLBACK_TAG:-}}"
env_file="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"
compose_file="${COMPOSE_FILE:-compose.production.yml}"
state_file="${RELEASE_STATE_FILE:-/var/lib/q-academy/releases/current.env}"
lock_file="${RELEASE_LOCK_FILE:-$RELEASE_LOCK_FILE_DEFAULT}"
app_domain="${APP_DOMAIN:-}"
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

rollback_completed=false
writers_stopped=false
cleanup_failed_rollback() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$writers_stopped" == "true" && "$rollback_completed" != "true" ]]; then
    "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}" >/dev/null 2>&1 || true
    "${strato_compose[@]}" stop -t 30 "$STRATO_PRIVACY_SWEEPER_SERVICE" >/dev/null 2>&1 || true
    printf 'Rollback failed. All application, media, and STRATO deletion writers remain stopped for investigation.\n' >&2
  fi
  exit "$exit_code"
}
trap cleanup_failed_rollback EXIT

[[ -f "$state_file" ]] || fail "release state not found: $state_file"
current_tag="$(sed -n 's/^CURRENT_TAG=//p' "$state_file" | head -n 1)"
if [[ -z "$target_tag" ]]; then
  target_tag="$(sed -n 's/^PREVIOUS_TAG=//p' "$state_file" | head -n 1)"
fi
[[ "$target_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "invalid source-bound rollback tag"
[[ "$target_tag" != "$current_tag" ]] || fail "target is already active"
[[ "${CONFIRM_ROLLBACK_TAG:-}" == "$target_tag" ]] || fail "CONFIRM_ROLLBACK_TAG must equal the target"
[[ "${MIGRATIONS_BACKWARD_COMPATIBLE:-false}" == "true" ]] || fail "migration compatibility must be explicitly approved"
[[ -f "$env_file" && -f "$compose_file" ]] || fail "environment or Compose file missing"
[[ -n "$app_domain" ]] || fail "APP_DOMAIN must be set"
assert_release_environment_writable "$env_file" || fail "production environment cannot be updated atomically"
verify_and_export_pinned_images "$env_file" || fail "production image pins are invalid"
verify_media_work_mount "$env_file" || fail "media work filesystem is invalid"
configure_media_s3_release_services "$env_file" || fail "media S3 compatibility mode is invalid"
configured_tag="$(production_env_value "$env_file" APP_IMAGE_TAG)" || fail "APP_IMAGE_TAG is invalid"
[[ "$configured_tag" == "$current_tag" ]] || fail "release state and production APP_IMAGE_TAG disagree"

for command in docker curl findmnt flock; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
flock -n 9 || fail "another release operation is active"

target_release_images=()
target_runtime_components=(app media-runner)
if (( ${#MEDIA_S3_RELEASE_SERVICES[@]} > 0 )); then
  target_runtime_components+=(s3-app-principal-preflight)
fi
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
run "${compose[@]}" config --quiet
run "${compose[@]}" run --rm --no-deps database-config-preflight
if [[ "$dry_run" != "true" ]]; then
  writers_stopped=true
fi
run "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"
run "${strato_compose[@]}" rm --force --stop "$STRATO_PRIVACY_SWEEPER_SERVICE"
run "${compose[@]}" up -d --no-deps --wait --wait-timeout 300 "${DATABASE_RUNTIME_SERVICES[@]}"
for runtime_service in "${DATABASE_RUNTIME_SERVICES[@]}"; do
  run "${compose[@]}" exec -T \
    -e "Q_ACADEMY_EXPECTED_RELEASE=$target_tag" \
    "$runtime_service" node -e \
    "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(async(response)=>{const body=await response.json().catch(()=>null);if(!response.ok||body?.data?.version!==process.env.Q_ACADEMY_EXPECTED_RELEASE)process.exit(1)}).catch(()=>process.exit(1))"
done
run "${compose[@]}" run --rm --no-deps caddy-volume-init
run "${compose[@]}" up -d --no-deps --force-recreate --wait \
  --wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy
run curl --fail --show-error --silent --retry 12 --retry-delay 5 \
  "https://$app_domain/api/v1/health/ready"
run "${compose[@]}" up -d --no-deps --wait \
  --wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \
  "${DATABASE_DISPATCHER_SERVICES[@]}"
if (( ${#MEDIA_S3_RELEASE_SERVICES[@]} > 0 )); then
  run "${compose[@]}" up -d --no-deps --wait \
    --wait-timeout "$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS" \
    "${MEDIA_S3_RELEASE_SERVICES[@]}"
fi

if [[ "$dry_run" != "true" ]]; then
  persist_app_image_tag "$env_file" "$target_tag" || fail "could not persist APP_IMAGE_TAG"
  temporary_state="${state_file}.tmp.$$"
  umask 077
  {
    printf 'CURRENT_TAG=%s\n' "$target_tag"
    printf 'PREVIOUS_TAG=%s\n' "$current_tag"
    printf 'DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$temporary_state"
  sync "$temporary_state"
  mv -f "$temporary_state" "$state_file"
fi

rollback_completed=true
writers_stopped=false
printf 'Rolled back application runtimes from %s to %s. Database was not changed.\n' "$current_tag" "$target_tag"
