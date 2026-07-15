import assert from "node:assert/strict";
import test from "node:test";

import { buildMediaScanBacklogMetrics } from "../src/lib/media/scan-backlog";

const nowMilliseconds = Date.parse("2026-07-11T12:00:00.000Z");

test("media backlog metrics accept Date and PostgreSQL string timestamps", () => {
  const fromDate = buildMediaScanBacklogMetrics({
    depth: 1,
    failed: 0,
    oldestQueuedAt: new Date("2026-07-11T11:58:59.000Z"),
    nowMilliseconds,
  });
  assert.equal(fromDate.oldestQueuedAt?.toISOString(), "2026-07-11T11:58:59.000Z");
  assert.equal(fromDate.oldestAgeSeconds, 61);
  assert.equal(fromDate.overloaded, false);

  const fromString = buildMediaScanBacklogMetrics({
    depth: 1,
    failed: 2,
    oldestQueuedAt: "2026-07-11T10:59:59.000Z",
    nowMilliseconds,
  });
  assert.equal(fromString.oldestQueuedAt?.toISOString(), "2026-07-11T10:59:59.000Z");
  assert.equal(fromString.oldestAgeSeconds, 3_601);
  assert.equal(fromString.failed, 2);
  assert.equal(fromString.overloaded, true);
});

test("media backlog metrics treat null and invalid timestamps as no age", () => {
  for (const oldestQueuedAt of [
    null,
    undefined,
    "",
    "not-a-timestamp",
    new Date(Number.NaN),
    1_720_700_000_000,
  ]) {
    const metrics = buildMediaScanBacklogMetrics({
      depth: 1,
      failed: 0,
      oldestQueuedAt,
      nowMilliseconds,
    });
    assert.equal(metrics.oldestQueuedAt, null);
    assert.equal(metrics.oldestAgeSeconds, 0);
    assert.equal(Number.isNaN(metrics.oldestAgeSeconds), false);
    assert.equal(metrics.overloaded, false);
  }
});

test("media backlog metrics preserve depth and future timestamp semantics", () => {
  const overloadedByDepth = buildMediaScanBacklogMetrics({
    depth: 80,
    failed: 0,
    oldestQueuedAt: "2026-07-11T12:01:00.000Z",
    nowMilliseconds,
  });
  assert.equal(overloadedByDepth.depth, 80);
  assert.equal(overloadedByDepth.oldestAgeSeconds, 0);
  assert.equal(overloadedByDepth.overloaded, true);

  const invalidDepth = buildMediaScanBacklogMetrics({
    depth: Number.NaN,
    failed: Number.NaN,
    oldestQueuedAt: null,
    nowMilliseconds,
  });
  assert.equal(invalidDepth.depth, 0);
  assert.equal(invalidDepth.failed, 0);
  assert.equal(invalidDepth.oldestAgeSeconds, 0);
});
