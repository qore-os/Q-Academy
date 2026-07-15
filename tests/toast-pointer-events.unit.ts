import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalStyles = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("toast notifications do not block unrelated controls underneath", () => {
  assert.match(
    globalStyles,
    /\[data-sonner-toast\]\s*\{[^}]*pointer-events:\s*none\s*!important;/,
  );
  assert.match(
    globalStyles,
    /\[data-sonner-toast\]\s+a,\s*\[data-sonner-toast\]\s+button\s*\{[^}]*pointer-events:\s*auto;/,
  );
});
