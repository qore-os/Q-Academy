import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function assertOrdered(input: string, labels: readonly string[]) {
  let previous = -1;
  for (const label of labels) {
    const current = input.indexOf(label, previous + 1);
    assert.notEqual(current, -1, `${label} is missing`);
    assert.ok(current > previous, `${label} is out of order`);
    previous = current;
  }
}

test("API-key creator resolution revalidates the credential and same-tenant actor", () => {
  const actor = source("src/lib/api/api-key-actor.ts");

  for (const predicate of [
    "eq(users.id, apiKeys.createdById)",
    "eq(users.organizationId, apiKeys.organizationId)",
    'eq(users.status, "active")',
    "eq(apiKeys.id, input.apiKeyId)",
    "eq(apiKeys.organizationId, input.organizationId)",
    'eq(apiKeys.status, "active")',
    "isNull(apiKeys.expiresAt)",
    "gt(apiKeys.expiresAt, new Date())",
  ]) {
    assert.ok(actor.includes(predicate), predicate);
  }
  assert.match(actor, /\.for\("share"\)/);
  assert.doesNotMatch(actor, /courseCollaborators|requireCoursePermission|users\.role/);
});

test("course creation stores and forwards the current API-key creator", () => {
  const route = source("src/app/api/v1/courses/route.ts");

  assertOrdered(route, [
    "db.transaction",
    "requireActiveApiKeyCreator(transaction",
    ".insert(courses)",
    "createdById: actor.id",
    "publishCourseVersion(transaction",
    "createdById: actor.id",
  ]);
});

test("every REST publication path forwards explicit creator attribution", () => {
  for (const path of [
    "src/app/api/v1/courses/[id]/route.ts",
    "src/app/api/v1/courses/[id]/publish/route.ts",
  ]) {
    const route = source(path);
    assertOrdered(route, [
      "requireActiveApiKeyCreator(transaction",
      "lockCourseForVersion(",
      "publishCourseVersion(transaction",
      "createdById: actor.id",
    ]);
    assert.doesNotMatch(
      route,
      /courseCollaborators|requireCoursePermissionInTransaction/,
      path,
    );
  }
});
