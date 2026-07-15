#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly CONTROL_ID="q-academy.docker-egress-firewall"
readonly STATE_SCHEMA="1"
readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly DEFAULT_POLICY="${ROOT_DIR}/deploy/security/docker-egress-policy.conf"
readonly DEFAULT_STATE_DIR="/var/lib/q-academy/security"
readonly DEFAULT_LOCK_FILE="/run/lock/q-academy/docker-egress-firewall.lock"

readonly -a BLOCKED_IPV4=(
  "169.254.169.254/32" # Cloud metadata is kept explicit in evidence and rules.
  "0.0.0.0/8"
  "10.0.0.0/8"
  "100.64.0.0/10"
  "127.0.0.0/8"
  "169.254.0.0/16"
  "172.16.0.0/12"
  "192.0.0.0/24"
  "192.0.2.0/24"
  "192.31.196.0/24"
  "192.52.193.0/24"
  "192.88.99.0/24"
  "192.168.0.0/16"
  "192.175.48.0/24"
  "198.18.0.0/15"
  "198.51.100.0/24"
  "203.0.113.0/24"
  "224.0.0.0/4"
  "240.0.0.0/4"
)
readonly -a BLOCKED_IPV6=(
  "fd00:ec2::254/128" # AWS IMDS IPv6 endpoint.
  "::/128"
  "::1/128"
  "::ffff:0:0/96"
  "64:ff9b::/96"
  "64:ff9b:1::/48"
  "100::/64"
  "2001::/32"
  "2001:1::1/128"
  "2001:1::2/128"
  "2001:2::/48"
  "2001:4:112::/48"
  "2001:10::/28"
  "2001:20::/28"
  "2001:db8::/32"
  "2002::/16"
  "3fff::/20"
  "5f00::/16"
  "fc00::/7"
  "fe80::/10"
  "ff00::/8"
)

fail() {
  printf 'Egress firewall aborted: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*" >&2
}

assert_secure_root_directory() {
  local directory="$1"
  local owner mode
  owner="$(stat -c '%u' "$directory")" || fail "cannot inspect protected directory owner"
  mode="$(stat -c '%a' "$directory")" || fail "cannot inspect protected directory mode"
  [[ "$owner" == "0" && "$mode" =~ ^[0-7]{3,4}$ ]] || fail "protected directory must be root-owned with a valid mode"
  (( (8#$mode & 0022) == 0 )) || fail "protected directory must not be group- or world-writable"
}

usage() {
  cat <<'EOF'
Usage:
  sudo bash scripts/ops/docker-egress-firewall.sh ACTION --project NAME [OPTIONS]

Actions:
  apply      Validate Docker networks, install rules, verify them, and write evidence.
  dry-run    Validate everything and emit the planned policy without changing firewall state.
  verify     Verify live Docker networks and the installed rules against sealed state.
  remove     Remove only this project's owned rules; succeeds when already absent.

Options:
  --project NAME       Exact Docker Compose project name (required).
  --policy PATH        Strict policy file (default: deploy/security/docker-egress-policy.conf).
  --backend MODE       auto, iptables, or nft (default: auto).
  --state-dir PATH     Absolute state/evidence directory (default: /var/lib/q-academy/security).
  --evidence PATH      Absolute JSON output path, or '-' for stdout.
  --lock-file PATH     Absolute operation lock path (default: /run/lock/...).
  --help               Show this help.

The script never reads the production environment file and never prints container
inspection payloads, environment variables, endpoints, credentials, or firewall
command traces. Activation is an explicit rootserver operation.
EOF
}

[[ "${1:-}" != "--help" && "${1:-}" != "-h" ]] || { usage; exit 0; }
action="${1:-}"
[[ "$action" =~ ^(apply|dry-run|verify|remove)$ ]] || { usage >&2; fail "ACTION must be apply, dry-run, verify, or remove"; }
shift

project=""
policy_file="$DEFAULT_POLICY"
requested_backend="auto"
state_dir="$DEFAULT_STATE_DIR"
evidence_file=""
lock_file="$DEFAULT_LOCK_FILE"

while (($# > 0)); do
  case "$1" in
    --project|--policy|--backend|--state-dir|--evidence|--lock-file)
      (($# >= 2)) || fail "$1 requires a value"
      case "$1" in
        --project) project="$2" ;;
        --policy) policy_file="$2" ;;
        --backend) requested_backend="$2" ;;
        --state-dir) state_dir="$2" ;;
        --evidence) evidence_file="$2" ;;
        --lock-file) lock_file="$2" ;;
      esac
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$project" ]] || fail "--project is required"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]{0,47}$ ]] || fail "project must match ^[a-z0-9][a-z0-9_-]{0,47}$"
[[ "$requested_backend" =~ ^(auto|iptables|nft)$ ]] || fail "backend must be auto, iptables, or nft"
[[ "$state_dir" == /* ]] || fail "state directory must be absolute"
[[ "$lock_file" == /* ]] || fail "lock file must be absolute"
[[ "$evidence_file" == "-" || -z "$evidence_file" || "$evidence_file" == /* ]] || fail "evidence path must be absolute or '-'"
[[ -f "$policy_file" && ! -L "$policy_file" ]] || fail "policy must be a regular non-symlink file"
if [[ "$action" != "dry-run" && "$EUID" -ne 0 ]]; then
  fail "$action must run as root"
fi

for command in awk cat chmod cut date dirname docker flock grep install mktemp mv python3 rm sha256sum sort stat tr wc; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

project_hash="$(printf '%s' "$project" | sha256sum | cut -c1-12)"
[[ "$project_hash" =~ ^[a-f0-9]{12}$ ]] || fail "could not derive project identifier"
forward_chain="QAEGF_${project_hash}"
input_chain="QAEGI_${project_hash}"
nft_table="qa_egress_${project_hash}"
forward_marker="qa-egress-forward-${project_hash}"
input_marker="qa-egress-input-${project_hash}"
state_file="${state_dir}/docker-egress-${project_hash}.state"
evidence_file="${evidence_file:-${state_dir}/docker-egress-${project_hash}-evidence.json}"

lock_parent="$(dirname -- "$lock_file")"
if [[ ! -e "$lock_parent" ]]; then
  install -d -m 0700 -- "$lock_parent"
fi
[[ -d "$lock_parent" && ! -L "$lock_parent" ]] || fail "lock parent must be a real directory"
if [[ "$action" != "dry-run" ]]; then
  assert_secure_root_directory "$lock_parent"
fi
[[ ! -L "$lock_file" ]] || fail "lock file must not be a symlink"
if [[ -e "$lock_file" ]]; then
  [[ -f "$lock_file" ]] || fail "lock path must be a regular file"
fi
exec 9>"$lock_file"
chmod 0600 "$lock_file"
flock -n 9 || fail "another egress firewall operation is active"

declare -a logical_networks=()
declare -a policy_ports=()
declare -A seen_networks=()
policy_version=""

while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line="${raw_line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *[[:space:]]* ]] || fail "policy data must not contain whitespace"
  if [[ "$line" =~ ^policy_version=([0-9]+)$ ]]; then
    [[ -z "$policy_version" ]] || fail "policy_version is duplicated"
    policy_version="${BASH_REMATCH[1]}"
    continue
  fi
  if [[ "$line" =~ ^network\.([a-z0-9][a-z0-9_-]{0,31})=(.+)$ ]]; then
    logical="${BASH_REMATCH[1]}"
    ports="${BASH_REMATCH[2]}"
    [[ -z "${seen_networks[$logical]:-}" ]] || fail "network policy is duplicated: $logical"
    [[ "$ports" =~ ^(tcp|udp):([1-9][0-9]{0,4})(,(tcp|udp):([1-9][0-9]{0,4}))*$ ]] || fail "invalid port policy for network: $logical"
    IFS=',' read -r -a entries <<<"$ports"
    declare -A seen_ports=()
    for entry in "${entries[@]}"; do
      protocol="${entry%%:*}"
      port="${entry##*:}"
      ((10#$port <= 65535)) || fail "port exceeds 65535 for network: $logical"
      [[ -z "${seen_ports[$entry]:-}" ]] || fail "duplicate port policy for network: $logical"
      seen_ports[$entry]=1
    done
    unset seen_ports
    seen_networks[$logical]=1
    logical_networks+=("$logical")
    policy_ports+=("$ports")
    continue
  fi
  fail "unknown or malformed policy key"
done < "$policy_file"

[[ "$policy_version" == "1" ]] || fail "policy_version must equal 1"
((${#logical_networks[@]} >= 1 && ${#logical_networks[@]} <= 8)) || fail "policy must contain between one and eight networks"
policy_sha256="$(sha256sum -- "$policy_file" | awk '{print $1}')"
[[ "$policy_sha256" =~ ^[a-f0-9]{64}$ ]] || fail "policy digest is invalid"
script_sha256="$(sha256sum -- "${BASH_SOURCE[0]}" | awk '{print $1}')"
[[ "$script_sha256" =~ ^[a-f0-9]{64}$ ]] || fail "script digest is invalid"

declare -a physical_networks=()
declare -a network_ids=()
declare -a bridge_names=()
declare -a ipv4_subnets=()
declare -a ipv6_subnets=()

inspect_network() {
  local logical="$1"
  local physical="${project}_${logical}"
  local inspection validated
  inspection="$(docker network inspect -- "$physical" 2>/dev/null)" || fail "required Docker network is missing or unreadable: $physical"
  validated="$(printf '%s' "$inspection" | python3 -c '
import ipaddress
import json
import re
import sys

project, logical, physical = sys.argv[1:]
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(2)
if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict):
    raise SystemExit(3)
network = payload[0]
labels = network.get("Labels") or {}
options = network.get("Options") or {}
if network.get("Name") != physical:
    raise SystemExit(4)
if labels.get("com.docker.compose.project") != project:
    raise SystemExit(5)
if labels.get("com.docker.compose.network") != logical:
    raise SystemExit(6)
if network.get("Driver") != "bridge" or network.get("Internal") is not False:
    raise SystemExit(7)
if network.get("Scope") != "local" or network.get("Ingress") is not False:
    raise SystemExit(13)
network_id = network.get("Id", "")
if not re.fullmatch(r"[a-f0-9]{64}", network_id):
    raise SystemExit(8)
bridge = options.get("com.docker.network.bridge.name") or f"br-{network_id[:12]}"
if not re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", bridge):
    raise SystemExit(9)
v4 = []
v6 = []
for item in (network.get("IPAM") or {}).get("Config") or []:
    subnet = item.get("Subnet") if isinstance(item, dict) else None
    if not isinstance(subnet, str):
        continue
    try:
        parsed = ipaddress.ip_network(subnet, strict=True)
    except ValueError:
        raise SystemExit(10)
    target = v4 if parsed.version == 4 else v6
    canonical = str(parsed)
    if canonical in target:
        raise SystemExit(11)
    target.append(canonical)
if len(v4) != 1 or len(v6) > 1:
    raise SystemExit(12)
if network.get("EnableIPv6") is not bool(v6):
    raise SystemExit(14)
print("\t".join((network_id, bridge, ",".join(v4), ",".join(v6))))
' "$project" "$logical" "$physical" 2>/dev/null)" || fail "Docker network failed exact project/label/bridge/IPAM validation: $physical"
  IFS=$'\t' read -r network_id bridge v4 v6 <<<"$validated"
  [[ "$network_id" =~ ^[a-f0-9]{64}$ ]] || fail "validated network identifier is invalid: $physical"
  [[ "$bridge" =~ ^[A-Za-z0-9_.-]{1,15}$ ]] || fail "validated bridge name is invalid: $physical"
  [[ -n "$v4" ]] || fail "validated network has no IPv4 subnet: $physical"
  physical_networks+=("$physical")
  network_ids+=("$network_id")
  bridge_names+=("$bridge")
  ipv4_subnets+=("$v4")
  ipv6_subnets+=("$v6")
}

write_network_manifest() {
  local output="$1"
  : > "$output"
  local index
  for index in "${!logical_networks[@]}"; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${logical_networks[$index]}" \
      "${physical_networks[$index]:-${project}_${logical_networks[$index]}}" \
      "${network_ids[$index]:-unresolved}" \
      "${bridge_names[$index]:-unresolved}" \
      "${ipv4_subnets[$index]:-}" \
      "${ipv6_subnets[$index]:-}" \
      "${policy_ports[$index]}" >> "$output"
  done
}

state_parent="$state_dir"
if [[ ! -e "$state_parent" ]]; then
  install -d -m 0700 -- "$state_parent"
fi
[[ -d "$state_parent" && ! -L "$state_parent" ]] || fail "state directory must be a real directory"
if [[ "$action" != "dry-run" ]]; then
  assert_secure_root_directory "$state_parent"
fi
[[ ! -L "$state_file" ]] || fail "state file must not be a symlink"
if [[ "$evidence_file" != "-" ]]; then
  [[ ! -L "$evidence_file" ]] || fail "evidence file must not be a symlink"
  evidence_parent="$(dirname -- "$evidence_file")"
  if [[ ! -e "$evidence_parent" ]]; then
    install -d -m 0700 -- "$evidence_parent"
  fi
  [[ -d "$evidence_parent" && ! -L "$evidence_parent" ]] || fail "evidence parent must be a real directory"
  if [[ "$action" != "dry-run" ]]; then
    assert_secure_root_directory "$evidence_parent"
  fi
fi

manifest_file="$(mktemp "${state_dir}/.egress-network.XXXXXX")"
rules_file="$(mktemp "${state_dir}/.egress-rules.XXXXXX")"
chmod 0600 "$manifest_file" "$rules_file"
cleanup() {
  rm -f -- "$manifest_file" "$rules_file"
}
trap cleanup EXIT

if [[ "$action" != "remove" ]]; then
  for logical in "${logical_networks[@]}"; do
    inspect_network "$logical"
  done
fi
write_network_manifest "$manifest_file"
network_sha256="$(sha256sum -- "$manifest_file" | awk '{print $1}')"

has_ipv6=false
for subnet in "${ipv6_subnets[@]:-}"; do
  [[ -z "$subnet" ]] || has_ipv6=true
done

docker_firewall_backend="$(docker info --format '{{.FirewallBackend}}' 2>/dev/null || true)"
case "$docker_firewall_backend" in
  iptables|nftables) ;;
  ""|"<no value>")
    if command -v iptables >/dev/null 2>&1 && iptables -w 5 -t filter -S DOCKER-USER >/dev/null 2>&1; then
      docker_firewall_backend="iptables"
    else
      fail "Docker firewall backend is not reported and cannot be proven from DOCKER-USER"
    fi
    ;;
  *) fail "Docker reported an unsupported firewall backend" ;;
esac

select_backend() {
  local candidate="$requested_backend"
  if [[ "$candidate" == "auto" ]]; then
    if [[ "$docker_firewall_backend" == "iptables" ]]; then
      candidate="iptables"
    else
      candidate="nft"
    fi
  fi
  if [[ "$candidate" == "iptables" ]]; then
    [[ "$docker_firewall_backend" == "iptables" ]] || fail "iptables backend does not match Docker's reported firewall backend"
    [[ "$has_ipv6" == "false" ]] || fail "iptables backend is IPv4-only; dual-stack requires native nftables"
    for command in iptables iptables-save iptables-restore; do
      command -v "$command" >/dev/null 2>&1 || fail "iptables backend command is missing: $command"
    done
    iptables -w 5 -t filter -S DOCKER-USER >/dev/null 2>&1 || fail "Docker DOCKER-USER chain is unavailable"
  else
    [[ "$docker_firewall_backend" == "nftables" ]] || fail "native nft backend does not match Docker's reported firewall backend"
    command -v nft >/dev/null 2>&1 || fail "nft backend command is missing: nft"
    nft list ruleset >/dev/null 2>&1 || fail "nftables ruleset is unavailable"
  fi
  printf '%s' "$candidate"
}

read_state_value() {
  local key="$1"
  local value
  [[ -f "$state_file" && ! -L "$state_file" ]] || return 1
  value="$(awk -F= -v expected="$key" '$1 == expected { if (seen++) exit 2; print substr($0, length($1) + 2) }' "$state_file")" || return 1
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

state_backend=""
state_ruleset_sha256=""
installed_state_present=false
if [[ "$action" == "apply" || "$action" == "dry-run" || "$action" == "verify" || "$action" == "remove" ]]; then
  if [[ -f "$state_file" && ! -L "$state_file" ]]; then
    installed_state_present=true
    [[ "$(stat -c '%u:%a' "$state_file")" == "0:600" ]] || fail "installed state must be root-owned with mode 0600"
    [[ "$(wc -l < "$state_file" | tr -d ' ')" == "9" ]] || fail "state file has an invalid field count"
    [[ "$(read_state_value schema)" == "$STATE_SCHEMA" ]] || fail "state schema is unsupported"
    [[ "$(read_state_value control)" == "$CONTROL_ID" ]] || fail "state control identifier is invalid"
    [[ "$(read_state_value project)" == "$project" ]] || fail "state project does not match --project"
    state_backend="$(read_state_value backend)"
    [[ "$state_backend" =~ ^(iptables|nft)$ ]] || fail "state backend is invalid"
    state_docker_firewall_backend="$(read_state_value docker_firewall_backend)"
    [[ "$state_docker_firewall_backend" =~ ^(iptables|nftables)$ ]] || fail "state Docker firewall backend is invalid"
    state_policy_sha256="$(read_state_value policy_sha256)"
    state_script_sha256="$(read_state_value script_sha256)"
    state_network_sha256="$(read_state_value network_sha256)"
    state_ruleset_sha256="$(read_state_value ruleset_sha256)"
    [[ "$state_policy_sha256" =~ ^[a-f0-9]{64}$ && "$state_script_sha256" =~ ^[a-f0-9]{64}$ && "$state_network_sha256" =~ ^[a-f0-9]{64}$ && "$state_ruleset_sha256" =~ ^[a-f0-9]{64}$ ]] || fail "state digest is invalid"
    if [[ "$action" == "verify" ]]; then
      [[ "$state_docker_firewall_backend" == "$docker_firewall_backend" ]] || fail "live Docker firewall backend differs from installed state"
      [[ "$state_policy_sha256" == "$policy_sha256" ]] || fail "installed policy digest does not match the requested policy"
      [[ "$state_script_sha256" == "$script_sha256" ]] || fail "installed script digest does not match the executing script"
      [[ "$state_network_sha256" == "$network_sha256" ]] || fail "live Docker network manifest differs from installed state"
    fi
    [[ "$requested_backend" == "auto" || "$requested_backend" == "$state_backend" ]] || fail "requested backend does not match installed state"
  elif [[ "$action" == "verify" ]]; then
    fail "installed state is missing"
  fi
fi

if [[ -n "$state_backend" ]]; then
  backend="$state_backend"
elif [[ "$action" == "remove" ]]; then
  backend="$requested_backend"
  [[ "$backend" != "auto" ]] || backend="iptables"
else
  backend="$(select_backend)"
fi
if [[ "$action" != "remove" && "$backend" == "iptables" && "$has_ipv6" == "true" ]]; then
  fail "installed iptables state cannot cover the live dual-stack networks; remove it and apply native nftables"
fi
if [[ "$action" != "remove" ]]; then
  if [[ "$backend" == "iptables" && "$docker_firewall_backend" != "iptables" ]] \
    || [[ "$backend" == "nft" && "$docker_firewall_backend" != "nftables" ]]; then
    fail "installed control backend no longer matches Docker's firewall backend; controlled removal is required"
  fi
fi

append_iptables_rules() {
  local family="$1"
  local blocked_name="$2"
  local -n blocked_ranges="$blocked_name"
  local index range entry protocol port subnet_csv subnet
  local expected_count=0
  for index in "${!logical_networks[@]}"; do
    if [[ "$family" == "4" ]]; then
      subnet_csv="${ipv4_subnets[$index]}"
    else
      subnet_csv="${ipv6_subnets[$index]}"
      [[ -n "$subnet_csv" ]] || continue
    fi
    printf -- '-A %s -i %s -o %s -m comment --comment %s-same-%s -j RETURN\n' \
      "$forward_chain" "${bridge_names[$index]}" "${bridge_names[$index]}" "$forward_marker" "${logical_networks[$index]}" >> "$rules_file"
    ((expected_count += 1))
    for range in "${blocked_ranges[@]}"; do
      printf -- '-A %s -i %s -d %s -m comment --comment %s-deny-%s -j DROP\n' \
        "$forward_chain" "${bridge_names[$index]}" "$range" "$forward_marker" "${logical_networks[$index]}" >> "$rules_file"
      ((expected_count += 1))
    done
    IFS=',' read -r -a entries <<<"${policy_ports[$index]}"
    for entry in "${entries[@]}"; do
      protocol="${entry%%:*}"
      port="${entry##*:}"
      printf -- '-A %s -i %s -p %s -m %s --dport %s -m comment --comment %s-allow-%s-%s-%s -j RETURN\n' \
        "$forward_chain" "${bridge_names[$index]}" "$protocol" "$protocol" "$port" "$forward_marker" \
        "${logical_networks[$index]}" "$protocol" "$port" >> "$rules_file"
      ((expected_count += 1))
    done
    printf -- '-A %s -i %s -m comment --comment %s-default-%s -j DROP\n' \
      "$forward_chain" "${bridge_names[$index]}" "$forward_marker" "${logical_networks[$index]}" >> "$rules_file"
    printf -- '-A %s -i %s -m comment --comment %s-host-%s -j DROP\n' \
      "$input_chain" "${bridge_names[$index]}" "$input_marker" "${logical_networks[$index]}" >> "$rules_file"
    ((expected_count += 2))
    IFS=',' read -r -a subnets <<<"$subnet_csv"
    for subnet in "${subnets[@]}"; do
      [[ -n "$subnet" ]] || fail "empty validated subnet"
    done
  done
  printf '%s' "$expected_count"
}

generate_iptables_restore() {
  local family="$1"
  local binary_save="$2"
  local blocked_name="$3"
  local restore_file="$4"
  local existing forward_marker_count input_marker_count forward_present input_present expected_count
  existing="$($binary_save -t filter 2>/dev/null)" || fail "cannot inspect $family-bit filter table"
  forward_marker_count="$(printf '%s\n' "$existing" | grep -c -- "$forward_marker" || true)"
  input_marker_count="$(printf '%s\n' "$existing" | grep -c -- "$input_marker" || true)"
  forward_present=false
  input_present=false
  if printf '%s\n' "$existing" | grep -q -- "^-A DOCKER-USER .*--comment \"\?${forward_marker}\"\?.*-j ${forward_chain}$"; then
    forward_present=true
  fi
  if printf '%s\n' "$existing" | grep -q -- "^-A INPUT .*--comment \"\?${input_marker}\"\?.*-j ${input_chain}$"; then
    input_present=true
  fi
  [[ "$(printf '%s\n' "$existing" | grep -c -- "^-A DOCKER-USER .*${forward_marker}.*-j ${forward_chain}$" || true)" -le 1 ]] || fail "duplicate owned DOCKER-USER jumps detected"
  [[ "$(printf '%s\n' "$existing" | grep -c -- "^-A INPUT .*${input_marker}.*-j ${input_chain}$" || true)" -le 1 ]] || fail "duplicate owned INPUT jumps detected"
  [[ "$(printf '%s\n' "$existing" | grep -c -- "^-A DOCKER-USER .*-j ${forward_chain}$" || true)" == "$(printf '%s\n' "$existing" | grep -c -- "^-A DOCKER-USER .*${forward_marker}.*-j ${forward_chain}$" || true)" ]] || fail "foreign reference to owned forward chain detected"
  [[ "$(printf '%s\n' "$existing" | grep -c -- "^-A INPUT .*-j ${input_chain}$" || true)" == "$(printf '%s\n' "$existing" | grep -c -- "^-A INPUT .*${input_marker}.*-j ${input_chain}$" || true)" ]] || fail "foreign reference to owned input chain detected"
  if printf '%s\n' "$existing" | grep -q -- "^:${forward_chain} " && [[ "$forward_marker_count" == "0" ]]; then
    fail "unowned forward chain collision detected"
  fi
  if printf '%s\n' "$existing" | grep -q -- "^:${input_chain} " && [[ "$input_marker_count" == "0" ]]; then
    fail "unowned input chain collision detected"
  fi
  {
    printf '*filter\n'
    printf ':%s - [0:0]\n' "$forward_chain"
    printf ':%s - [0:0]\n' "$input_chain"
    printf -- '-F %s\n' "$forward_chain"
    printf -- '-F %s\n' "$input_chain"
  } > "$restore_file"
  : > "$rules_file"
  expected_count="$(append_iptables_rules "$family" "$blocked_name")"
  cat "$rules_file" >> "$restore_file"
  if [[ "$forward_present" == "true" ]]; then
    printf -- '-D DOCKER-USER -m comment --comment %s -j %s\n' "$forward_marker" "$forward_chain" >> "$restore_file"
  fi
  if [[ "$input_present" == "true" ]]; then
    printf -- '-D INPUT -m comment --comment %s -j %s\n' "$input_marker" "$input_chain" >> "$restore_file"
  fi
  printf -- '-I DOCKER-USER 1 -m comment --comment %s -j %s\n' "$forward_marker" "$forward_chain" >> "$restore_file"
  printf -- '-I INPUT 1 -m comment --comment %s -j %s\n' "$input_marker" "$input_chain" >> "$restore_file"
  printf 'COMMIT\n' >> "$restore_file"
  printf '%s' "$expected_count"
}

verify_iptables_family() {
  local family="$1"
  local binary="$2"
  local binary_save="$3"
  local blocked_name="$4"
  local expected_count actual_count line first_forward first_input saved
  : > "$rules_file"
  expected_count="$(append_iptables_rules "$family" "$blocked_name")"
  "$binary" -w 5 -t filter -C DOCKER-USER -m comment --comment "$forward_marker" -j "$forward_chain" >/dev/null 2>&1 || fail "$family-bit DOCKER-USER ownership jump is missing"
  "$binary" -w 5 -t filter -C INPUT -m comment --comment "$input_marker" -j "$input_chain" >/dev/null 2>&1 || fail "$family-bit INPUT ownership jump is missing"
  first_forward="$("$binary" -w 5 -t filter -S DOCKER-USER 2>/dev/null | awk '$1 == "-A" { print; exit }')"
  first_input="$("$binary" -w 5 -t filter -S INPUT 2>/dev/null | awk '$1 == "-A" { print; exit }')"
  [[ "$first_forward" == *"$forward_marker"* && "$first_forward" == *"-j $forward_chain"* ]] || fail "$family-bit DOCKER-USER ownership jump is not first"
  [[ "$first_input" == *"$input_marker"* && "$first_input" == *"-j $input_chain"* ]] || fail "$family-bit INPUT ownership jump is not first"
  saved="$("$binary_save" -t filter 2>/dev/null)" || fail "cannot inspect $family-bit installed rules"
  [[ "$(printf '%s\n' "$saved" | grep -c -- "^-A DOCKER-USER .*${forward_marker}.*-j ${forward_chain}$" || true)" == "1" ]] || fail "$family-bit DOCKER-USER ownership jump count is not one"
  [[ "$(printf '%s\n' "$saved" | grep -c -- "^-A INPUT .*${input_marker}.*-j ${input_chain}$" || true)" == "1" ]] || fail "$family-bit INPUT ownership jump count is not one"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    read -r -a argv <<<"$line"
    "$binary" -w 5 -t filter -C "${argv[@]:1}" >/dev/null 2>&1 || fail "$family-bit owned rule verification failed"
  done < "$rules_file"
  actual_count="$("$binary" -w 5 -t filter -S "$forward_chain" 2>/dev/null | grep -c '^-A ' || true)"
  actual_count="$((actual_count + $("$binary" -w 5 -t filter -S "$input_chain" 2>/dev/null | grep -c '^-A ' || true)))"
  [[ "$actual_count" == "$expected_count" ]] || fail "$family-bit owned chain contains unexpected rules"
  printf '%s\n' "$saved" | grep -E -- "(^:${forward_chain} |^:${input_chain} |${forward_marker}|${input_marker}|^-A ${forward_chain} |^-A ${input_chain} )"
}

apply_iptables() {
  local restore4 expected
  restore4="$(mktemp "${state_dir}/.egress-restore4.XXXXXX")"
  chmod 0600 "$restore4"
  expected="$(generate_iptables_restore 4 iptables-save BLOCKED_IPV4 "$restore4")"
  [[ "$expected" =~ ^[1-9][0-9]*$ ]] || fail "IPv4 ruleset is empty"
  iptables-restore --test --noflush --wait 5 < "$restore4" >/dev/null 2>&1 || { rm -f "$restore4"; fail "IPv4 ruleset preflight failed"; }
  iptables-restore --noflush --wait 5 < "$restore4" >/dev/null 2>&1 || { rm -f "$restore4"; fail "atomic IPv4 ruleset apply failed"; }
  rm -f "$restore4"
}

dump_iptables_owned() {
  verify_iptables_family 4 iptables iptables-save BLOCKED_IPV4
}

capture_iptables_owned() {
  local owned_file
  owned_file="$(mktemp "${state_dir}/.egress-owned.XXXXXX")"
  chmod 0600 "$owned_file"
  dump_iptables_owned > "$owned_file"
  mv -f -- "$owned_file" "$rules_file"
  chmod 0600 "$rules_file"
}

remove_iptables_family() {
  local binary="$1"
  local binary_save="${binary}-save"
  local chain_exists=false
  local input_exists=false
  local saved foreign_count
  if "$binary" -w 5 -t filter -S "$forward_chain" >/dev/null 2>&1; then chain_exists=true; fi
  if "$binary" -w 5 -t filter -S "$input_chain" >/dev/null 2>&1; then input_exists=true; fi
  if [[ "$chain_exists" == "true" || "$input_exists" == "true" ]]; then
    [[ "$installed_state_present" == "true" && "$state_backend" == "iptables" ]] || fail "refusing to remove iptables chains without matching sealed state"
    command -v "$binary_save" >/dev/null 2>&1 || fail "iptables ownership inspection command is missing: $binary_save"
    saved="$($binary_save -t filter 2>/dev/null)" || fail "cannot inspect iptables ownership before removal"
    foreign_count="$(printf '%s\n' "$saved" | awk -v forward="$forward_chain" -v input="$input_chain" -v fm="$forward_marker" -v im="$input_marker" '
      $1 == "-A" && $2 == forward && index($0, fm) == 0 { count++ }
      $1 == "-A" && $2 == input && index($0, im) == 0 { count++ }
      $1 == "-A" && $2 != forward && $2 != input && $0 ~ ("-j " forward "$") && index($0, fm) == 0 { count++ }
      $1 == "-A" && $2 != forward && $2 != input && $0 ~ ("-j " input "$") && index($0, im) == 0 { count++ }
      END { print count + 0 }
    ')"
    [[ "$foreign_count" == "0" ]] || fail "refusing to remove iptables chains with foreign rules or references"
  fi
  while "$binary" -w 5 -t filter -C DOCKER-USER -m comment --comment "$forward_marker" -j "$forward_chain" >/dev/null 2>&1; do
    "$binary" -w 5 -t filter -D DOCKER-USER -m comment --comment "$forward_marker" -j "$forward_chain" >/dev/null
  done
  while "$binary" -w 5 -t filter -C INPUT -m comment --comment "$input_marker" -j "$input_chain" >/dev/null 2>&1; do
    "$binary" -w 5 -t filter -D INPUT -m comment --comment "$input_marker" -j "$input_chain" >/dev/null
  done
  if [[ "$chain_exists" == "true" ]]; then
    "$binary" -w 5 -t filter -F "$forward_chain" >/dev/null
    "$binary" -w 5 -t filter -X "$forward_chain" >/dev/null
  fi
  if [[ "$input_exists" == "true" ]]; then
    "$binary" -w 5 -t filter -F "$input_chain" >/dev/null
    "$binary" -w 5 -t filter -X "$input_chain" >/dev/null
  fi
}

nft_port_expression() {
  local protocol="$1"
  local ports_csv="$2"
  local values=""
  local entry port
  IFS=',' read -r -a entries <<<"$ports_csv"
  for entry in "${entries[@]}"; do
    [[ "${entry%%:*}" == "$protocol" ]] || continue
    port="${entry##*:}"
    values+="${values:+, }${port}"
  done
  [[ -n "$values" ]] || return 1
  if [[ "$values" == *,* ]]; then printf '{ %s }' "$values"; else printf '%s' "$values"; fi
}

generate_nft_ruleset() {
  local include_delete="$1"
  local index blocked ports
  {
    if [[ "$include_delete" == "true" ]]; then
      printf 'delete table inet %s\n' "$nft_table"
    fi
    printf 'table inet %s {\n' "$nft_table"
    printf '  chain forward {\n'
    printf '    type filter hook forward priority -10; policy accept;\n'
    for index in "${!logical_networks[@]}"; do
      printf '    iifname "%s" oifname "%s" accept comment "%s-same-%s"\n' "${bridge_names[$index]}" "${bridge_names[$index]}" "$forward_marker" "${logical_networks[$index]}"
      printf '    iifname "%s" ip daddr 169.254.169.254 drop comment "%s-metadata4-%s"\n' "${bridge_names[$index]}" "$forward_marker" "${logical_networks[$index]}"
      printf '    iifname "%s" ip daddr { ' "${bridge_names[$index]}"
      printf '%s, ' "${BLOCKED_IPV4[@]:1:${#BLOCKED_IPV4[@]}-2}"
      printf '%s } drop comment "%s-deny4-%s"\n' "${BLOCKED_IPV4[-1]}" "$forward_marker" "${logical_networks[$index]}"
      if [[ -n "${ipv6_subnets[$index]}" ]]; then
        printf '    iifname "%s" ip6 daddr fd00:ec2::254 drop comment "%s-metadata6-%s"\n' "${bridge_names[$index]}" "$forward_marker" "${logical_networks[$index]}"
        printf '    iifname "%s" ip6 daddr { ' "${bridge_names[$index]}"
        printf '%s, ' "${BLOCKED_IPV6[@]:1:${#BLOCKED_IPV6[@]}-2}"
        printf '%s } drop comment "%s-deny6-%s"\n' "${BLOCKED_IPV6[-1]}" "$forward_marker" "${logical_networks[$index]}"
      fi
      if ports="$(nft_port_expression tcp "${policy_ports[$index]}")"; then
        printf '    iifname "%s" tcp dport %s accept comment "%s-allow-tcp-%s"\n' "${bridge_names[$index]}" "$ports" "$forward_marker" "${logical_networks[$index]}"
      fi
      if ports="$(nft_port_expression udp "${policy_ports[$index]}")"; then
        printf '    iifname "%s" udp dport %s accept comment "%s-allow-udp-%s"\n' "${bridge_names[$index]}" "$ports" "$forward_marker" "${logical_networks[$index]}"
      fi
      printf '    iifname "%s" drop comment "%s-default-%s"\n' "${bridge_names[$index]}" "$forward_marker" "${logical_networks[$index]}"
    done
    printf '  }\n'
    printf '  chain input {\n'
    printf '    type filter hook input priority -10; policy accept;\n'
    for index in "${!logical_networks[@]}"; do
      printf '    iifname "%s" drop comment "%s-host-%s"\n' "${bridge_names[$index]}" "$input_marker" "${logical_networks[$index]}"
    done
    printf '  }\n'
    printf '}\n'
  } > "$rules_file"
}

apply_nft() {
  local include_delete=false
  if nft list table inet "$nft_table" >/dev/null 2>&1; then include_delete=true; fi
  generate_nft_ruleset "$include_delete"
  nft --check -f "$rules_file" >/dev/null 2>&1 || fail "generated nftables policy failed syntax validation"
  nft -f "$rules_file" >/dev/null 2>&1 || fail "atomic nftables policy apply failed"
}

dump_nft_owned() {
  local json expected_count index protocols
  json="$(nft -j list table inet "$nft_table" 2>/dev/null)" || fail "owned nftables table is missing"
  expected_count=0
  for index in "${!logical_networks[@]}"; do
    protocols="$(printf '%s' "${policy_ports[$index]}" | tr ',' '\n' | cut -d: -f1 | sort -u | wc -l | tr -d ' ')"
    expected_count="$((expected_count + 5 + protocols))"
    if [[ -n "${ipv6_subnets[$index]}" ]]; then
      expected_count="$((expected_count + 2))"
    fi
  done
  printf '%s' "$json" | python3 -c '
import json
import sys

table_name, forward_marker, input_marker, expected_raw = sys.argv[1:]
expected = int(expected_raw)
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(2)
entries = payload.get("nftables") if isinstance(payload, dict) else None
if not isinstance(entries, list):
    raise SystemExit(3)
tables = []
chains = {}
comments = []
for entry in entries:
    if not isinstance(entry, dict) or len(entry) != 1:
        raise SystemExit(4)
    kind, value = next(iter(entry.items()))
    if kind == "metainfo":
        continue
    if kind == "table":
        if value.get("family") != "inet" or value.get("name") != table_name:
            raise SystemExit(5)
        tables.append(value)
        continue
    if kind == "chain":
        if value.get("family") != "inet" or value.get("table") != table_name:
            raise SystemExit(6)
        name = value.get("name")
        if name not in ("forward", "input") or name in chains:
            raise SystemExit(7)
        if value.get("type") != "filter" or value.get("hook") != name or value.get("prio") != -10 or value.get("policy") != "accept":
            raise SystemExit(8)
        chains[name] = value
        continue
    if kind == "rule":
        if value.get("family") != "inet" or value.get("table") != table_name:
            raise SystemExit(9)
        chain = value.get("chain")
        comment = value.get("comment")
        marker = forward_marker if chain == "forward" else input_marker if chain == "input" else None
        if marker is None or not isinstance(comment, str) or not comment.startswith(marker):
            raise SystemExit(10)
        comments.append(comment)
        continue
    raise SystemExit(11)
if len(tables) != 1 or set(chains) != {"forward", "input"}:
    raise SystemExit(12)
if len(comments) != expected or len(set(comments)) != expected:
    raise SystemExit(13)
' "$nft_table" "$forward_marker" "$input_marker" "$expected_count" 2>/dev/null || fail "owned nftables table failed exact structure/ownership validation"
  printf '%s' "$json"
}

remove_nft() {
  if nft list table inet "$nft_table" >/dev/null 2>&1; then
    local listed
    [[ "$installed_state_present" == "true" && "$state_backend" == "nft" ]] || fail "refusing to remove nftables table without matching sealed state"
    listed="$(nft -j list table inet "$nft_table" 2>/dev/null)" || fail "cannot inspect owned nftables table"
    printf '%s' "$listed" | python3 -c '
import json
import sys

table_name, forward_marker, input_marker = sys.argv[1:]
try:
    entries = json.load(sys.stdin).get("nftables")
except Exception:
    raise SystemExit(2)
if not isinstance(entries, list):
    raise SystemExit(3)
tables = 0
rules = 0
for entry in entries:
    if "table" in entry:
        value = entry["table"]
        if value.get("family") != "inet" or value.get("name") != table_name:
            raise SystemExit(4)
        tables += 1
    elif "rule" in entry:
        value = entry["rule"]
        marker = forward_marker if value.get("chain") == "forward" else input_marker if value.get("chain") == "input" else None
        if value.get("table") != table_name or marker is None or not str(value.get("comment", "")).startswith(marker):
            raise SystemExit(5)
        rules += 1
    elif "chain" in entry or "metainfo" in entry:
        continue
    else:
        raise SystemExit(6)
if tables != 1 or rules < 1:
    raise SystemExit(7)
' "$nft_table" "$forward_marker" "$input_marker" 2>/dev/null || fail "refusing to remove an nftables table with foreign ownership"
    printf 'delete table inet %s\n' "$nft_table" > "$rules_file"
    nft -f "$rules_file" >/dev/null 2>&1 || fail "nftables table removal failed"
  fi
}

write_state() {
  local ruleset_sha256="$1"
  local temporary
  temporary="$(mktemp "${state_dir}/.docker-egress-state.XXXXXX")"
  chmod 0600 "$temporary"
  {
    printf 'schema=%s\n' "$STATE_SCHEMA"
    printf 'control=%s\n' "$CONTROL_ID"
    printf 'project=%s\n' "$project"
    printf 'backend=%s\n' "$backend"
    printf 'docker_firewall_backend=%s\n' "$docker_firewall_backend"
    printf 'policy_sha256=%s\n' "$policy_sha256"
    printf 'script_sha256=%s\n' "$script_sha256"
    printf 'network_sha256=%s\n' "$network_sha256"
    printf 'ruleset_sha256=%s\n' "$ruleset_sha256"
  } > "$temporary"
  mv -f -- "$temporary" "$state_file"
  chmod 0600 "$state_file"
}

write_evidence() {
  local status="$1"
  local ruleset_sha256="$2"
  local temporary output
  output="$(python3 - "$manifest_file" "$action" "$status" "$backend" "$docker_firewall_backend" "$project" "$policy_sha256" "$script_sha256" "$network_sha256" "$ruleset_sha256" <<'PY'
import datetime
import hashlib
import json
import sys

manifest, action, status, backend, docker_backend, project, policy_hash, script_hash, network_hash, ruleset_hash = sys.argv[1:]
networks = []
with open(manifest, encoding="utf-8") as handle:
    for raw in handle:
        logical, physical, network_id, bridge, v4, v6, allowed = raw.rstrip("\n").split("\t")
        networks.append({
            "logicalName": logical,
            "physicalName": physical,
            "networkIdSha256": hashlib.sha256(network_id.encode("ascii")).hexdigest() if network_id != "unresolved" else "unresolved",
            "bridge": bridge,
            "ipv4Subnets": [value for value in v4.split(",") if value],
            "ipv6Subnets": [value for value in v6.split(",") if value],
            "allowedDestinations": "global-unicast-only",
            "allowedPorts": [
                {"protocol": item.split(":", 1)[0], "port": int(item.split(":", 1)[1])}
                for item in allowed.split(",")
            ],
        })
payload = {
    "schemaVersion": 1,
    "control": "q-academy.docker-egress-firewall",
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "action": action,
    "status": status,
    "activation": "external-rootserver-operation",
    "backend": backend,
    "dockerFirewallBackend": docker_backend,
    "project": project,
    "policySha256": policy_hash,
    "scriptSha256": script_hash,
    "networkManifestSha256": network_hash,
    "rulesetSha256": ruleset_hash,
    "enforcementPoints": ["forward", "host-input"],
    "blockedDestinationClasses": [
        "cloud-metadata", "loopback", "private", "link-local", "carrier-grade-nat",
        "reserved", "documentation", "benchmark", "multicast", "ipv4-mapped",
        "nat64", "teredo", "6to4", "unique-local"
    ],
    "networks": networks,
}
print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
PY
)" 2>/dev/null || fail "evidence generation failed"
  if [[ "$evidence_file" == "-" ]]; then
    printf '%s\n' "$output"
    return
  fi
  temporary="$(mktemp "$(dirname -- "$evidence_file")/.egress-evidence.XXXXXX")"
  chmod 0600 "$temporary"
  printf '%s\n' "$output" > "$temporary"
  mv -f -- "$temporary" "$evidence_file"
  chmod 0600 "$evidence_file"
}

ruleset_sha256="$(printf '' | sha256sum | awk '{print $1}')"
case "$action" in
  dry-run)
    if [[ "$backend" == "iptables" ]]; then
      : > "$rules_file"
      dry_restore="$(mktemp "${state_dir}/.egress-dry-restore.XXXXXX")"
      chmod 0600 "$dry_restore"
      generate_iptables_restore 4 iptables-save BLOCKED_IPV4 "$dry_restore" >/dev/null
      iptables-restore --test --noflush --wait 5 < "$dry_restore" >/dev/null 2>&1 || { rm -f "$dry_restore"; fail "IPv4 dry-run ruleset preflight failed"; }
      rm -f "$dry_restore"
    else
      generate_nft_ruleset false
      nft --check -f "$rules_file" >/dev/null 2>&1 || fail "nftables dry-run ruleset preflight failed"
    fi
    ruleset_sha256="$(sha256sum -- "$rules_file" | awk '{print $1}')"
    write_evidence "planned" "$ruleset_sha256"
    log "Egress firewall dry-run passed for project ${project}; no firewall or state mutation was performed."
    ;;
  apply)
    if [[ "$backend" == "iptables" ]]; then
      apply_iptables
      capture_iptables_owned
    else
      apply_nft
      dump_nft_owned > "$rules_file"
    fi
    ruleset_sha256="$(sha256sum -- "$rules_file" | awk '{print $1}')"
    write_state "$ruleset_sha256"
    write_evidence "pass" "$ruleset_sha256"
    log "Egress firewall applied and verified for project ${project} using ${backend}."
    ;;
  verify)
    if [[ "$backend" == "iptables" ]]; then
      capture_iptables_owned
    else
      dump_nft_owned > "$rules_file"
    fi
    ruleset_sha256="$(sha256sum -- "$rules_file" | awk '{print $1}')"
    [[ "$ruleset_sha256" == "$state_ruleset_sha256" ]] || fail "live owned ruleset differs from sealed state"
    write_evidence "pass" "$ruleset_sha256"
    log "Egress firewall verification passed for project ${project} using ${backend}."
    ;;
  remove)
    if [[ -z "$state_backend" && "$requested_backend" == "auto" ]]; then
      if [[ "$docker_firewall_backend" == "nftables" ]]; then
        backend="nft"
      else
        backend="iptables"
      fi
    fi
    if [[ "$backend" == "iptables" ]]; then
      for command in iptables; do command -v "$command" >/dev/null 2>&1 || fail "iptables removal command is missing"; done
      remove_iptables_family iptables
      if command -v ip6tables >/dev/null 2>&1; then remove_iptables_family ip6tables; fi
    else
      command -v nft >/dev/null 2>&1 || fail "nft removal command is missing"
      remove_nft
    fi
    write_evidence "removed" "$ruleset_sha256"
    rm -f -- "$state_file"
    log "Egress firewall rules are absent for project ${project}."
    ;;
esac
