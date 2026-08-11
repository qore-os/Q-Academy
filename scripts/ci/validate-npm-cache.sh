#!/usr/bin/env bash
set -euo pipefail

readonly CACHE_DIRECTORY_NAME=q-academy-npm-cache

fail() {
  printf 'npm cache validation failed: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  validate-npm-cache.sh --prepare
  validate-npm-cache.sh --allow-empty
  validate-npm-cache.sh --require-populated [--print-cacache]
EOF
  exit 64
}

mode=""
print_cacache=false
while (($# > 0)); do
  case "$1" in
    --prepare | --allow-empty | --require-populated)
      [[ -z "$mode" ]] || usage
      mode="$1"
      ;;
    --print-cacache)
      print_cacache=true
      ;;
    *)
      usage
      ;;
  esac
  shift
done

[[ -n "$mode" ]] || usage
if [[ "$print_cacache" == true && "$mode" != --require-populated ]]; then
  usage
fi

runner_temp_input="${RUNNER_TEMP:-}"
[[ -n "$runner_temp_input" ]] || fail "RUNNER_TEMP is required"
[[ "$runner_temp_input" == /* ]] || fail "RUNNER_TEMP must be absolute"
runner_temp_input="${runner_temp_input%/}"
[[ -n "$runner_temp_input" ]] || fail "RUNNER_TEMP must not be the filesystem root"
[[ -d "$runner_temp_input" ]] || fail "RUNNER_TEMP is not a directory"

runner_temp="$(realpath --canonicalize-existing -- "$runner_temp_input")"
expected_cache="$runner_temp/$CACHE_DIRECTORY_NAME"

npm_cache=""
validate_cache_root_identity() {
  local cache_gid
  local cache_metadata
  local cache_mode
  local cache_uid
  local candidate="$1"

  [[ "$candidate" == /* ]] || fail "NPM_CONFIG_CACHE must be absolute"
  [[ -d "$candidate" ]] || fail "the isolated cache root is missing"
  [[ ! -L "$candidate" ]] || fail "the isolated cache root is a symlink"

  npm_cache="$(realpath --canonicalize-existing -- "$candidate")"
  [[ "$candidate" == "$npm_cache" ]] ||
    fail "NPM_CONFIG_CACHE is not canonical"
  [[ "$npm_cache" == "$expected_cache" ]] ||
    fail "NPM_CONFIG_CACHE is not the exact isolated cache path"

  cache_metadata="$(stat --format='%u:%g:%a' -- "$npm_cache")" ||
    fail "the isolated cache metadata is unavailable"
  IFS=: read -r cache_uid cache_gid cache_mode <<<"$cache_metadata"
  [[ "$cache_uid" == "$(id -u)" && "$cache_gid" == "$(id -g)" ]] ||
    fail "the isolated cache ownership is invalid"
  [[ "$cache_mode" == 700 ]] || fail "the isolated cache mode is not 0700"
}

validate_cache_root_entry_types() {
  local unsafe_entry
  unsafe_entry="$(
    find "$npm_cache" -mindepth 1 ! -type d ! -type f -print -quit
  )"
  [[ -z "$unsafe_entry" ]] ||
    fail "the isolated cache contains an unsafe entry: $unsafe_entry"
}

if [[ "$mode" == --prepare ]]; then
  cache_input="$expected_cache"
  if [[ ! -e "$cache_input" && ! -L "$cache_input" ]]; then
    umask 077
    mkdir -- "$cache_input" || fail "failed to create the isolated cache"
  fi
  validate_cache_root_identity "$cache_input"
  validate_cache_root_entry_types
  printf '%s\n' "$npm_cache"
  exit 0
fi

npm_cache_input="${NPM_CONFIG_CACHE:-}"
[[ -n "$npm_cache_input" ]] || fail "NPM_CONFIG_CACHE is required"
validate_cache_root_identity "$npm_cache_input"

validate_cache_root_entry_types
configured_cache="$(
  NPM_CONFIG_OFFLINE=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NO_UPDATE_NOTIFIER=1 \
    npm config get cache
)"
[[ "$configured_cache" == "$npm_cache" ]] ||
  fail "npm did not retain the isolated cache configuration"

validate_cacache_structure() {
  local cacache="$1"
  local require_populated="$2"
  local unsafe_entry
  local unexpected_root_entry

  [[ -d "$cacache" ]] || fail "_cacache is not a directory"
  [[ ! -L "$cacache" ]] || fail "_cacache is a symlink"
  [[ "$(realpath --canonicalize-existing -- "$cacache")" == "$npm_cache/_cacache" ]] ||
    fail "_cacache escaped the isolated cache root"

  unsafe_entry="$(
    find "$cacache" -mindepth 1 ! -type d ! -type f -print -quit
  )"
  [[ -z "$unsafe_entry" ]] || fail "_cacache contains an unsafe entry: $unsafe_entry"

  unexpected_root_entry="$(
    find "$cacache" -mindepth 1 -maxdepth 1 \
      ! \( -type d \( -name content-v2 -o -name index-v5 -o -name tmp \) \) \
      ! \( -type f -name _lastverified \) \
      -print -quit
  )"
  [[ -z "$unexpected_root_entry" ]] ||
    fail "_cacache contains an unexpected root entry: $unexpected_root_entry"

  if [[ "$require_populated" == true ]]; then
    local required_directory
    for required_directory in content-v2 index-v5; do
      [[ -d "$cacache/$required_directory" ]] ||
        fail "_cacache is missing $required_directory"
      [[ -n "$(find "$cacache/$required_directory" -type f -print -quit)" ]] ||
        fail "_cacache/$required_directory contains no files"
    done
  fi
}

cacache_input="$npm_cache/_cacache"
if [[ ! -e "$cacache_input" && ! -L "$cacache_input" ]]; then
  [[ "$mode" == --allow-empty ]] || fail "_cacache is missing"
  exit 0
fi

require_populated=false
if [[ "$mode" == --require-populated ]]; then
  require_populated=true
fi
validate_cacache_structure "$cacache_input" "$require_populated"

NPM_CONFIG_OFFLINE=true \
  NPM_CONFIG_UPDATE_NOTIFIER=false \
  NO_UPDATE_NOTIFIER=1 \
  npm cache verify --cache "$npm_cache" >&2
validate_cache_root_identity "$npm_cache"
validate_cache_root_entry_types
validate_cacache_structure "$cacache_input" "$require_populated"

if [[ "$print_cacache" == true ]]; then
  printf '%s\n' "$cacache_input"
fi
