import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function composeService(compose: string, name: string) {
  const marker = new RegExp(`^  ${name}:[^\\r\\n]*$`, "m").exec(compose);
  assert.ok(marker?.index !== undefined, `missing Compose service ${name}`);
  const remainder = compose.slice(marker.index + marker[0].length);
  const next = remainder.search(/^  [a-z0-9][a-z0-9-]*:/m);
  return next === -1 ? remainder : remainder.slice(0, next);
}

test("Caddy keeps the platform static and gates dynamic TLS through its ask endpoint", () => {
  const caddyfile = source("deploy/Caddyfile");
  assert.match(
    caddyfile,
    /on_demand_tls\s*\{\s*ask http:\/\/127\.0\.0\.1:9080\/api\/internal\/caddy\/tls-ask\s*\}/,
  );
  assert.match(caddyfile, /\{\$CADDY_SITE_ADDRESSES\}\s*\{\s*import app_backend/);
  assert.match(caddyfile, /https:\/\/\s*\{\s*tls\s*\{\s*on_demand\s*\}/);
  assert.doesNotMatch(caddyfile, /\b(?:interval|burst)\b/);
  assert.match(caddyfile, /http:\/\/127\.0\.0\.1:9080\s*\{\s*bind 127\.0\.0\.1/);
  assert.match(caddyfile, /reverse_proxy tls-ask-app:3000/);
  assert.match(
    caddyfile,
    /header_up Authorization "Bearer \{\$CADDY_TLS_ASK_SECRET\}"/,
  );
  assert.match(caddyfile, /@internal_jobs path \/api\/internal\/\*/);
  assert.match(caddyfile, /respond @internal_jobs 404/);
});

test("Compose isolates the ask path and shares its secret only with app and Caddy", () => {
  const compose = source("compose.production.yml");
  const app = composeService(compose, "app");
  const caddy = composeService(compose, "caddy");
  const mediaRunner = composeService(compose, "media-runner");
  const tenantOps = compose.slice(
    compose.indexOf("x-tenant-ops-runtime:"),
    compose.indexOf("services:"),
  );

  for (const service of [app, caddy]) {
    assert.match(service, /CADDY_TLS_ASK_SECRET: \$\{CADDY_TLS_ASK_SECRET:/);
    assert.match(service, /^      tls-ask:$/m);
  }
  assert.match(app, /^          - tls-ask-app$/m);
  assert.match(compose, /^  tls-ask:\s+driver: bridge\s+internal: true$/m);
  assert.doesNotMatch(mediaRunner, /CADDY_TLS_ASK_SECRET|tls-ask/);
  assert.doesNotMatch(tenantOps, /CADDY_TLS_ASK_SECRET|tls-ask/);

  assert.match(source(".env.example"), /^CADDY_TLS_ASK_SECRET=$/m);
  assert.match(
    source("deploy/.env.production.example"),
    /^CADDY_TLS_ASK_SECRET=$/m,
  );
});

test("the internal ask route returns no tenant payload and delegates exact checks", () => {
  const route = source("src/app/api/internal/caddy/tls-ask/route.ts");
  assert.match(route, /authorizeCaddyTlsAskRequest/);
  assert.match(route, /caddyTlsAskHostname/);
  assert.match(route, /isCustomDomainTlsAuthorized/);
  assert.match(route, /new Response\(null/);
  assert.doesNotMatch(route, /Response\.json|organizationId|platformName/);
  assert.match(route, /\? 200 : 404/);
  assert.match(route, /emptyResponse\(503\)/);
});

test("the production image smoke passes canonical tenant and ask configuration", () => {
  const workflow = source(".github/workflows/ci.yml");
  const runtimeStart = workflow.indexOf(
    "docker run --detach --name q-academy-ci-runtime --network host",
  );
  const runtimeImage = workflow.indexOf(
    '"q-academy-app:$Q_ACADEMY_CI_RELEASE_TAG"',
    runtimeStart,
  );
  assert.ok(runtimeStart >= 0 && runtimeImage > runtimeStart);
  const appRuntime = workflow.slice(runtimeStart, runtimeImage);

  assert.match(appRuntime, /-e APP_DOMAIN=academy\.ci\.q-academy\.de/);
  assert.match(appRuntime, /-e DEFAULT_ORGANIZATION_SLUG=q-academy/);
  assert.match(
    appRuntime,
    /-e CADDY_TLS_ASK_SECRET="\$CADDY_TLS_ASK_SECRET"/,
  );
});
