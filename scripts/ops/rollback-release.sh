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
    printf 'Rollback failed. All application and media writers remain stopped for investigation.\n' >&2
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
configured_tag="$(production_env_value "$env_file" APP_IMAGE_TAG)" || fail "APP_IMAGE_TAG is invalid"
[[ "$configured_tag" == "$current_tag" ]] || fail "release state and production APP_IMAGE_TAG disagree"

for command in docker curl findmnt flock; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
flock -n 9 || fail "another release operation is active"

docker image inspect "q-academy-app:$target_tag" >/dev/null 2>&1 || fail "target app image is not present locally"
docker image inspect "q-academy-media-runner:$target_tag" >/dev/null 2>&1 || fail "target media runner image is not present locally"
export APP_IMAGE_TAG="$target_tag"
compose=(docker compose --env-file "$env_file" -f "$compose_file")
run "${compose[@]}" config --quiet
run "${compose[@]}" run --rm --no-deps database-config-preflight
run "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"
if [[ "$dry_run" != "true" ]]; then
  writers_stopped=true
fi
run "${compose[@]}" up -d --no-deps --wait --wait-timeout 300 "${DATABASE_RUNTIME_SERVICES[@]}"
for runtime_service in "${DATABASE_RUNTIME_SERVICES[@]}"; do
  run "${compose[@]}" exec -T \
    -e "Q_ACADEMY_EXPECTED_RELEASE=$target_tag" \
    "$runtime_service" node -e \
    "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(async(response)=>{const body=await response.json().catch(()=>null);if(!response.ok||body?.data?.version!==process.env.Q_ACADEMY_EXPECTED_RELEASE)process.exit(1)}).catch(()=>process.exit(1))"
done
run curl --fail --show-error --silent --retry 12 --retry-delay 5 \
  "https://$app_domain/api/v1/health/ready"
run "${compose[@]}" up -d --no-deps --wait \
  --wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \
  "${DATABASE_DISPATCHER_SERVICES[@]}"

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
