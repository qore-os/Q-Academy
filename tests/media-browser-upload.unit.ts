import assert from "node:assert/strict";
import test from "node:test";

import { browserUploadHeaders } from "../src/lib/media/browser-upload";

test("browser upload headers omit forbidden Content-Length", () => {
  assert.deepEqual(
    browserUploadHeaders({
      "Content-Length": "42",
      "Content-Type": "text/plain",
      "If-None-Match": "*",
    }),
    {
      "Content-Type": "text/plain",
      "If-None-Match": "*",
    },
  );
});

test("browser upload header filtering is case insensitive", () => {
  assert.deepEqual(browserUploadHeaders({ "content-length": "42" }), {});
});
