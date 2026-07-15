import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { privacyRetentionNeedsRetry } from "../src/lib/privacy/retention-dispatch";

test("privacy retention retry status covers busy, failed, bounded, and drained runs", () => {
  assert.equal(privacyRetentionNeedsRetry({ mode: "busy" }), true);
  assert.equal(
    privacyRetentionNeedsRetry({
      mode: "delete",
      cleanupFailures: 1,
      budgetExhausted: false,
      mayHaveMore: false,
    }),
    true,
  );
  assert.equal(
    privacyRetentionNeedsRetry({
      mode: "delete",
      cleanupFailures: 0,
      budgetExhausted: true,
      mayHaveMore: true,
    }),
    true,
  );
  assert.equal(
    privacyRetentionNeedsRetry({
      mode: "delete",
      cleanupFailures: 0,
      budgetExhausted: false,
      mayHaveMore: true,
    }),
    true,
  );
  assert.equal(
    privacyRetentionNeedsRetry({
      mode: "delete",
      cleanupFailures: 0,
      budgetExhausted: false,
      mayHaveMore: false,
    }),
    false,
  );
  assert.equal(privacyRetentionNeedsRetry({ mode: "dry-run" }), false);
  assert.equal(privacyRetentionNeedsRetry({ mode: "skipped" }), false);
});

test("the scheduler exposes retryable privacy cleanup as HTTP 503", () => {
  const route = readFileSync(
    new URL("../src/app/api/internal/jobs/dispatch/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /status:\s*privacyCleanupNeedsRetry \? 503 : 200/);
  assert.match(route, /"Retry-After": "15"/);
  assert.match(
    route,
    /if \(privacyCleanupNeedsRetry\)[\s\S]*else \{[\s\S]*recordOperationalWorkerSuccess/,
  );
});
