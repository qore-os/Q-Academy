import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/components/layout/global-navigation-search.tsx",
  "utf8",
);

test("global navigation search keeps typed five-locale copy", () => {
  assert.match(source, /const SEARCH_COPY: Record<AppLocale,/);
  for (const locale of ["de", "en", "it", "es", "fr"]) {
    assert.match(source, new RegExp(`\\n  ${locale}: \\{`), locale);
  }
});

test("global navigation search never renders raw fetch errors", () => {
  assert.match(source, /setError\(copy\.unavailable\)/);
  assert.doesNotMatch(source, /reason\.message|body\.error/);
  assert.doesNotMatch(source, /reason instanceof Error/);
});
