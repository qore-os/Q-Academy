import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function composeService(compose: string, name: string) {
  const marker = `  ${name}:`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `missing Compose service ${name}`);
  const remainder = compose.slice(start + marker.length);
  const next = remainder.search(/^  [a-z0-9][a-z0-9-]*:/m);
  return next === -1 ? remainder : remainder.slice(0, next);
}

test("tenant operations image contains only fixed release-bound entrypoints", () => {
  const dockerfile = source("Dockerfile");
  const entrypoint = source("scripts/ops/tenant-ops-entrypoint.sh");

  assert.match(dockerfile, /^FROM runtime-base AS tenant-ops$/m);
  assert.match(
    dockerfile,
    /COPY --from=production-dependencies --chown=nextjs:nodejs \/app\/node_modules \.\/node_modules/,
  );
  assert.match(dockerfile, /COPY --chown=nextjs:nodejs src\/db \.\/src\/db/);
  assert.match(dockerfile, /COPY --chown=nextjs:nodejs src\/lib \.\/src\/lib/);
  for (const script of [
    "provision-tenant.ts",
    "set-tenant-status.ts",
    "set-tenant-contract.ts",
    "erase-tenant.ts",
    "verify-tenant-erasure-archive.ts",
    "export-audit-events.ts",
    "verify-audit-export.ts",
    "export-user-data.ts",
    "http-slo-smoke.ts",
  ]) {
    assert.match(dockerfile, new RegExp(script.replaceAll(".", "\\.")));
  }
  assert.match(dockerfile, /USER nextjs\s+ENTRYPOINT \["\/usr\/local\/bin\/q-academy-tenant-ops"\]/);
  assert.match(entrypoint, /\[ "\$\(id -u\)" -eq 0 \]/);
  assert.match(entrypoint, /umask 077/);
  assert.doesNotMatch(entrypoint, /\beval\b|\bsh -c\b|\bnpm\b/);
  assert.match(entrypoint, /node --conditions=react-server --import tsx \/app\/scripts\/erase-tenant\.ts "\$@"/);
});

test("dispatcher allowlist is scope-bound and rejects path escapes", () => {
  const entrypoint = source("scripts/ops/tenant-ops-entrypoint.sh");
  for (const command of [
    "tenant:provision",
    "tenant:status",
    "tenant:contract",
    "tenant:erase",
    "tenant:erase:verify",
    "audit:export",
    "audit:verify",
    "user-data:export",
    "test:http-slo",
  ]) {
    assert.match(entrypoint, new RegExp(command.replaceAll(":", "\\:")));
  }
  assert.match(entrypoint, /admin:tenant:provision/);
  assert.match(entrypoint, /export:audit:export/);
  assert.match(entrypoint, /erasure:tenant:erase/);
  assert.match(entrypoint, /verify:audit:verify/);
  assert.match(entrypoint, /http-slo:test:http-slo/);
  assert.match(entrypoint, /\/operations\/input\/\*/);
  assert.match(entrypoint, /\/operations\/output\/\*/);
  assert.match(entrypoint, /readlink -f --/);
  assert.match(entrypoint, /Output mount must support hard links/);
  assert.match(entrypoint, /require_input_file "\$\{1\}\.manifest\.json"/);
  assert.match(entrypoint, /Output manifest must not be a symbolic link/);
  assert.match(entrypoint, /exit 64/);
  assert.match(entrypoint, /exit 77/);
});

test("Compose separates tenant admin, export, erasure, verification and SLO privileges", () => {
  const compose = source("compose.production.yml");
  const runtimeAnchor = compose.slice(
    compose.indexOf("x-tenant-ops-runtime:"),
    compose.indexOf("services:"),
  );
  assert.match(runtimeAnchor, /profiles: \["operations"\]/);
  assert.match(runtimeAnchor, /target: tenant-ops/);
  assert.match(runtimeAnchor, /user: "1001:1001"/);
  assert.match(runtimeAnchor, /read_only: true/);
  assert.match(runtimeAnchor, /pids_limit: 128/);
  assert.match(runtimeAnchor, /cap_drop:\s+- ALL/);
  assert.match(runtimeAnchor, /no-new-privileges:true/);
  assert.match(runtimeAnchor, /logging:\s+driver: none/);

  const admin = composeService(compose, "tenant-admin-ops");
  assert.match(admin, /Q_ACADEMY_OPS_SCOPE: admin/);
  assert.match(admin, /APP_POSTGRES_USER/);
  assert.match(admin, /MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON/);
  assert.match(admin, /DATA_ENCRYPTION_KEY/);
  assert.match(admin, /networks:\s+- database/);
  assert.doesNotMatch(
    admin,
    /OWNER_POSTGRES|AUDIT_EXPORT|MEDIA_S3_(?:APP_)?(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|\begress\b/,
  );

  const exporter = composeService(compose, "tenant-export-ops");
  assert.match(exporter, /Q_ACADEMY_OPS_SCOPE: export/);
  assert.match(exporter, /APP_POSTGRES_USER/);
  assert.match(exporter, /AUDIT_EXPORT_HMAC_KEY/);
  assert.match(exporter, /target: \/operations\/output/);
  assert.doesNotMatch(exporter, /OWNER_POSTGRES|DATA_ENCRYPTION|MEDIA_S3|egress/);

  const erasure = composeService(compose, "tenant-erasure-ops");
  assert.match(erasure, /Q_ACADEMY_OPS_SCOPE: erasure/);
  assert.match(erasure, /OWNER_POSTGRES_USER/);
  assert.match(erasure, /DATA_ENCRYPTION_PREVIOUS_KEYS/);
  assert.match(erasure, /MEDIA_S3_SECRET_ACCESS_KEY/);
  assert.match(erasure, /target: \/operations\/input\s+read_only: true/);
  assert.match(erasure, /target: \/operations\/output/);
  assert.match(erasure, /networks:\s+- database\s+- egress/);

  const verifier = composeService(compose, "artifact-verify-ops");
  assert.match(verifier, /Q_ACADEMY_OPS_SCOPE: verify/);
  assert.match(verifier, /network_mode: none/);
  assert.match(verifier, /target: \/operations\/input\s+read_only: true/);
  assert.doesNotMatch(verifier, /DATABASE_URL|MEDIA_S3|networks:/);

  const slo = composeService(compose, "http-slo-ops");
  assert.match(slo, /Q_ACADEMY_OPS_SCOPE: http-slo/);
  assert.match(slo, /HTTP_SLO_API_KEY_FILE: \/run\/secrets\/http_slo_api_key/);
  assert.match(slo, /HTTP_SLO_API_KEY_SOURCE_FILE/);
  assert.match(slo, /target: \/run\/secrets\/http_slo_api_key\s+read_only: true/);
  assert.match(slo, /create_host_path: false/);
  assert.match(slo, /networks:\s+- proxy/);
  assert.doesNotMatch(slo, /DATABASE_URL|ENCRYPTION|AUDIT_EXPORT|MEDIA_S3|database|egress/);

  const caddy = composeService(compose, "caddy");
  assert.match(caddy, /aliases:\s+- \$\{APP_DOMAIN:/);
});

test("tenant erasure uses an operator-only storage configuration", () => {
  const erasure = source("scripts/erase-tenant.ts");
  assert.match(erasure, /resolveMediaStorageConfiguration\(process\.env\)/);
  assert.match(erasure, /deleteS3Object\(configuration, identity\)/);
  assert.doesNotMatch(erasure, /from "\.\.\/src\/lib\/server-environment"/);
  assert.doesNotMatch(erasure, /from "\.\.\/src\/lib\/media\/storage"/);
});

test("tenant operations image is included in immutable release manifests", () => {
  for (const path of [
    "scripts/ops/create-release-artifact.sh",
    "scripts/ops/publish-release-images.sh",
    "scripts/ops/release-common.sh",
    "scripts/ops/deploy-release.sh",
  ]) {
    const implementation = source(path);
    assert.match(implementation, /tenant-ops|TENANT_OPS/);
  }
  const environment = source("deploy/.env.production.example");
  assert.match(environment, /^AUDIT_EXPORT_HMAC_KEY=$/m);
  assert.match(environment, /^OPERATIONS_INPUT_DIR=\/var\/lib\/q-academy\/operations-input$/m);
  assert.match(environment, /^OPERATIONS_EXPORT_DIR=\/var\/lib\/q-academy\/operations-exports$/m);
  assert.match(environment, /^HTTP_SLO_API_KEY_SOURCE_FILE=\/etc\/q-academy\/http-slo-api-key$/m);
});

test("CI builds and exercises the immutable tenant operations image", () => {
  const workflow = source(".github/workflows/ci.yml");
  assert.match(workflow, /--target tenant-ops/);
  assert.match(workflow, /q-academy-tenant-ops:\$Q_ACADEMY_CI_RELEASE_TAG/);
  assert.match(
    workflow,
    /q-academy-tenant-ops:\$Q_ACADEMY_CI_RELEASE_TAG" help/,
  );
  assert.match(workflow, /definitely-not-allowed/);
  assert.match(workflow, /tenant-ops accepted a command outside its allowlist/);
});

test("rootserver runbooks use only the immutable operator services", () => {
  const deployment = source("docs/ROOTSERVER_DEPLOYMENT.md");
  const operations = source("docs/TENANT_OPERATIONS_RUNBOOK.md");
  assert.match(deployment, /http-slo-ops test:http-slo/);
  assert.match(deployment, /--api-probe true/);
  assert.match(deployment, /courses:read/);
  assert.match(deployment, /OPERATIONS_INPUT_DIR/);
  assert.match(deployment, /OPERATIONS_EXPORT_DIR/);
  assert.doesNotMatch(deployment, /npx tsx scripts\/http-slo-smoke\.ts/);
  for (const service of [
    "tenant-admin-ops",
    "tenant-export-ops",
    "tenant-erasure-ops",
    "artifact-verify-ops",
  ]) {
    assert.match(operations, new RegExp(service));
  }
  assert.doesNotMatch(
    operations,
    /npm run(?: --)? (?:tenant:|audit:|user-data:)/,
  );
});

test("authenticated HTTP SLO probes load credentials only from a mounted file", () => {
  const smoke = source("scripts/http-slo-smoke.ts");
  assert.match(smoke, /HTTP_SLO_API_KEY_FILE/);
  assert.match(smoke, /\/run\/secrets\/http_slo_api_key/);
  assert.match(smoke, /Authorization = `Bearer \$\{apiKey\}`/);
  assert.match(smoke, /\/api\/v1\/courses\?limit=1/);
  assert.doesNotMatch(smoke, /option\("--api-key"\)/);
});
