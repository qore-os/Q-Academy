#!/usr/bin/env bash

set -euo pipefail

readonly MAX_ATTEMPTS=4
readonly -a BACKOFF_SECONDS=(2 4 8)
readonly ATTEMPT_TIMEOUT_SECONDS=300
readonly ATTEMPT_KILL_AFTER_SECONDS=15

usage() {
  printf '%s\n' \
    'Usage: caddy-go-network-retry.sh [--module-files] --label LABEL [--output PATH] -- go ARG...' \
    >&2
  exit 64
}

die() {
  printf 'Caddy Go network retry configuration error: %s\n' "$1" >&2
  exit 64
}

label=""
output_path=""
module_files=0

while (($# > 0)); do
  case "$1" in
    --label)
      (($# >= 2)) || usage
      [[ -z "$label" ]] || usage
      label="$2"
      shift 2
      ;;
    --module-files)
      ((module_files == 0)) || usage
      module_files=1
      shift
      ;;
    --output)
      (($# >= 2)) || usage
      [[ -z "$output_path" ]] || usage
      output_path="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      usage
      ;;
  esac
done

[[ "$label" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]] || die 'the label is invalid'
(($# > 0)) || usage
[[ "$1" == go ]] || die 'only an exact Go command may be retried'
[[ "${GOENV:-}" == off ]] || die 'GOENV must be off'
[[ "${GOTOOLCHAIN:-}" == local ]] || die 'GOTOOLCHAIN must be local'
[[ "${GOPROXY:-}" == 'https://proxy.golang.org' ]] || die 'GOPROXY is not pinned'
[[ "${GOSUMDB:-}" == 'sum.golang.org' ]] || die 'GOSUMDB is not pinned'
[[ -z "${GONOPROXY:-}" ]] || die 'GONOPROXY must be empty'
[[ -z "${GONOSUMDB:-}" ]] || die 'GONOSUMDB must be empty'
[[ -z "${GOPRIVATE:-}" ]] || die 'GOPRIVATE must be empty'

if [[ -n "$output_path" ]]; then
  [[ "$output_path" == /* ]] || die 'the output path must be absolute'
  [[ -d "$(dirname -- "$output_path")" ]] || die 'the output directory is missing'
  [[ ! -d "$output_path" ]] || die 'the output path is a directory'
fi

snapshot_directory=""
attempt_output=""
restore_on_exit=0

restore_module_files() {
  if ((module_files == 0)); then
    return
  fi
  cp -p -- "$snapshot_directory/go.mod" go.mod
  if [[ -f "$snapshot_directory/go.sum" ]]; then
    cp -p -- "$snapshot_directory/go.sum" go.sum
  else
    rm -f -- go.sum
  fi
}

# shellcheck disable=SC2317
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if ((restore_on_exit == 1)); then
    if ! restore_module_files; then
      printf 'Caddy Go network step %s could not restore its module files.\n' \
        "$label" >&2
      status=70
    fi
  fi
  if [[ -n "$attempt_output" ]]; then
    rm -f -- "$attempt_output"
  fi
  if [[ -n "$snapshot_directory" ]]; then
    rm -rf -- "$snapshot_directory"
  fi
  exit "$status"
}

# shellcheck disable=SC2317
exit_for_signal() {
  trap - HUP INT TERM
  exit "$1"
}
trap cleanup EXIT
trap 'exit_for_signal 129' HUP
trap 'exit_for_signal 130' INT
trap 'exit_for_signal 143' TERM

if ((module_files == 1)); then
  [[ -f go.mod && ! -L go.mod ]] || die 'go.mod must be a regular file'
  if [[ -e go.sum ]]; then
    [[ -f go.sum && ! -L go.sum ]] || die 'go.sum must be a regular file'
  fi
  snapshot_directory="$(mktemp -d "${TMPDIR:-/tmp}/q-academy-caddy-go-retry.XXXXXX")"
  cp -p -- go.mod "$snapshot_directory/go.mod"
  if [[ -f go.sum ]]; then
    cp -p -- go.sum "$snapshot_directory/go.sum"
  fi
  restore_on_exit=1
fi

if [[ -n "$output_path" ]]; then
  attempt_output="${output_path}.attempt.$$"
  rm -f -- "$output_path" "$attempt_output"
fi

attempt=1
while ((attempt <= MAX_ATTEMPTS)); do
  status=0
  if [[ -n "$attempt_output" ]]; then
    if timeout \
      --signal=TERM \
      --kill-after="${ATTEMPT_KILL_AFTER_SECONDS}s" \
      "${ATTEMPT_TIMEOUT_SECONDS}s" \
      "$@" >"$attempt_output"; then
      mv -f -- "$attempt_output" "$output_path"
      attempt_output=""
      restore_on_exit=0
      exit 0
    else
      status=$?
    fi
  elif timeout \
    --signal=TERM \
    --kill-after="${ATTEMPT_KILL_AFTER_SECONDS}s" \
    "${ATTEMPT_TIMEOUT_SECONDS}s" \
    "$@"; then
    restore_on_exit=0
    exit 0
  else
    status=$?
  fi

  restore_module_files
  if [[ -n "$attempt_output" ]]; then
    rm -f -- "$attempt_output"
  fi

  if ((attempt == MAX_ATTEMPTS)); then
    printf 'Caddy Go network step %s failed after %d attempts (exit %d); no fallback was attempted.\n' \
      "$label" "$attempt" "$status" >&2
    exit "$status"
  fi

  delay="${BACKOFF_SECONDS[$((attempt - 1))]}"
  printf 'Caddy Go network step %s failed on attempt %d/%d (exit %d); retrying in %ss.\n' \
    "$label" "$attempt" "$MAX_ATTEMPTS" "$status" "$delay" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done

exit 70
