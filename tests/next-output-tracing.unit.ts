import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config";

test("runtime data is excluded from every Next.js server trace", () => {
  assert.deepEqual(nextConfig.outputFileTracingExcludes, {
    "/*": [".data/**/*"],
  });
});

test("production responses do not disclose the Next.js framework header", () => {
  assert.equal(nextConfig.poweredByHeader, false);
});
