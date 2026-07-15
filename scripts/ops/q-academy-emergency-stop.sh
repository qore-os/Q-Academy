#!/usr/bin/env bash
set -euo pipefail

readonly PRODUCTION_PROJECT=q-academy

[[ "$EUID" -eq 0 ]] || {
  printf 'Q-Academy emergency stop must run as root.\n' >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  printf 'Docker is required for the Q-Academy emergency stop.\n' >&2
  exit 1
}

container_output="$(
  docker ps --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PRODUCTION_PROJECT"
)" || {
  printf 'Could not enumerate the Q-Academy project.\n' >&2
  exit 1
}
[[ -n "$container_output" ]] || exit 0

mapfile -t container_ids <<<"$container_output"
for container_id in "${container_ids[@]}"; do
  [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || {
    printf 'Docker returned an invalid Q-Academy container identifier.\n' >&2
    exit 1
  }
done

docker stop --time 30 "${container_ids[@]}" >/dev/null
