import assert from "node:assert/strict";
import test from "node:test";
import {
  openApiDocument,
  type OpenApiHttpMethod,
  type OpenApiOperation,
} from "../src/lib/api/openapi";

function operation(path: string, method: OpenApiHttpMethod) {
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} must be documented`);
  return value as OpenApiOperation;
}

function record(value: unknown) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function response(operationValue: OpenApiOperation, status: string) {
  const value = operationValue.responses[status];
  assert.ok(value, `Response ${status} must be documented`);
  return value;
}

test("OIDC OpenAPI operations use explicit owner-bound authentication scopes", () => {
  assert.deepEqual(
    operation("/organization/oidc", "get")["x-required-scopes"],
    ["authentication:read"],
  );
  assert.deepEqual(
    operation("/organization/oidc", "patch")["x-required-scopes"],
    ["authentication:write"],
  );
  assert.deepEqual(operation("/organization", "get")["x-required-scopes"], [
    "organization:read",
  ]);
  assert.deepEqual(operation("/auth/oidc/start", "post").security, [
    { CookieSession: [] },
  ]);
});

test("OIDC start documents every live redirect and JSON handoff", () => {
  const get = operation("/auth/oidc/start", "get");
  const post = operation("/auth/oidc/start", "post");
  assert.deepEqual(Object.keys(get.responses).sort(), ["302", "307"]);
  assert.deepEqual(Object.keys(post.responses).sort(), ["200", "303", "307"]);
  assert.match(post.description ?? "", /Accept: application\/json/);

  const jsonResponse = response(post, "200");
  const jsonContent = record(jsonResponse.content);
  const jsonMedia = record(jsonContent["application/json"]);
  assert.equal(
    record(jsonMedia.schema).$ref,
    "#/components/schemas/OidcAuthorizationStart",
  );

  for (const [operationValue, statuses] of [
    [get, ["302", "307"]],
    [post, ["200", "303", "307"]],
  ] as const) {
    for (const status of statuses) {
      const headers = record(response(operationValue, status).headers);
      const cacheControl = record(headers["Cache-Control"]);
      assert.equal(record(cacheControl.schema).const, "no-store");
      const referrerPolicy = record(headers["Referrer-Policy"]);
      assert.equal(record(referrerPolicy.schema).const, "no-referrer");
      assert.match(String(record(headers["Set-Cookie"]).description), /cookie/i);
    }
  }

  assert.equal(
    record(
      record(record(response(get, "302").headers).Location).schema,
    ).format,
    "uri",
  );
  assert.equal(
    record(
      record(record(response(post, "303").headers).Location).schema,
    ).format,
    "uri",
  );

  const authorizationSchema = record(
    openApiDocument.components.schemas.OidcAuthorizationStart,
  );
  assert.deepEqual(authorizationSchema.required, ["authorizationUrl"]);
  const properties = record(authorizationSchema.properties);
  const authorizationUrl = record(properties.authorizationUrl);
  assert.equal(authorizationUrl.format, "uri");
  assert.equal(authorizationUrl.pattern, "^https?://");
});
