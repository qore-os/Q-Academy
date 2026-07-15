import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/lib/operational-aggregate-metrics.ts",
  "utf8",
);

test("operational aggregates use bounded windows and fixed low-cardinality values", () => {
  assert.match(source, /5 \* 60_000/);
  assert.match(source, /response_status >= 500/);
  assert.match(source, /percentile_cont\(0\.95\)/);
  assert.match(source, /from pg_stat_activity/);
  assert.match(source, /action = 'login'/);
  assert.match(source, /role = 'assistant'/);
  assert.doesNotMatch(source, /group by|organization_id|user_id|email|content/);
});
