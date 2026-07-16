import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const script = source("scripts/ops/docker-egress-firewall.sh");
const policy = source("deploy/security/docker-egress-policy.conf");
const deployment = source("docs/ROOTSERVER_DEPLOYMENT.md");
const threatModel = source("docs/THREAT_MODEL.md");

function parsePolicy(contents: string) {
  const records = contents
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const result = new Map<string, string>();
  for (const record of records) {
    const separator = record.indexOf("=");
    assert.notEqual(separator, -1, `invalid policy record: ${record}`);
    const key = record.slice(0, separator);
    assert.equal(result.has(key), false, `duplicate policy key: ${key}`);
    result.set(key, record.slice(separator + 1));
  }
  return result;
}

test("host egress shell has valid Bash syntax and a side-effect-free help contract", () => {
  const syntax = spawnSync("bash", ["-n", "scripts/ops/docker-egress-firewall.sh"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  const secret = "must-not-appear-in-egress-output";
  const help = spawnSync("bash", ["scripts/ops/docker-egress-firewall.sh", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, SESSION_SECRET: secret },
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /apply[\s\S]*dry-run[\s\S]*verify[\s\S]*remove/);
  assert.doesNotMatch(`${help.stdout}${help.stderr}`, new RegExp(secret));

  const invalid = spawnSync(
    "bash",
    ["scripts/ops/docker-egress-firewall.sh", "dry-run", "--project", "../invalid"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, SESSION_SECRET: secret },
    },
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /project must match/);
  assert.doesNotMatch(`${invalid.stdout}${invalid.stderr}`, new RegExp(secret));
});

test("checked-in policy is minimal, explicit, and contains no secret-shaped values", () => {
  const parsed = parsePolicy(policy);
  assert.deepEqual([...parsed], [
    ["policy_version", "1"],
    ["network.egress", "tcp:80,tcp:443"],
    ["network.proxy", "tcp:80,tcp:443,udp:443"],
  ]);
  assert.doesNotMatch(policy, /(secret|password|token|credential|api[_-]?key)\s*=/i);
});

test("dry-run validates mocked Compose networks and emits parseable evidence without state", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const temporary = mkdtempSync(resolve(root, ".egress-firewall-test-"));
  const relativeTemporary = relative(root, temporary).replaceAll("\\", "/");
  const stateDirectory = resolve(temporary, "state");
  mkdirSync(stateDirectory);
  writeFileSync(
    resolve(temporary, "mock-env.sh"),
    `docker() {
  if [[ "\${1:-}" == "info" ]]; then
    [[ "\${2:-}" == "--format" && "\${3:-}" == "{{.FirewallBackend.Driver}}" ]] || return 1
    printf '%s\\n' "\${MOCK_DOCKER_FIREWALL_BACKEND:-iptables}"
    return 0
  fi
  local physical="\${@: -1}"
  local logical bridge subnet v6 id ipam enable_ipv6
  case "$physical" in
    qa_egress)
      logical="egress"; bridge="qaegr0"; subnet="172.30.0.0/24"; id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;
    qa_proxy)
      logical="proxy"; bridge="qaprox0"; subnet="172.31.0.0/24"; id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ;;
    *) return 1 ;;
  esac
  enable_ipv6="\${MOCK_ENABLE_IPV6:-false}"
  if [[ "$enable_ipv6" == "true" ]]; then
    [[ "$logical" == "egress" ]] && v6="fd00:30::/64" || v6="fd00:31::/64"
    ipam='[{"Subnet":"'"$subnet"'"},{"Subnet":"'"$v6"'"}]'
  else
    ipam='[{"Subnet":"'"$subnet"'"}]'
  fi
  printf '[{"Name":"%s","Id":"%s","Driver":"bridge","Scope":"local","Internal":false,"Ingress":false,"EnableIPv6":%s,"Labels":{"com.docker.compose.project":"qa","com.docker.compose.network":"%s"},"Options":{"com.docker.network.bridge.name":"%s"},"IPAM":{"Config":%s}}]\\n' "$physical" "$id" "$enable_ipv6" "$logical" "$bridge" "$ipam"
}
iptables() { return 0; }
iptables-save() { return 0; }
iptables-restore() { return 0; }
nft() { return 0; }
`,
    "utf8",
  );

  try {
    for (const backend of ["iptables", "nft"]) {
      const command = [
        `export MOCK_DOCKER_FIREWALL_BACKEND=${backend === "nft" ? "nftables" : "iptables"} BASH_ENV="$PWD/${relativeTemporary}/mock-env.sh";`,
        "bash scripts/ops/docker-egress-firewall.sh dry-run",
        `--project qa --backend ${backend}`,
        `--state-dir "$PWD/${relativeTemporary}/state"`,
        `--lock-file "$PWD/${relativeTemporary}/operation-${backend}.lock"`,
        "--evidence -",
      ].join(" ");
      const result = spawnSync("bash", ["-c", command], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const evidenceLine = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("{"));
      assert.ok(evidenceLine, result.stdout);
      const evidence = JSON.parse(evidenceLine) as {
        action: string;
        status: string;
        backend: string;
        project: string;
        activation: string;
        networks: Array<{
          logicalName: string;
          allowedPorts: Array<{ protocol: string; port: number }>;
        }>;
      };
      assert.equal(evidence.action, "dry-run");
      assert.equal(evidence.status, "planned");
      assert.equal(evidence.backend, backend);
      assert.equal(evidence.project, "qa");
      assert.equal(evidence.activation, "external-rootserver-operation");
      assert.deepEqual(
        evidence.networks.map((network) => [network.logicalName, network.allowedPorts]),
        [
          ["egress", [{ protocol: "tcp", port: 80 }, { protocol: "tcp", port: 443 }]],
          [
            "proxy",
            [
              { protocol: "tcp", port: 80 },
              { protocol: "tcp", port: 443 },
              { protocol: "udp", port: 443 },
            ],
          ],
        ],
      );
    }
    const mismatch = spawnSync(
      "bash",
      [
        "-c",
        [
          `export MOCK_DOCKER_FIREWALL_BACKEND=iptables BASH_ENV="$PWD/${relativeTemporary}/mock-env.sh";`,
          "bash scripts/ops/docker-egress-firewall.sh dry-run",
          "--project qa --backend nft",
          `--state-dir "$PWD/${relativeTemporary}/state"`,
          `--lock-file "$PWD/${relativeTemporary}/operation-mismatch.lock"`,
          "--evidence -",
        ].join(" "),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /does not match Docker's reported firewall backend/);
    const dualStack = spawnSync(
      "bash",
      [
        "-c",
        [
          `export MOCK_ENABLE_IPV6=true MOCK_DOCKER_FIREWALL_BACKEND=iptables BASH_ENV="$PWD/${relativeTemporary}/mock-env.sh";`,
          "bash scripts/ops/docker-egress-firewall.sh dry-run",
          "--project qa --backend auto",
          `--state-dir "$PWD/${relativeTemporary}/state"`,
          `--lock-file "$PWD/${relativeTemporary}/operation-dual-stack.lock"`,
          "--evidence -",
        ].join(" "),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(dualStack.status, 0);
    assert.match(dualStack.stderr, /dual-stack requires native nftables/);
    assert.equal(readFileSync(resolve(temporary, "mock-env.sh"), "utf8").includes("secret"), false);
    assert.equal(
      spawnSync("bash", ["-c", `find "$PWD/${relativeTemporary}/state" -type f -print -quit`], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
      "",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("network discovery is exact and rejects a different Compose project or unsafe network", () => {
  assert.match(script, /\^\[a-z0-9\]\[a-z0-9_-\]\{0,47\}\$/);
  assert.match(script, /physical="\$\{project\}_\$\{logical\}"/);
  assert.match(script, /network\.get\("Name"\) != physical/);
  assert.match(script, /labels\.get\("com\.docker\.compose\.project"\) != project/);
  assert.match(script, /labels\.get\("com\.docker\.compose\.network"\) != logical/);
  assert.match(script, /network\.get\("Driver"\) != "bridge"/);
  assert.match(script, /network\.get\("Internal"\) is not False/);
  assert.match(script, /network\.get\("Scope"\) != "local"/);
  assert.match(script, /network\.get\("Ingress"\) is not False/);
  assert.match(script, /network\.get\("EnableIPv6"\) is not bool\(v6\)/);
  assert.match(script, /ipaddress\.ip_network\(subnet, strict=True\)/);
  assert.match(script, /len\(v4\) != 1 or len\(v6\) > 1/);
});

test("stateful return traffic precedes destination denies and new egress ends in default drop", () => {
  for (const range of [
    "169.254.169.254/32",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    "fd00:ec2::254/128",
    "::1/128",
    "64:ff9b::/96",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
  ]) {
    assert.ok(script.includes(`"${range}"`), `missing denied range ${range}`);
  }
  const iptablesGenerator = script.slice(
    script.indexOf("append_iptables_rules()"),
    script.indexOf("generate_iptables_restore()"),
  );
  const nftGenerator = script.slice(
    script.indexOf("generate_nft_ruleset()"),
    script.indexOf("apply_nft()"),
  );
  assert.ok(iptablesGenerator.length > 0);
  assert.ok(nftGenerator.length > 0);
  const iptablesReply = "--ctstate ESTABLISHED,RELATED --ctdir REPLY";
  const iptablesForwardReply = iptablesGenerator.indexOf(iptablesReply);
  const iptablesSameBridge = iptablesGenerator.indexOf("%s-same-%s");
  const iptablesDestinationDenies = iptablesGenerator.indexOf("blocked_ranges[@]");
  const iptablesPortAllows = iptablesGenerator.indexOf("--dport");
  const iptablesDefaultDrop = iptablesGenerator.indexOf("%s-default-%s -j DROP");
  const iptablesInputReply = iptablesGenerator.lastIndexOf(iptablesReply);
  const iptablesHostDrop = iptablesGenerator.indexOf("%s-host-%s -j DROP");
  assert.equal(iptablesGenerator.match(/--ctstate ESTABLISHED,RELATED --ctdir REPLY/g)?.length, 2);
  assert.ok(iptablesForwardReply < iptablesSameBridge);
  assert.ok(iptablesSameBridge < iptablesDestinationDenies);
  assert.ok(iptablesDestinationDenies < iptablesPortAllows);
  assert.ok(iptablesPortAllows < iptablesDefaultDrop);
  assert.ok(iptablesDefaultDrop < iptablesInputReply);
  assert.ok(iptablesInputReply < iptablesHostDrop);

  const nftInputStart = nftGenerator.indexOf("chain input");
  const nftForward = nftGenerator.slice(0, nftInputStart);
  const nftInput = nftGenerator.slice(nftInputStart);
  const nftReply = "ct direction reply ct state { established, related } accept";
  assert.equal(nftGenerator.match(/ct direction reply ct state \{ established, related \} accept/g)?.length, 2);
  assert.ok(nftForward.indexOf(nftReply) < nftForward.indexOf("same-%s"));
  assert.ok(nftForward.indexOf("same-%s") < nftForward.indexOf("metadata4"));
  assert.ok(nftForward.indexOf("metadata4") < nftForward.indexOf("allow-tcp"));
  assert.ok(nftForward.indexOf("allow-tcp") < nftForward.indexOf("default"));
  assert.ok(nftInput.indexOf(nftReply) < nftInput.indexOf("host-%s"));
  assert.match(script, /expected_count="\$\(\(expected_count \+ 7 \+ protocols\)\)"/);
  assert.ok(script.indexOf("blocked_ranges") < script.indexOf("--dport"));
  assert.match(script, /forward_marker[\s\S]*default[\s\S]*-j DROP/);
  assert.match(script, /input_marker[\s\S]*host[\s\S]*-j DROP/);
  assert.match(script, /hook forward priority -10; policy accept/);
  assert.match(script, /hook input priority -10; policy accept/);
});

test("firewall ownership is lock-safe, idempotent, and supports both Docker backends", () => {
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /umask 077/);
  assert.match(script, /flock -n 9/);
  assert.match(script, /protected directory must not be group- or world-writable/);
  assert.match(script, /iptables-restore --noflush --wait 5/);
  assert.match(script, /iptables-restore --test --noflush --wait 5/);
  assert.match(script, /-C DOCKER-USER/);
  assert.match(script, /-C INPUT/);
  assert.match(script, /duplicate owned DOCKER-USER jumps detected/);
  assert.match(script, /unowned forward chain collision detected/);
  assert.match(script, /ownership jump is not first/);
  assert.match(script, /without matching sealed state/);
  assert.match(script, /dual-stack requires native nftables/);
  assert.match(script, /nft --check -f/);
  assert.match(script, /delete table inet/);
  assert.match(script, /docker info --format '\{\{[.]FirewallBackend[.]Driver\}\}'/);
  assert.doesNotMatch(script, /docker info --format '\{\{[.]FirewallBackend\}\}'/);
  assert.match(script, /Docker reported an unsupported firewall backend/);
  assert.match(script, /does not match Docker's reported firewall backend/);
  assert.doesNotMatch(script, /eval\s|^\s*(?:source|\.)\s+["']?\$?policy_file/m);
});

test("verify binds policy, live Docker topology, and the owned kernel ruleset", () => {
  assert.match(script, /policy_sha256=/);
  assert.match(script, /script_sha256=/);
  assert.match(script, /network_sha256=/);
  assert.match(script, /ruleset_sha256=/);
  assert.match(script, /live Docker network manifest differs from installed state/);
  assert.match(script, /live owned ruleset differs from sealed state/);
  assert.match(script, /state file must not be a symlink/);
  assert.match(script, /installed state must be root-owned with mode 0600/);
  assert.match(script, /chmod 0600 "\$state_file"/);
});

test("machine-readable evidence is atomic, non-secret, and operationally scoped", () => {
  for (const field of [
    "schemaVersion",
    "control",
    "generatedAt",
    "activation",
    "backend",
    "dockerFirewallBackend",
    "policySha256",
    "scriptSha256",
    "networkManifestSha256",
    "rulesetSha256",
    "enforcementPoints",
    "blockedDestinationClasses",
    "allowedPorts",
    "networkIdSha256",
  ]) {
    assert.ok(script.includes(`\"${field}\"`), `missing evidence field ${field}`);
  }
  assert.match(script, /mktemp .*\.egress-evidence/);
  assert.match(script, /mv -f -- "\$temporary" "\$evidence_file"/);
  assert.match(script, /never reads the production environment file/);
  assert.doesNotMatch(script, /production\.env|SESSION_SECRET|DATABASE_URL|docker inspect .*Container/);
});

test("rootserver and threat-model docs automate activation but keep host acceptance external", () => {
  assert.match(deployment, /Hostseitige Egress-Durchsetzung/);
  assert.match(deployment, /docker-egress-firewall\.sh dry-run/);
  assert.match(deployment, /docker-egress-firewall\.sh apply/);
  assert.match(deployment, /docker-egress-firewall\.sh verify/);
  assert.match(deployment, /docker-egress-firewall\.sh remove/);
  assert.match(deployment, /DOCKER-USER/);
  assert.match(deployment, /iptables-nft/);
  assert.match(deployment, /q-academy-runtime\.service/);
  assert.match(deployment, /Caddy wird als letzter Dienst gestartet/);
  assert.match(deployment, /externen Rootserver-Abnahme/);
  assert.match(threatModel, /hostseitige Egress-Policy/);
  assert.match(threatModel, /docker\.service/);
  assert.match(threatModel, /letzte, atomare Freigabe/);
  assert.match(threatModel, /Kernel-Ruleset/);
});
