import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

test("badge groups expose ordered display policy through REST and feed DTOs", () => {
  const create = openApiDocument.components.schemas.BadgeGroupCreate as {
    properties?: Record<string, unknown>;
  };
  assert.ok(create.properties?.displayMode);
  assert.ok(create.properties?.sortOrder);
  for (const [path, methods] of [
    ["/badge-groups", ["get", "post"]],
    ["/badge-groups/{id}", ["get", "patch", "delete"]],
  ] as const) {
    for (const method of methods) {
      assert.ok(
        openApiDocument.paths[path]?.[method],
        `${method.toUpperCase()} ${path} is missing.`,
      );
    }
  }
  const badge = openApiDocument.components.schemas.CommunityBadge as {
    additionalProperties?: boolean;
    required?: string[];
  };
  assert.equal(badge.additionalProperties, false);
  assert.deepEqual(badge.required, [
    "id",
    "name",
    "description",
    "icon",
    "color",
    "groupId",
    "groupName",
  ]);
});
