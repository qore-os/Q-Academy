import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("production Playwright smoke is isolated from every development server", () => {
  const productionConfig = source("playwright.production-smoke.config.ts");
  const developmentConfig = source("playwright.config.ts");

  assert.match(
    productionConfig,
    /PLAYWRIGHT_PRODUCTION_BASE_URL[\s\S]*protocol !== "https:"/,
  );
  assert.match(
    productionConfig,
    /testMatch: \/production-artifact-smoke\\\.spec\\\.ts\//,
  );
  assert.match(productionConfig, /ignoreHTTPSErrors: true/);
  assert.match(productionConfig, /Desktop Chrome/);
  assert.match(
    productionConfig,
    /--host-resolver-rules=MAP \$\{productionOrigin\.hostname\} 127\.0\.0\.1/,
  );
  assert.doesNotMatch(productionConfig, /webServer|npm run dev/);
  assert.match(
    developmentConfig,
    /testIgnore:[\s\S]*production-artifact-smoke\\\.spec\\\.ts/,
  );
});

test("development Playwright suites require a ready app and a clean CI server", () => {
  for (const configPath of [
    "playwright.config.ts",
    "playwright.cross-browser.config.ts",
  ]) {
    const config = source(configPath);
    assert.match(
      config,
      /url: "http:\/\/127\.0\.0\.1:3000\/api\/v1\/health\/ready"/,
    );
    assert.match(config, /reuseExistingServer: !process\.env\.CI/);
    assert.doesNotMatch(config, /reuseExistingServer: true/);
  }
});

test("production artifact smoke covers login, both central routes, health, and API auth", () => {
  const smoke = source("tests/production-artifact-smoke.spec.ts");

  for (const environmentName of [
    "PLAYWRIGHT_EXPECTED_RELEASE",
    "PLAYWRIGHT_ADMIN_EMAIL",
    "PLAYWRIGHT_MEMBER_EMAIL",
    "PLAYWRIGHT_SEED_PASSWORD",
    "PLAYWRIGHT_API_KEY",
  ]) {
    assert.ok(smoke.includes(environmentName));
  }

  assert.match(smoke, /page\.goto\("\/login"/);
  assert.match(smoke, /input\[name="email"\]/);
  assert.match(smoke, /input\[name="password"\]/);
  assert.match(smoke, /passwordLogin\(page, adminEmail, "\/admin"\)/);
  assert.match(smoke, /passwordLogin\(page, memberEmail, "\/academy"\)/);
  assert.match(smoke, /request\.get\("\/", \{ maxRedirects: 0 \}\)/);
  assert.match(smoke, /expect\(response\.headers\(\)\.location\)\.toBe\("\/login"\)/);
  assert.match(
    smoke,
    /expect\(await response\.text\(\)\)\.toBe\("\/login"\)/,
  );
  assert.match(smoke, /private, no-store, max-age=0, must-revalidate/);
  assert.match(smoke, /toContain\("cookie"\)/);
  assert.match(smoke, /headers\(\)\["x-powered-by"\]/);
  assert.match(smoke, /origin: "https:\/\/foreign-origin\.example"/);
  assert.match(smoke, /const forwardedResponse = await route\.fetch\(/);
  assert.match(smoke, /route\.fetch\(\{[\s\S]*maxRedirects: 0/);
  assert.match(smoke, /await route\.fulfill\(\{ response: forwardedResponse \}\)/);
  assert.doesNotMatch(smoke, /route\.continue\(\{[\s\S]*origin:/);
  assert.match(smoke, /expect\(actionResponse\.status\(\)\)\.toBe\(500\)/);
  assert.match(smoke, /cookie\.name\.endsWith\("q_academy_session"\)/);
  assert.match(smoke, /\/api\/v1\/health\/ready/);
  assert.match(smoke, /version: expectedRelease/);
  assert.match(smoke, /\/api\/v1\/courses\?limit=1/);
  assert.match(smoke, /expect\(anonymous\.status\(\)\)\.toBe\(401\)/);
  assert.match(smoke, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(smoke, /expect\(authenticated\.status\(\)\)\.toBe\(200\)/);
});

test("CI smoke runs against the exact app image before the media worker replaces it", () => {
  const workflow = source(".github/workflows/ci.yml");
  const appReady = workflow.indexOf('if [[ "$app_ready" != true ]]');
  const browserInstall = workflow.indexOf(
    "- name: Install production smoke browser",
  );
  const smokeStart = workflow.indexOf(
    "- name: Smoke-test exact production app image",
  );
  const mediaStart = workflow.indexOf(
    "- name: Smoke-test production media worker",
  );

  assert.ok(
    appReady >= 0 &&
      browserInstall > appReady &&
      smokeStart > browserInstall &&
      mediaStart > smokeStart,
  );

  const installStep = workflow.slice(browserInstall, smokeStart);
  assert.match(
    installStep,
    /npx playwright install --with-deps chromium/,
  );

  const smokeStep = workflow.slice(smokeStart, mediaStart);
  assert.match(
    smokeStep,
    /PLAYWRIGHT_PRODUCTION_BASE_URL: https:\/\/academy\.ci\.q-academy\.de:3443/,
  );
  assert.match(
    smokeStep,
    /docker image inspect --format '\{\{\.Id\}\}' "\$image_reference"/,
  );
  assert.match(
    smokeStep,
    /docker inspect --format '\{\{\.Image\}\}' q-academy-ci-runtime/,
  );
  assert.match(
    smokeStep,
    /"\$running_image_id" != "\$expected_image_id"/,
  );
  assert.match(
    smokeStep,
    /"\$tagged_image_id" != "\$expected_image_id" \|\| "\$running_image_id" != "\$expected_image_id"/,
  );
  assert.match(
    smokeStep,
    /npx playwright test[\s\\]+--config=playwright\.production-smoke\.config\.ts/,
  );
  assert.doesNotMatch(smokeStep, /npm run dev|docker run[^\n]+q-academy-app/);

  const mediaStep = workflow.slice(mediaStart);
  assert.match(mediaStep, /docker rm --force q-academy-ci-runtime/);
  assert.match(
    mediaStep,
    /docker image inspect --format '\{\{json \.Config\.Cmd\}\}' "\$media_image"/,
  );
  assert.match(mediaStep, /"\$configured_media_command" != "\$expected_media_command"/);
  assert.match(
    mediaStep,
    /docker inspect --format '\{\{\.State\.Running\}\}' q-academy-ci-runtime/,
  );
  assert.match(mediaStep, /Media container state: status=/);
});

test("CI provides canonical TLS and a non-development seeded API key", () => {
  const workflow = source(".github/workflows/ci.yml");
  const seed = source("scripts/seed.ts");
  const proxy = source("scripts/ci/production-smoke-tls-proxy.mjs");
  const keyMatch = workflow.match(/^\s+DEMO_API_KEY:\s*(\S+)\s*$/m);

  assert.ok(keyMatch);
  assert.notEqual(keyMatch[1], "qak_demo_qacademy_2026_local_development");
  assert.match(keyMatch[1], /^qak_[A-Za-z0-9_]{24,}$/);
  assert.match(seed, /process\.env\.DEMO_API_KEY/);

  assert.match(
    workflow,
    /RUNTIME_APP_URL: https:\/\/academy\.ci\.q-academy\.de:3443/,
  );
  assert.match(workflow, /openssl req -x509 -newkey rsa:2048/);
  assert.match(
    workflow,
    /127\.0\.0\.1 academy\.ci\.q-academy\.de\\n'[\s\\]+\| sudo tee -a \/etc\/hosts/,
  );
  assert.match(
    workflow,
    /PRODUCTION_SMOKE_UPSTREAM_ORIGIN=http:\/\/127\.0\.0\.1:3000/,
  );
  assert.match(workflow, /PRODUCTION_SMOKE_LISTEN_HOST=127\.0\.0\.1/);
  assert.match(workflow, /PLAYWRIGHT_API_KEY: \$\{\{ env\.DEMO_API_KEY \}\}/);
  assert.doesNotMatch(
    workflow,
    /PLAYWRIGHT_SEED_PASSWORD:\s*Demo123!/,
  );

  assert.match(proxy, /createServer\(/);
  assert.match(proxy, /createUpstreamRequest/);
  assert.match(proxy, /"x-forwarded-host": publicOrigin\.host/);
  assert.match(proxy, /"x-forwarded-proto": "https"/);
  assert.match(proxy, /request\.pipe\(upstreamRequest\)/);
});

test("CI rotates and always restores only disposable production-smoke credentials", () => {
  const workflow = source(".github/workflows/ci.yml");
  const credentials = source(
    "scripts/ci/production-smoke-credentials.ts",
  );
  const installStart = workflow.indexOf(
    "- name: Install production smoke browser",
  );
  const prepareStart = workflow.indexOf(
    "- name: Prepare ephemeral production-smoke credentials",
  );
  const smokeStart = workflow.indexOf(
    "- name: Smoke-test exact production app image",
  );
  const restoreStart = workflow.indexOf(
    "- name: Restore disposable demo credentials",
  );
  const mediaStart = workflow.indexOf(
    "- name: Smoke-test production media worker",
  );

  assert.ok(
    installStart >= 0 &&
      prepareStart > installStart &&
      smokeStart > prepareStart &&
      restoreStart > smokeStart &&
      mediaStart > restoreStart,
  );
  assert.match(
    workflow.slice(prepareStart, smokeStart),
    /production-smoke-credentials\.ts prepare/,
  );
  const restoreStep = workflow.slice(restoreStart, mediaStart);
  assert.match(restoreStep, /if: always\(\)/);
  assert.match(restoreStep, /production-smoke-credentials\.ts restore/);

  assert.match(credentials, /CI !== "true" \|\| environment\.GITHUB_ACTIONS !== "true"/);
  assert.match(credentials, /assertDestructiveSeedAllowed\(environment\)/);
  assert.match(credentials, /assertSeedDatabaseIdentity\(\{/);
  assert.match(credentials, /host\(inet_server_addr\(\)\) as "serverAddress"/);
  assert.doesNotMatch(credentials, /inet_server_addr\(\)::text/);
  assert.match(credentials, /const BCRYPT_ROUNDS = 12/);
  assert.match(credentials, /hash\(password, BCRYPT_ROUNDS\)/);
  assert.match(credentials, /status !== "active"/);
  assert.match(credentials, /organizationSlug !== EXPECTED_ORGANIZATION/);
  assert.match(credentials, /for update of users/);
  assert.match(credentials, /PLAYWRIGHT_SEED_PASSWORD=\$\{password\}\\n/);
  assert.ok(
    credentials.indexOf("::add-mask::${password}") <
      credentials.indexOf("hash(password, BCRYPT_ROUNDS)"),
  );
});

test("later browser suites reuse Chromium and install only remaining engines", () => {
  const workflow = source(".github/workflows/ci.yml");
  const installStart = workflow.indexOf("- name: Install browser engines");
  const suiteStart = workflow.indexOf("- name: Run Playwright suite");

  assert.ok(installStart >= 0 && suiteStart > installStart);
  const installStep = workflow.slice(installStart, suiteStart);
  assert.match(installStep, /playwright install --with-deps firefox webkit/);
  assert.doesNotMatch(installStep, /chromium/);
});

test("the complete browser gate is reseeded, batched and has a bounded heap", () => {
  const workflow = source(".github/workflows/ci.yml");
  const verifyStart = workflow.indexOf("  verify:");
  const nextJobStart = workflow.indexOf("  backup-restore-drill:");
  const chromiumStart = workflow.indexOf("- name: Run Playwright suite");
  const crossBrowserStart = workflow.indexOf(
    "- name: Run Firefox and WebKit core flows",
  );
  const revokeStart = workflow.indexOf(
    "- name: Revoke disposable CI cleanup parameter",
  );

  assert.ok(
    verifyStart >= 0 &&
      nextJobStart > verifyStart &&
      chromiumStart > verifyStart &&
      crossBrowserStart > chromiumStart &&
      revokeStart > crossBrowserStart,
  );
  assert.match(
    workflow.slice(verifyStart, nextJobStart),
    /^    timeout-minutes: 180$/m,
  );
  const chromiumStep = workflow.slice(chromiumStart, crossBrowserStart);
  const crossBrowserStep = workflow.slice(crossBrowserStart, revokeStart);
  const chromiumRunStart = chromiumStep.indexOf("        run: |");
  const crossBrowserRunStart = crossBrowserStep.indexOf("        run: |");
  assert.ok(chromiumRunStart >= 0 && crossBrowserRunStart >= 0);
  assert.match(
    chromiumStep,
    /NODE_OPTIONS: --max-old-space-size=6144/,
  );
  assert.match(
    chromiumStep,
    /for project in chromium mobile; do[\s\S]*for shard in 1 2 3 4 5 6; do[\s\S]*PLAYWRIGHT_RESET_EXPECTED_DATABASE=q_academy[\s\S]*PLAYWRIGHT_RESET_EXPECTED_OWNER=q_academy_ci[\s\S]*reset-playwright-database\.ts[\s\S]*rm -rf -- \.data\/media[\s\S]*npm run db:migrate[\s\S]*NODE_ENV=test[\s\S]*ALLOW_DESTRUCTIVE_SEED=true[\s\S]*SEED_EXPECTED_DATABASE=q_academy[\s\S]*npm run db:seed[\s\S]*npm run test:e2e -- --project="\$project" --shard="\$shard\/6"/,
  );
  assert.doesNotMatch(
    chromiumStep.slice(0, chromiumRunStart),
    /NODE_ENV|ALLOW_DESTRUCTIVE_SEED|SEED_EXPECTED_DATABASE/,
  );
  assert.match(
    crossBrowserStep,
    /NODE_OPTIONS: --max-old-space-size=6144[\s\S]*PLAYWRIGHT_RESET_EXPECTED_DATABASE=q_academy[\s\S]*PLAYWRIGHT_RESET_EXPECTED_OWNER=q_academy_ci[\s\S]*reset-playwright-database\.ts[\s\S]*rm -rf -- \.data\/media[\s\S]*npm run db:migrate[\s\S]*NODE_ENV=test[\s\S]*ALLOW_DESTRUCTIVE_SEED=true[\s\S]*SEED_EXPECTED_DATABASE=q_academy[\s\S]*npm run db:seed[\s\S]*npm run test:e2e:cross-browser/,
  );
  assert.doesNotMatch(
    crossBrowserStep.slice(0, crossBrowserRunStart),
    /NODE_ENV|ALLOW_DESTRUCTIVE_SEED|SEED_EXPECTED_DATABASE/,
  );
});

test("production builds retain type checks with a bounded four-GiB heap", () => {
  const workflow = source(".github/workflows/ci.yml");
  const dockerfile = source("Dockerfile");
  const nextConfig = source("next.config.ts");

  const typecheckStart = workflow.indexOf("- name: Typecheck");
  const lintStart = workflow.indexOf("- name: Lint");
  assert.ok(typecheckStart >= 0 && lintStart > typecheckStart);
  assert.match(
    workflow.slice(typecheckStart, lintStart),
    /NODE_OPTIONS: --max-old-space-size=4096[\s\S]*npm run typecheck/,
  );

  const buildStart = workflow.indexOf("- name: Build production application");
  const composeStart = workflow.indexOf(
    "- name: Validate production Compose configuration",
  );
  assert.ok(buildStart >= 0 && composeStart > buildStart);
  assert.match(
    workflow.slice(buildStart, composeStart),
    /NODE_OPTIONS: --max-old-space-size=4096[\s\S]*run: npm run build/,
  );

  const builderStart = dockerfile.indexOf("FROM base AS builder");
  const productionDependenciesStart = dockerfile.indexOf(
    "FROM base AS production-dependencies",
  );
  const runnerStart = dockerfile.indexOf("FROM runtime-base AS runner");
  const mediaRunnerStart = dockerfile.indexOf("FROM runner AS media-runner");
  assert.ok(
    builderStart >= 0 &&
      productionDependenciesStart > builderStart &&
      runnerStart > productionDependenciesStart &&
      mediaRunnerStart > runnerStart,
  );
  assert.equal(dockerfile.match(/NODE_OPTIONS=/g)?.length, 1);
  assert.doesNotMatch(dockerfile.slice(0, builderStart), /NODE_OPTIONS/);
  assert.match(
    dockerfile.slice(builderStart, productionDependenciesStart),
    /ENV NODE_OPTIONS=--max-old-space-size=4096[\s\S]*npm run build/,
  );
  assert.doesNotMatch(
    dockerfile.slice(runnerStart, mediaRunnerStart),
    /NODE_OPTIONS/,
  );
  assert.doesNotMatch(nextConfig, /ignoreBuildErrors/);
});

test("production Compose validation supplies its browser upload origin fixture", () => {
  const workflow = source(".github/workflows/ci.yml");
  const composeStart = workflow.indexOf(
    "- name: Validate production Compose configuration",
  );
  const prometheusStart = workflow.indexOf(
    "- name: Validate Prometheus configuration and alert rules",
  );
  assert.ok(composeStart >= 0 && prometheusStart > composeStart);

  const composeStep = workflow.slice(composeStart, prometheusStart);
  const domain = composeStep.match(/^\s+APP_DOMAIN:\s+(\S+)\s*$/m)?.[1];
  const encodedOrigins = composeStep.match(
    /^\s+MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON:\s+'([^']+)'\s*$/m,
  )?.[1];
  assert.ok(domain);
  assert.ok(encodedOrigins);
  assert.deepEqual(JSON.parse(encodedOrigins), [`https://${domain}`]);
  assert.match(
    composeStep,
    /run: docker compose -f compose\.production\.yml config --quiet/,
  );
});

test("next start runner packages local next.config dependencies", () => {
  const dockerfile = source("Dockerfile");
  const nextConfig = source("next.config.ts");
  const runnerStart = dockerfile.indexOf("FROM runtime-base AS runner");
  const mediaRunnerStart = dockerfile.indexOf("FROM runner AS media-runner");

  assert.ok(runnerStart >= 0 && mediaRunnerStart > runnerStart);
  assert.match(
    nextConfig,
    /from "\.\/src\/lib\/content-security-policy"/,
  );

  const runner = dockerfile.slice(runnerStart, mediaRunnerStart);
  assert.match(
    runner,
    /COPY --from=builder --chown=nextjs:nodejs \/app\/next\.config\.ts \.\/next\.config\.ts/,
  );
  assert.match(
    runner,
    /COPY --from=builder --chown=nextjs:nodejs \/app\/src\/lib\/content-security-policy\.ts \.\/src\/lib\/content-security-policy\.ts/,
  );
  assert.match(
    runner,
    /CMD \["\.\/node_modules\/\.bin\/next", "start", "-H", "0\.0\.0\.0", "-p", "3000"\]/,
  );
});
