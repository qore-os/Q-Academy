import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("media byte ranges are documented and CORS-readable", () => {
  const openapi = source("src/lib/api/openapi.ts");
  const rawApi = source("src/lib/media/raw-api.ts");
  const apiHandler = source("src/lib/api/handler.ts");

  assert.match(openapi, /name: "Range"/);
  assert.match(openapi, /"206": \{/);
  assert.match(openapi, /"416": \{/);
  assert.match(openapi, /"Accept-Ranges"/);
  assert.match(openapi, /"Content-Range"/);
  assert.match(rawApi, /Accept-Ranges, Content-Range, Content-Disposition/);
  assert.match(apiHandler, /Idempotency-Key, Range, X-Request-Id/);
});

test("session media streaming limits per asset and audits only the initial range", () => {
  const service = source("src/lib/media/session-service.ts");
  const route = source("src/app/api/media-assets/[id]/download/route.ts");
  const reviewPresentation = source(
    "src/components/academy/submission-review-annotations.tsx",
  );

  assert.match(service, /identifier: `\$\{user\.id\}:\$\{id\}`/);
  assert.match(service, /if \(options\.audit !== false\)/);
  assert.match(route, /\^bytes=0-/);
  assert.match(reviewPresentation, /preload="none"/);
});
