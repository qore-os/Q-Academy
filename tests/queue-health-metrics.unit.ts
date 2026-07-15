import assert from "node:assert/strict";
import test from "node:test";

import { buildQueueHealthMetrics } from "../src/lib/queue-health-metrics";

const nowMilliseconds = Date.parse("2026-07-12T12:00:00.000Z");

test("queue health metrics expose only bounded aggregates", () => {
  assert.deepEqual(
    buildQueueHealthMetrics({
      depth: 12.9,
      failed: 3,
      oldestAt: "2026-07-12T11:58:29.000Z",
      nowMilliseconds,
    }),
    { depth: 12, failed: 3, oldestAgeSeconds: 91 },
  );
});

test("queue health metrics normalize invalid and future values", () => {
  assert.deepEqual(
    buildQueueHealthMetrics({
      depth: Number.NaN,
      failed: -4,
      oldestAt: "not-a-timestamp",
      nowMilliseconds,
    }),
    { depth: 0, failed: 0, oldestAgeSeconds: 0 },
  );
  assert.deepEqual(
    buildQueueHealthMetrics({
      depth: 1,
      failed: 0,
      oldestAt: new Date("2026-07-12T12:01:00.000Z"),
      nowMilliseconds,
    }),
    { depth: 1, failed: 0, oldestAgeSeconds: 0 },
  );
});
