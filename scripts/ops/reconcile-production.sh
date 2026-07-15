#!/usr/bin/env bash
set -euo pipefail

readonly RECONCILE_CONTRACT_VERSION=1
readonly RECONCILE_PRODUCTION_PROJECT=q-academy
readonly RECONCILE_PENDING_RELEASE_FILE=/var/lib/q-academy/releases/pending.env
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

action="${1:-start}"
env_file="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"
compose_file="${COMPOSE_FILE:-compose.production.yml}"
state_file="${RELEASE_STATE_FILE:-/var/lib/q-academy/releases/current.env}"
lock_file="${RELEASE_LOCK_FILE:-/var/lock/q-academy-release.lock}"

fail() { printf 'Production reconcile aborted: %s\n' "$*" >&2; exit 1; }

[[ "$action" == "start" || "$action" == "stop" ]] || fail "action must be start or stop"
[[ "$EUID" -eq 0 ]] || fail "production reconcile must run as root"
for command in docker flock; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

stop_project_fail_closed() {
  local container_output container_id
  local -a container_ids=()

  container_output="$(
    docker ps --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$RECONCILE_PRODUCTION_PROJECT"
  )" || return 1
  [[ -n "$container_output" ]] || return 0
  mapfile -t container_ids <<<"$container_output"
  for container_id in "${container_ids[@]}"; do
    [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  done
  docker stop --time 30 "${container_ids[@]}" >/dev/null
}

if [[ "$action" == "stop" ]]; then
  stop_project_fail_closed || fail "could not stop the Q-Academy project fail closed"
  printf 'Q-Academy project %s is stopped; the host egress policy remains installed.\n' "$RECONCILE_PRODUCTION_PROJECT"
  exit 0
fi

[[ "$lock_file" == /* ]] || fail "release lock path must be absolute"
mkdir -p -- "$(dirname -- "$lock_file")"
exec 9>"$lock_file"
flock -n 9 || fail "another release operation is active"

reconcile_completed=false
cleanup_failed_reconcile() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$reconcile_completed" != "true" ]]; then
    if stop_project_fail_closed >/dev/null 2>&1; then
      printf 'Production reconcile failed. Caddy and every Q-Academy runtime were stopped.\n' >&2
    else
      printf 'Production reconcile failed and the emergency Q-Academy stop could not be verified.\n' >&2
    fi
  fi
  exit "$exit_code"
}
trap cleanup_failed_reconcile EXIT

# Any marker object, including a malformed file or symlink, means that schema
# changes may have committed while the active Env/State pair still names the
# previous runtime. Only the explicit deploy-resume or rollback path may clear
# this condition; unattended boot must never guess.
if [[ -e "$RECONCILE_PENDING_RELEASE_FILE" || -L "$RECONCILE_PENDING_RELEASE_FILE" ]]; then
  fail "pending release marker exists; explicit recovery is required before boot"
fi

# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"
[[ "$PRODUCTION_COMPOSE_PROJECT" == "$RECONCILE_PRODUCTION_PROJECT" ]] || fail "compiled production project contract disagrees with release-common"
[[ "$PENDING_RELEASE_FILE_DEFAULT" == "$RECONCILE_PENDING_RELEASE_FILE" ]] || fail "compiled pending release path disagrees with release-common"

[[ -f "$env_file" && ! -L "$env_file" ]] || fail "production environment is missing or unsafe: $env_file"
[[ -f "$compose_file" && ! -L "$compose_file" ]] || fail "Compose file is missing or unsafe: $compose_file"
for command in curl findmnt git python3 stat; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
verify_release_environment_security "$env_file" || fail "production environment ownership, mode, parent, or line endings are unsafe"

configured_project="$(production_env_value "$env_file" COMPOSE_PROJECT_NAME)" || fail "COMPOSE_PROJECT_NAME is invalid"
[[ "$configured_project" == "$RECONCILE_PRODUCTION_PROJECT" ]] || fail "production Compose project must be exactly $RECONCILE_PRODUCTION_PROJECT"

verify_and_export_pinned_images "$env_file" || fail "production image pins are invalid"
verify_media_work_mount "$env_file" || fail "media work filesystem is invalid"
configure_media_s3_release_services "$env_file" || fail "media S3 compatibility mode is invalid"

[[ -f "$state_file" && ! -L "$state_file" ]] || fail "release state is missing or unsafe: $state_file"
[[ "$(stat -c '%u:%g:%a' "$state_file")" == "0:0:600" ]] || fail "release state must be root-owned with mode 0600"
state_schema="$(production_env_value "$state_file" SCHEMA_VERSION)" || fail "release state schema is invalid"
[[ "$state_schema" == "$RELEASE_STATE_SCHEMA_VERSION" ]] || fail "release state schema is unsupported"
controller_commit="$(production_env_value "$state_file" CONTROLLER_COMMIT)" || fail "release state CONTROLLER_COMMIT is invalid"
current_tag="$(production_env_value "$state_file" CURRENT_TAG)" || fail "release state CURRENT_TAG is invalid"
previous_tag="$(production_env_value "$state_file" PREVIOUS_TAG)" || fail "release state PREVIOUS_TAG is invalid"
deployed_at="$(production_env_value "$state_file" DEPLOYED_AT)" || fail "release state DEPLOYED_AT is invalid"
[[ "$current_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid current tag"
[[ "$controller_commit" =~ ^[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid controller commit"
[[ -z "$previous_tag" || "$previous_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release state contains an invalid previous tag"
[[ "$deployed_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail "release state contains an invalid deployment timestamp"

configured_tag="$(production_env_value "$env_file" APP_IMAGE_TAG)" || fail "APP_IMAGE_TAG is invalid"
[[ "$configured_tag" == "$current_tag" ]] || fail "release state and production APP_IMAGE_TAG disagree"

repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "working directory is not a Git repository"
[[ "$(cd -- "$repository_root" && pwd -P)" == "$(pwd -P)" ]] || fail "reconcile must run from the repository root"
head_commit="$(git rev-parse --verify HEAD^{commit})" || fail "Git HEAD is not a commit"
[[ "$controller_commit" == "$head_commit" ]] || fail "Git HEAD does not match the active release controller"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "Git worktree must be clean, including untracked files"

app_domain="$(production_env_value "$env_file" APP_DOMAIN)" || fail "APP_DOMAIN is invalid"
[[ "$app_domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "APP_DOMAIN is unsafe"

export APP_IMAGE_TAG="$current_tag"
compose=(docker compose --env-file "$env_file" -f "$compose_file" "${MEDIA_S3_COMPOSE_PROFILE_ARGS[@]}")
strato_compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile strato)
monitoring_compose=(docker compose --env-file "$env_file" -f "$compose_file" --profile monitoring)

"${compose[@]}" config --quiet
project_name="$(compose_project_name "${compose[@]}")" || fail "Compose project name is unavailable"
[[ "$project_name" == "$configured_project" ]] || fail "rendered Compose project does not match COMPOSE_PROJECT_NAME"

runtime_images=(
  "$POSTGRES_IMAGE"
  "$CLAMAV_IMAGE"
  "$PROMETHEUS_IMAGE"
  "$NODE_EXPORTER_IMAGE"
  "q-academy-app:$current_tag"
  "q-academy-media-runner:$current_tag"
  "q-academy-dispatcher:$current_tag"
  "q-academy-caddy:$current_tag"
)
if (( ${#MEDIA_S3_RELEASE_SERVICES[@]} > 0 )); then
  runtime_images+=("q-academy-s3-app-principal-preflight:$current_tag")
fi
for image in "${runtime_images[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || fail "active runtime image is missing: $image"
done

# A reconcile is fail-closed even when it is requested while the stack is live.
# Container creation allocates the two controlled bridges but starts no process;
# in particular it cannot publish Caddy's host ports.
stop_project_fail_closed || fail "could not stop the existing Q-Academy project"
"${compose[@]}" create --no-build --no-recreate \
  "${RELEASE_NETWORK_BOOTSTRAP_SERVICES[@]}"
bash "$ROOT_DIR/scripts/ops/docker-egress-firewall.sh" apply \
  --project "$project_name"
bash "$ROOT_DIR/scripts/ops/docker-egress-firewall.sh" verify \
  --project "$project_name"

"${compose[@]}" run --rm --no-deps database-config-preflight
"${compose[@]}" up -d --wait --wait-timeout 900 postgres clamav
"${compose[@]}" run --rm --no-deps -e DATABASE_ROLE_MODE=validate database-role
"${compose[@]}" up -d --no-deps --wait --wait-timeout 300 \
  "${DATABASE_RUNTIME_SERVICES[@]}"
for runtime_service in "${DATABASE_RUNTIME_SERVICES[@]}"; do
  "${compose[@]}" exec -T \
    -e "Q_ACADEMY_EXPECTED_RELEASE=$current_tag" \
    "$runtime_service" node -e \
    "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(async(response)=>{const body=await response.json().catch(()=>null);if(!response.ok||body?.data?.version!==process.env.Q_ACADEMY_EXPECTED_RELEASE)process.exit(1)}).catch(()=>process.exit(1))"
done
"${compose[@]}" up -d --no-deps --wait \
  --wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \
  "${DATABASE_DISPATCHER_SERVICES[@]}"
if (( ${#MEDIA_S3_RELEASE_SERVICES[@]} > 0 )); then
  "${compose[@]}" up -d --no-deps --wait \
    --wait-timeout "$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS" \
    "${MEDIA_S3_RELEASE_SERVICES[@]}"
fi
"${monitoring_compose[@]}" up -d --no-deps --wait --wait-timeout 300 \
  "${OBSERVABILITY_RUNTIME_SERVICES[@]}"

# Docker-published ports bypass a plain UFW INPUT policy. Starting Caddy is the
# atomic public activation and therefore remains the final service operation.
"${compose[@]}" run --rm --no-deps caddy-volume-init
"${compose[@]}" up -d --no-deps --force-recreate --wait \
  --wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy
verify_external_release_readiness "$app_domain" "$current_tag"
"${compose[@]}" ps

reconcile_completed=true
printf 'Q-Academy reconcile contract v%s restored release %s with verified host egress.\n' \
  "$RECONCILE_CONTRACT_VERSION" "$current_tag"
