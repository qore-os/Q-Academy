import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type JsonSchema = {
  $ref?: string;
  type?: string;
  additionalProperties?: boolean | JsonSchema;
  required?: readonly string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  allOf?: readonly JsonSchema[];
  not?: JsonSchema;
  const?: unknown;
};

const forbiddenPublicProperties = new Set([
  "organizationId",
  "organization_id",
  "moderationFingerprint",
  "moderation_fingerprint",
  "moderatedById",
  "moderated_by_id",
  "moderatorId",
  "moderator_id",
]);

function componentSchema(name: string) {
  const value = openApiDocument.components.schemas[name] as
    | JsonSchema
    | undefined;
  assert.ok(value, `${name} schema is not documented.`);
  return value;
}

function dereference(value: JsonSchema): JsonSchema {
  if (!value.$ref) return value;
  const prefix = "#/components/schemas/";
  assert.ok(value.$ref.startsWith(prefix), `Unsupported schema ref ${value.$ref}.`);
  return componentSchema(value.$ref.slice(prefix.length));
}

function responseDataSchema(input: {
  path: string;
  method: HttpMethod;
  status?: "200" | "201";
  list?: boolean;
}) {
  const operation = openApiDocument.paths[input.path]?.[input.method];
  assert.ok(
    operation,
    `${input.method.toUpperCase()} ${input.path} is not documented.`,
  );
  const response = operation.responses[input.status ?? "200"] as
    | {
        content?: {
          "application/json"?: { schema?: JsonSchema };
        };
      }
    | undefined;
  const envelope = response?.content?.["application/json"]?.schema;
  assert.ok(
    envelope,
    `${input.method.toUpperCase()} ${input.path} has no JSON response schema.`,
  );
  const data = dereference(envelope).properties?.data;
  assert.ok(
    data,
    `${input.method.toUpperCase()} ${input.path} has no response data schema.`,
  );
  const resolvedData = dereference(data);
  if (!input.list) return resolvedData;
  assert.equal(
    resolvedData.type,
    "array",
    `${input.method.toUpperCase()} ${input.path} must document an array response.`,
  );
  assert.ok(
    resolvedData.items,
    `${input.method.toUpperCase()} ${input.path} has no item schema.`,
  );
  return dereference(resolvedData.items);
}

function collectPropertyNames(
  value: JsonSchema,
  result = new Set<string>(),
  visitedRefs = new Set<string>(),
  visitedObjects = new WeakSet<object>(),
) {
  if (value.$ref) {
    if (visitedRefs.has(value.$ref)) return result;
    visitedRefs.add(value.$ref);
    collectPropertyNames(dereference(value), result, visitedRefs, visitedObjects);
    return result;
  }
  if (visitedObjects.has(value)) return result;
  visitedObjects.add(value);
  for (const [name, property] of Object.entries(value.properties ?? {})) {
    result.add(name);
    collectPropertyNames(property, result, visitedRefs, visitedObjects);
  }
  if (value.items) {
    collectPropertyNames(value.items, result, visitedRefs, visitedObjects);
  }
  for (const branch of [
    ...(value.oneOf ?? []),
    ...(value.anyOf ?? []),
    ...(value.allOf ?? []),
  ]) {
    collectPropertyNames(branch, result, visitedRefs, visitedObjects);
  }
  if (value.not) {
    collectPropertyNames(value.not, result, visitedRefs, visitedObjects);
  }
  return result;
}

function assertClosedPublicSchema(value: JsonSchema, label: string) {
  assert.equal(value.type, "object", `${label} must be an object schema.`);
  assert.equal(
    value.additionalProperties,
    false,
    `${label} must reject undocumented response properties.`,
  );
  assert.ok(
    Object.keys(value.properties ?? {}).length > 0,
    `${label} must use a concrete response DTO.`,
  );
  const publicProperties = collectPropertyNames(value);
  for (const forbidden of forbiddenPublicProperties) {
    assert.equal(
      publicProperties.has(forbidden),
      false,
      `${label} exposes internal property ${forbidden}.`,
    );
  }
}

function recursivelyFind(
  value: unknown,
  predicate: (candidate: Record<string, unknown>) => boolean,
  visited = new WeakSet<object>(),
): boolean {
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (!Array.isArray(value) && predicate(value as Record<string, unknown>)) {
    return true;
  }
  return Object.values(value).some((child) =>
    recursivelyFind(child, predicate, visited),
  );
}

function hasRequired(candidate: unknown, property: string) {
  return (
    Array.isArray(candidate) &&
    candidate.length === 1 &&
    candidate[0] === property
  );
}

function hasExclusiveAlternatives(
  schema: JsonSchema,
  first: string,
  second: string,
) {
  return recursivelyFind(schema, (candidate) => {
    const alternatives = candidate.oneOf;
    if (!Array.isArray(alternatives)) return false;
    const serialized = alternatives.map((alternative) =>
      JSON.stringify(alternative),
    );
    return (
      serialized.some(
        (alternative) =>
          alternative.includes(`"required":["${first}"]`) &&
          alternative.includes(`"required":["${second}"]`),
      ) &&
      serialized.some(
        (alternative) =>
          alternative.includes(`"required":["${second}"]`) &&
          alternative.includes(`"required":["${first}"]`),
      )
    );
  });
}

test("community REST operations publish concrete closed response DTOs", () => {
  const operations = [
    ["/community/areas", "get", "200", true],
    ["/community/areas", "post", "201", false],
    ["/community/areas/{id}", "get", "200", false],
    ["/community/areas/{id}", "patch", "200", false],
    ["/community/areas/{id}", "delete", "200", false],
    ["/community/areas/{id}/move", "post", "200", false],
    ["/community/spaces", "get", "200", true],
    ["/community/spaces", "post", "201", false],
    ["/community/spaces/{id}", "get", "200", false],
    ["/community/spaces/{id}", "patch", "200", false],
    ["/community/spaces/{id}", "delete", "200", false],
    ["/community/spaces/{id}/move", "post", "200", false],
    ["/community/spaces/{id}/access-policy", "get", "200", false],
    ["/community/spaces/{id}/access-policy", "put", "200", false],
    ["/community/posts", "get", "200", true],
    ["/community/posts", "post", "201", false],
    ["/community/posts/{id}", "get", "200", false],
    ["/community/posts/{id}", "patch", "200", false],
    ["/community/posts/{id}", "delete", "200", false],
    ["/community/posts/{id}/comments", "get", "200", true],
    ["/community/posts/{id}/comments", "post", "201", false],
    ["/community/comments/{id}", "get", "200", false],
    ["/community/comments/{id}", "patch", "200", false],
    ["/community/comments/{id}", "delete", "200", false],
    ["/community/posts/{id}/reactions", "get", "200", true],
    ["/community/posts/{id}/reactions", "post", "201", false],
    ["/community/posts/{id}/reactions/{userId}", "put", "200", false],
    ["/community/posts/{id}/reactions/{userId}", "delete", "200", false],
    ["/community/posts/{id}/votes", "get", "200", true],
    ["/community/posts/{id}/votes", "post", "200", false],
    ["/community/comments/{id}/reactions", "get", "200", false],
    ["/community/comments/{id}/reactions", "put", "200", false],
    ["/community/comments/{id}/reactions", "delete", "200", false],
    ["/community/follows", "get", "200", true],
    ["/community/follows/{targetType}/{targetId}", "put", "200", false],
    ["/community/follows/{targetType}/{targetId}", "delete", "200", false],
    ["/leaderboard", "get", "200", true],
  ] as const;

  for (const [path, method, status, list] of operations) {
    const label = `${method.toUpperCase()} ${path}`;
    assertClosedPublicSchema(
      responseDataSchema({ path, method, status, list }),
      label,
    );
  }
});

test("post and comment DTOs document rich-text projections without internals", () => {
  for (const [path, method, status, list] of [
    ["/community/posts", "get", "200", true],
    ["/community/posts", "post", "201", false],
    ["/community/posts/{id}", "get", "200", false],
    ["/community/posts/{id}", "patch", "200", false],
    ["/community/posts/{id}/comments", "get", "200", true],
    ["/community/posts/{id}/comments", "post", "201", false],
    ["/community/comments/{id}", "get", "200", false],
    ["/community/comments/{id}", "patch", "200", false],
  ] as const) {
    const value = responseDataSchema({ path, method, status, list });
    for (const property of [
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
    ]) {
      assert.ok(
        Object.hasOwn(value.properties ?? {}, property),
        `${method.toUpperCase()} ${path} omits ${property}.`,
      );
    }
  }
});

test("community request schemas describe exclusive content and profile selectors", () => {
  for (const name of ["PostCreate", "CommentCreate", "CommentUpdate"]) {
    assert.equal(
      hasExclusiveAlternatives(componentSchema(name), "content", "richText"),
      true,
      `${name} must document exactly one of content or richText.`,
    );
  }

  const postUpdate = componentSchema("PostUpdate");
  assert.equal(
    recursivelyFind(postUpdate, (candidate) => {
      const not = candidate.not as { required?: unknown } | undefined;
      return (
        Array.isArray(not?.required) &&
        not.required.includes("content") &&
        not.required.includes("richText")
      );
    }),
    true,
    "PostUpdate must reject requests containing both content and richText.",
  );

  const settings = componentSchema("CommunityProfileSettingsReplace");
  const fieldItems = dereference(
    dereference(settings.properties?.fields ?? {}).items ?? {},
  );
  assert.equal(
    hasExclusiveAlternatives(fieldItems, "standardField", "customFieldId"),
    true,
    "Each profile setting must select exactly one standard or custom field.",
  );
  const selectorBranches = fieldItems.oneOf ?? [];
  const standardBranch = selectorBranches.find((branch) =>
    branch.required?.includes("standardField"),
  );
  const customBranch = selectorBranches.find((branch) =>
    branch.required?.includes("customFieldId"),
  );
  assert.ok(standardBranch?.properties?.standardField);
  assert.ok(customBranch?.properties?.customFieldId);
  assert.doesNotMatch(
    JSON.stringify(standardBranch.properties.standardField),
    /"type":"null"/,
    "The selected standardField cannot be null.",
  );
  assert.doesNotMatch(
    JSON.stringify(customBranch.properties.customFieldId),
    /"type":"null"/,
    "The selected customFieldId cannot be null.",
  );
  assert.equal(hasRequired(fieldItems.required, "standardField"), false);
  assert.equal(hasRequired(fieldItems.required, "customFieldId"), false);
});

test("public profile and settings nested schemas are closed and correctly typed", () => {
  const publicProfile = componentSchema("CommunityPublicProfile");
  assertClosedPublicSchema(publicProfile, "CommunityPublicProfile");
  const customFields = dereference(
    dereference(publicProfile.properties?.customFields ?? {}).items ?? {},
  );
  assert.doesNotMatch(
    JSON.stringify(customFields),
    /"kind"[^}]+"standard"/,
    "customFields must not accept standard profile field entries.",
  );

  const settings = componentSchema("CommunityProfileSettingsAdminData");
  const fields = dereference(
    dereference(settings.properties?.fields ?? {}).items ?? {},
  );
  const catalog = dereference(
    dereference(settings.properties?.customFieldCatalog ?? {}).items ?? {},
  );
  assert.equal(fields.additionalProperties, false);
  assert.equal(catalog.additionalProperties, false);
});

test("member search documents its conditional members scope", () => {
  const search = openApiDocument.paths["/search"]?.get;
  assert.ok(search);
  assert.deepEqual(search["x-required-scopes"], ["search:read"]);
  assert.match(search.description ?? "", /members:read/);
});
