#!/bin/sh
set -eu

umask 077

usage() {
  cat <<'EOF'
Q-Academy immutable tenant/operator CLI

Usage:
  q-academy-tenant-ops <command> [arguments]

Allowed commands:
  tenant:provision
  tenant:status
  tenant:contract
  tenant:erase
  tenant:erase:verify
  audit:export
  audit:verify
  user-data:export
  test:http-slo
  help

Input files are restricted to /operations/input. New exports and erasure
evidence are restricted to /operations/output.
EOF
}

fail() {
  printf '%s\n' "$*" >&2
  exit 64
}

require_input_file() {
  input_path="$1"
  case "$input_path" in
    /operations/input/*) ;;
    *) fail "Input path must be below /operations/input: $input_path" ;;
  esac
  [ -f "$input_path" ] || fail "Input path is not a regular file: $input_path"
  [ ! -L "$input_path" ] || fail "Input path must not be a symbolic link: $input_path"
  resolved_path="$(readlink -f -- "$input_path")" || fail "Input path cannot be resolved: $input_path"
  case "$resolved_path" in
    /operations/input/*) ;;
    *) fail "Input path escapes /operations/input: $input_path" ;;
  esac
}

require_new_output_file() {
  output_path="$1"
  case "$output_path" in
    /operations/output/*) ;;
    *) fail "Output path must be below /operations/output: $output_path" ;;
  esac
  [ ! -e "$output_path" ] || fail "Output path already exists: $output_path"
  [ ! -L "$output_path" ] || fail "Output path must not be a symbolic link: $output_path"
  output_parent="$(dirname -- "$output_path")"
  [ -d "$output_parent" ] || fail "Output parent directory does not exist: $output_parent"
  [ ! -L "$output_parent" ] || fail "Output parent must not be a symbolic link: $output_parent"
  resolved_parent="$(readlink -f -- "$output_parent")" || fail "Output parent cannot be resolved: $output_parent"
  case "$resolved_parent" in
    /operations/output|/operations/output/*) ;;
    *) fail "Output path escapes /operations/output: $output_path" ;;
  esac

  probe="$(mktemp /operations/output/.q-academy-ops.XXXXXX)" || fail "Output mount is not writable."
  probe_link="${probe}.link"
  if ! ln -- "$probe" "$probe_link"; then
    rm -f -- "$probe" "$probe_link"
    fail "Output mount must support hard links."
  fi
  rm -f -- "$probe" "$probe_link"
}

require_input_with_manifest() {
  require_input_file "$1"
  require_input_file "${1}.manifest.json"
}

require_new_output_with_manifest() {
  require_new_output_file "$1"
  manifest_path="${1}.manifest.json"
  [ ! -e "$manifest_path" ] || fail "Output manifest already exists: $manifest_path"
  [ ! -L "$manifest_path" ] || fail "Output manifest must not be a symbolic link: $manifest_path"
}

validate_flag_path() {
  expected_flag="$1"
  validator="$2"
  shift 2
  matches=0
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$expected_flag" ]; then
      matches=$((matches + 1))
      [ "$matches" -eq 1 ] || fail "Duplicate path option: $expected_flag"
      [ "$#" -ge 2 ] || fail "Missing path after $expected_flag"
      "$validator" "$2"
      shift
    fi
    shift
  done
}

if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'Tenant operations must not run as root.' >&2
  exit 77
fi

[ "$#" -gt 0 ] || fail "An allowed tenant operation is required."
command_name="$1"
shift

case "$command_name" in
  help|--help|-h|tenant:provision|tenant:status|tenant:contract|tenant:erase|tenant:erase:verify|audit:export|audit:verify|user-data:export|test:http-slo) ;;
  *)
    printf 'Unsupported tenant operation: %s\n' "$command_name" >&2
    usage >&2
    exit 64
    ;;
esac

scope="${Q_ACADEMY_OPS_SCOPE:-}"
case "$scope:$command_name" in
  *:help|*:--help|*:-h|admin:tenant:provision|admin:tenant:status|admin:tenant:contract|export:audit:export|export:user-data:export|erasure:tenant:erase|verify:tenant:erase:verify|verify:audit:verify|http-slo:test:http-slo) ;;
  *)
    printf 'Operation %s is not permitted in scope %s.\n' "$command_name" "${scope:-unset}" >&2
    exit 77
    ;;
esac

case "$command_name" in
  help|--help|-h)
    usage
    ;;
  tenant:provision)
    exec /app/node_modules/.bin/tsx /app/scripts/provision-tenant.ts "$@"
    ;;
  tenant:status)
    exec /app/node_modules/.bin/tsx /app/scripts/set-tenant-status.ts "$@"
    ;;
  tenant:contract)
    exec /app/node_modules/.bin/tsx /app/scripts/set-tenant-contract.ts "$@"
    ;;
  tenant:erase)
    validate_flag_path --manifest require_input_file "$@"
    validate_flag_path --customer-export require_input_file "$@"
    validate_flag_path --archive require_new_output_with_manifest "$@"
    exec node --conditions=react-server --import tsx /app/scripts/erase-tenant.ts "$@"
    ;;
  tenant:erase:verify)
    validate_flag_path --archive require_input_with_manifest "$@"
    exec /app/node_modules/.bin/tsx /app/scripts/verify-tenant-erasure-archive.ts "$@"
    ;;
  audit:export)
    validate_flag_path --output require_new_output_with_manifest "$@"
    exec /app/node_modules/.bin/tsx /app/scripts/export-audit-events.ts "$@"
    ;;
  audit:verify)
    [ "$#" -eq 1 ] || fail "audit:verify requires exactly one export path."
    require_input_with_manifest "$1"
    exec /app/node_modules/.bin/tsx /app/scripts/verify-audit-export.ts "$@"
    ;;
  user-data:export)
    validate_flag_path --output require_new_output_file "$@"
    exec /app/node_modules/.bin/tsx /app/scripts/export-user-data.ts "$@"
    ;;
  test:http-slo)
    exec /app/node_modules/.bin/tsx /app/scripts/http-slo-smoke.ts "$@"
    ;;
esac
