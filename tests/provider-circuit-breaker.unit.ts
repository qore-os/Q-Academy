import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AI provider uses a persistent leased circuit before external egress", () => {
  const circuit = readFileSync("src/lib/provider-circuit-breaker.ts", "utf8");
  const provider = readFileSync("src/lib/ai/provider.ts", "utf8");

  assert.match(circuit, /FAILURE_THRESHOLD = 3/);
  assert.match(circuit, /pg_advisory_xact_lock/);
  assert.match(circuit, /HALF_OPEN_LEASE_MS/);
  assert.match(circuit, /authRateLimits/);
  assert.match(circuit, /recordProviderCircuitSuccess/);
  assert.match(provider, /acquireProviderCircuitPermission/);
  assert.match(provider, /if \(!circuit\.allowed\)/);
  assert.match(provider, /recordProviderCircuitFailure/);
  assert.match(provider, /recordProviderCircuitSuccess/);
  assert.match(provider, /completeWithFallback/);
});

test("AI course generation shares the persistent provider circuit and has a deep preflight", () => {
  const courseDraft = readFileSync("src/lib/ai/course-draft.ts", "utf8");
  const preflight = readFileSync(
    "scripts/ai-course-provider-preflight.ts",
    "utf8",
  );
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.match(courseDraft, /acquireProviderCircuitPermission/);
  assert.match(courseDraft, /recordProviderCircuitFailure/);
  assert.match(courseDraft, /recordProviderCircuitSuccess/);
  assert.match(courseDraft, /providerKey: "ai-compatible"/);
  assert.match(preflight, /result\.provider !== "openai-compatible"/);
  assert.match(preflight, /ai_course_provider_preflight_failed/);
  assert.equal(
    packageJson.scripts["ai:course-provider:preflight"],
    "node --conditions=react-server --import tsx scripts/ai-course-provider-preflight.ts",
  );
});
