import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync("scripts/ops/deploy-release.sh", "utf8");
const reconcile = readFileSync("scripts/ops/reconcile-production.sh", "utf8");
const rollback = readFileSync("scripts/ops/rollback-release.sh", "utf8");
const releaseCommon = readFileSync("scripts/ops/release-common.sh", "utf8");
const operations = [deploy, reconcile, rollback];

test("all production transitions validate both credentials and gate configured AI", () => {
  for (const operation of operations) {
    assert.match(operation, /verify_ai_api_key_file "\$env_file"/);
    assert.match(
      operation,
      /verify_openai_transcription_api_key_file "\$env_file"/,
    );
    assert.match(operation, /verify_ai_credential_separation "\$env_file"/);
    assert.match(operation, /ai_api_key_file_is_configured "\$env_file"/);
    assert.match(operation, /AI_PROVIDER_PREFLIGHT_TIMEOUT_SECONDS/);
    assert.match(
      operation,
      /run --rm --no-deps --no-build --pull never ai-provider-preflight/,
    );

    const firewall = operation.indexOf("docker-egress-firewall.sh\" verify");
    const providerCanary = operation.indexOf("ai-provider-preflight", firewall);
    const appRuntime = operation.indexOf("DATABASE_RUNTIME_SERVICES", providerCanary);
    assert.ok(firewall >= 0, "missing verified host egress gate");
    assert.ok(providerCanary > firewall, "provider canary precedes egress gate");
    assert.ok(appRuntime > providerCanary, "app runtime precedes provider canary");
  }
});

function runCredentialSeparationFixture({
  enabled,
  samePath = false,
  sameContent = false,
  expectAccepted,
}: {
  enabled: boolean;
  samePath?: boolean;
  sameContent?: boolean;
  expectAccepted: boolean;
}) {
  const script = String.raw`
set -euo pipefail
source scripts/ops/release-common.sh
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
text_key="$work/text-key"
transcription_key="$work/transcription-key"
environment="$work/production.env"

printf 'text-provider-fixture' >"$text_key"
if [[ "${samePath ? "true" : "false"}" == "true" ]]; then
  transcription_key="$text_key"
elif [[ "${enabled ? "true" : "false"}" == "false" ]]; then
  : >"$transcription_key"
elif [[ "${sameContent ? "true" : "false"}" == "true" ]]; then
  cp -- "$text_key" "$transcription_key"
else
  printf 'transcription-provider-fixture' >"$transcription_key"
fi

{
  printf 'MEDIA_TRANSCRIPTION_ENABLED=${enabled ? "true" : "false"}\n'
  printf 'AI_API_KEY_SOURCE_FILE=%s\n' "$text_key"
  printf 'OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE=%s\n' "$transcription_key"
} >"$environment"

if verify_ai_credential_separation "$environment" >/dev/null 2>&1; then
  result=accepted
else
  result=rejected
fi
[[ "$result" == "${expectAccepted ? "accepted" : "rejected"}" ]]
`;
  const result = spawnSync("bash", ["-s"], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: script,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
}

test("enabled transcription rejects the text AI credential path", () => {
  runCredentialSeparationFixture({
    enabled: true,
    samePath: true,
    expectAccepted: false,
  });
});

test("enabled transcription rejects identical credentials at distinct paths", () => {
  runCredentialSeparationFixture({
    enabled: true,
    sameContent: true,
    expectAccepted: false,
  });
});

test("enabled transcription accepts distinct credential paths and contents", () => {
  runCredentialSeparationFixture({ enabled: true, expectAccepted: true });
});

test("disabled transcription accepts its empty credential placeholder", () => {
  runCredentialSeparationFixture({ enabled: false, expectAccepted: true });
});

test("Terra canaries use a locally verified release-bound operations image", () => {
  for (const operation of operations) {
    assert.match(operation, /verify_ai_runtime_contract_images /);
    assert.match(
      operation,
      /run --rm --no-deps --no-build --pull never ai-provider-preflight/,
    );
  }
  assert.match(
    releaseCommon,
    /for component in app tenant-ops media-runner media-preflight; do/,
  );
  assert.match(reconcile, /"q-academy-tenant-ops:\$current_tag"/);
  assert.match(
    rollback,
    /target_runtime_components=\(app tenant-ops media-runner media-preflight s3-app-principal-preflight\)/,
  );
});

test("transcription host credential contract distinguishes disabled and enabled modes", () => {
  const script = String.raw`
set -euo pipefail
source scripts/ops/release-common.sh
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
key="$work/transcription-key"
environment="$work/production.env"
Q_TEST_OWNER=1001:1001
Q_TEST_MODE=400

readlink() {
  if [[ "$1" == "-f" && "$2" == "--" ]]; then
    printf '%s\n' "$3"
    return 0
  fi
  command readlink "$@"
}

stat() {
  [[ "$1" == "-c" ]] || return 90
  case "$2" in
    %u:%g) printf '%s\n' "$Q_TEST_OWNER" ;;
    %a) printf '%s\n' "$Q_TEST_MODE" ;;
    %s) wc -c <"$3" | tr -d '[:space:]' ;;
    *) return 91 ;;
  esac
}

write_environment() {
  {
    printf 'MEDIA_TRANSCRIPTION_ENABLED=%s\n' "$1"
    printf 'OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE=%s\n' "$key"
    if (( $# >= 2 )); then
      printf 'OPENAI_TRANSCRIPTION_API_KEY=%s\n' "$2"
    fi
    if (( $# >= 3 )); then
      printf 'OPENAI_API_KEY=%s\n' "$3"
    fi
  } >"$environment"
}

: >"$key"
write_environment false
verify_openai_transcription_api_key_file "$environment"

printf 'provider-key' >"$key"
write_environment true
verify_openai_transcription_api_key_file "$environment"

write_environment false
if verify_openai_transcription_api_key_file "$environment" >/dev/null 2>&1; then exit 20; fi

: >"$key"
write_environment true
if verify_openai_transcription_api_key_file "$environment" >/dev/null 2>&1; then exit 21; fi

printf 'provider-key' >"$key"
write_environment true inline-secret
if verify_openai_transcription_api_key_file "$environment" >/dev/null 2>&1; then exit 22; fi

write_environment true '' legacy-inline-secret
if verify_openai_transcription_api_key_file "$environment" >/dev/null 2>&1; then exit 23; fi

write_environment true
Q_TEST_MODE=440
if verify_openai_transcription_api_key_file "$environment" >/dev/null 2>&1; then exit 24; fi

printf 'transcription-credential-contract-ok\n'
`;
  const result = spawnSync("bash", ["-s"], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: script,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "transcription-credential-contract-ok\n");
});
