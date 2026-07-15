import assert from "node:assert/strict";
import test from "node:test";

import openApiSpec from "../src/lib/api/openapi";
import { API_SCOPES, SCOPE_DETAILS } from "../src/lib/api/scopes";

test("exam lifecycle routes require dedicated assessment scopes", () => {
  assert.ok(API_SCOPES.includes("assessments:read"));
  assert.ok(API_SCOPES.includes("assessments:write"));
  assert.ok(SCOPE_DETAILS["assessments:read"]);
  assert.ok(SCOPE_DETAILS["assessments:write"]);

  assert.deepEqual(
    openApiSpec.paths["/exam-attempts/{id}"]?.get?.["x-required-scopes"],
    ["assessments:read"],
  );
  assert.deepEqual(
    openApiSpec.paths["/exam-attempts/{id}"]?.patch?.["x-required-scopes"],
    ["assessments:write"],
  );
  assert.deepEqual(
    openApiSpec.paths["/exam-attempts/{id}/release"]?.post?.[
      "x-required-scopes"
    ],
    ["assessments:write", "courses:write"],
  );
});

test("browser exam lifecycle routes use cookie-session security", () => {
  for (const [path, method] of [
    ["/me/exam-attempts", "post"],
    ["/me/exam-attempts/{id}", "get"],
    ["/me/exam-attempts/{id}", "patch"],
    ["/me/exam-attempts/{id}/submit", "post"],
    ["/me/exam-attempts/{id}/result", "get"],
    ["/me/exam-attempts/{id}/release", "post"],
    ["/me/exam-attempts/{id}/finalize", "post"],
  ] as const) {
    const operation = openApiSpec.paths[path]?.[method];
    assert.deepEqual(operation?.security, [{ CookieSession: [] }]);
    assert.equal(operation?.["x-required-scopes"], undefined);
  }
});
