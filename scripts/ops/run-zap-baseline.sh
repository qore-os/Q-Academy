#!/usr/bin/env bash
set -Eeuo pipefail

readonly repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly target_url="http://academy.ci.q-academy.de:3000/"
readonly zap_image="${CI_ZAP_IMAGE:?CI_ZAP_IMAGE must be an immutable ZAP image reference}"
readonly output_dir="$repository_root/.artifacts/zap-baseline"
readonly policy_file="$repository_root/deploy/security/zap-baseline.conf"
readonly context_file="$repository_root/deploy/security/zap-ci.context"
readonly report_file="$output_dir/zap-report.json"
readonly policy_validator="$repository_root/scripts/ci/validate-zap-baseline.ts"
readonly tsx_cli="$repository_root/node_modules/.bin/tsx"

if [[ ! "$zap_image" =~ ^zaproxy/zap-stable:2\.17\.0@sha256:[a-f0-9]{64}$ ]]; then
  echo "CI_ZAP_IMAGE must pin zaproxy/zap-stable 2.17.0 by sha256 digest" >&2
  exit 64
fi

for required_file in "$policy_file" "$context_file" "$policy_validator"; do
  if [[ ! -r "$required_file" ]]; then
    echo "Required ZAP input is not readable: $required_file" >&2
    exit 66
  fi
done

if [[ ! -x "$tsx_cli" ]]; then
  echo "The repository-local tsx executable is required for ZAP policy validation" >&2
  exit 69
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run the pinned OWASP ZAP baseline image" >&2
  exit 69
fi

install -d -m 0777 "$output_dir"
rm -f -- \
  "$output_dir/exit-code.txt" \
  "$output_dir/scanner-exit-code.txt" \
  "$output_dir/scanner-evidence-exit-code.txt" \
  "$output_dir/policy-exit-code.txt" \
  "$output_dir/policy-evidence-exit-code.txt" \
  "$output_dir/policy-validation.txt" \
  "$output_dir/zap-baseline.log" \
  "$output_dir/zap-report.html" \
  "$output_dir/zap-report.json" \
  "$output_dir/zap-report.md" \
  "$output_dir/zap.out"
install -m 0444 "$policy_file" "$output_dir/zap-baseline.conf"
install -m 0444 "$context_file" "$output_dir/zap-ci.context"
printf 'image=%s\ntarget=%s\nmode=baseline-passive\n' \
  "$zap_image" "$target_url" >"$output_dir/run-metadata.txt"

set +e
docker run --rm \
  --network host \
  --add-host academy.ci.q-academy.de:127.0.0.1 \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --pids-limit=512 \
  --memory=2g \
  --memory-swap=2g \
  --cpus=2 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
  --env HOME=/tmp \
  --workdir /zap/wrk \
  --volume "$output_dir:/zap/wrk:rw" \
  "$zap_image" \
  zap-baseline.py \
  --autooff \
  -t "$target_url" \
  -n zap-ci.context \
  -c zap-baseline.conf \
  -m 2 \
  -T 5 \
  -D 5 \
  -z "-silent -dir /tmp/.ZAP" \
  -l WARN \
  -s \
  -r zap-report.html \
  -J zap-report.json \
  -w zap-report.md \
  2>&1 | tee "$output_dir/zap-baseline.log"
scan_pipeline_status=("${PIPESTATUS[@]}")
scan_status="${scan_pipeline_status[0]}"
scan_evidence_status="${scan_pipeline_status[1]}"
set -e

printf '%s\n' "$scan_status" >"$output_dir/scanner-exit-code.txt"
printf '%s\n' "$scan_evidence_status" >"$output_dir/scanner-evidence-exit-code.txt"

# The ZAP baseline configuration can only classify whole rule families. The
# report validator restores sub-alert granularity and therefore runs even when
# the scanner itself fails or cannot produce a report.
set +e
"$tsx_cli" "$policy_validator" "$report_file" \
  2>&1 | tee "$output_dir/policy-validation.txt"
policy_pipeline_status=("${PIPESTATUS[@]}")
policy_status="${policy_pipeline_status[0]}"
policy_evidence_status="${policy_pipeline_status[1]}"
set -e

printf '%s\n' "$policy_status" >"$output_dir/policy-exit-code.txt"
printf '%s\n' "$policy_evidence_status" >"$output_dir/policy-evidence-exit-code.txt"

# Preserve every scanner failure code, especially ZAP's operational-error code
# 3. A validator failure can only turn an otherwise successful scan into a
# failure; it can never mask or rewrite a scanner failure.
if (( scan_status != 0 )); then
  final_status="$scan_status"
elif (( scan_evidence_status != 0 )); then
  final_status="$scan_evidence_status"
elif (( policy_status != 0 )); then
  final_status="$policy_status"
elif (( policy_evidence_status != 0 )); then
  final_status="$policy_evidence_status"
else
  final_status=0
fi

printf '%s\n' "$final_status" >"$output_dir/exit-code.txt"
exit "$final_status"
