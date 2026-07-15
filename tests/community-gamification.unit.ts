import assert from "node:assert/strict";
import test from "node:test";

import { badgeAssignSchema } from "../src/lib/api/schemas";

test("manual badge sources cannot forge the reserved automatic points format", () => {
  assert.equal(badgeAssignSchema.safeParse({ source: "manual" }).success, true);
  assert.equal(
    badgeAssignSchema.safeParse({ source: "points:manual" }).success,
    true,
  );
  assert.equal(badgeAssignSchema.safeParse({ source: "points:10" }).success, false);
  assert.equal(badgeAssignSchema.safeParse({ source: "points:00010" }).success, false);
});
