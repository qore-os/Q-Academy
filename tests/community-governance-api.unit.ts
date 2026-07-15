import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

type HttpMethod = "get" | "post" | "put";
type Schema = {
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, unknown>;
};

const governancePaths = [
  "/admin/community/moderation-cases",
  "/admin/community/moderation-cases/{id}/claim",
  "/admin/community/moderation-cases/{id}/decision",
  "/admin/community/moderation-appeals/{id}/resolution",
  "/admin/community/spaces/{id}/moderation-policy",
  "/admin/community/level-configuration",
] as const;

function operation(path: string, method: HttpMethod) {
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} is not documented.`);
  return value;
}

function schema(name: string) {
  const value = openApiDocument.components.schemas[name] as Schema | undefined;
  assert.ok(value, `${name} schema is not documented.`);
  return value;
}

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("community governance OpenAPI publishes six paths and eight scoped operations", () => {
  const paths = governancePaths.map((path) => openApiDocument.paths[path]);
  assert.equal(paths.length, 6);
  assert.equal(
    paths.reduce(
      (count, path) =>
        count +
        Object.keys(path).filter((method) =>
          ["get", "post", "put", "patch", "delete"].includes(method),
        ).length,
      0,
    ),
    8,
  );

  for (const [path, method, scope, requestName, responseName] of [
    [
      "/admin/community/moderation-cases",
      "get",
      "community:read",
      null,
      "CommunityModerationQueueItem",
    ],
    [
      "/admin/community/moderation-cases/{id}/claim",
      "post",
      "community:write",
      "CommunityModerationCaseClaim",
      "CommunityModerationCaseClaimResult",
    ],
    [
      "/admin/community/moderation-cases/{id}/decision",
      "post",
      "community:write",
      "CommunityModerationCaseDecision",
      "CommunityModerationCaseDecisionResult",
    ],
    [
      "/admin/community/moderation-appeals/{id}/resolution",
      "post",
      "community:write",
      "CommunityModerationAppealDecision",
      "CommunityModerationAppealResolutionResult",
    ],
    [
      "/admin/community/spaces/{id}/moderation-policy",
      "get",
      "community:read",
      null,
      "CommunityModerationPolicy",
    ],
    [
      "/admin/community/spaces/{id}/moderation-policy",
      "put",
      "community:write",
      "CommunityModerationPolicyUpdate",
      "CommunityModerationPolicy",
    ],
    [
      "/admin/community/level-configuration",
      "get",
      "community:read",
      null,
      "CommunityLevelConfiguration",
    ],
    [
      "/admin/community/level-configuration",
      "put",
      "community:write",
      "CommunityLevelConfigurationUpdate",
      "CommunityLevelConfiguration",
    ],
  ] as const) {
    const value = operation(path, method);
    assert.deepEqual(value["x-required-scopes"], [scope]);
    assert.match(JSON.stringify(value.responses["200"]), new RegExp(responseName));
    if (requestName) {
      assert.match(JSON.stringify(value.requestBody), new RegExp(requestName));
      assert.match(JSON.stringify(value.parameters), /IdempotencyKey/);
    }
  }

  const queue = operation("/admin/community/moderation-cases", "get");
  assert.match(JSON.stringify(queue.parameters), /PaginationMeta|cursor|Cursor/);
  assert.match(JSON.stringify(queue.parameters), /targetType/);
  assert.match(JSON.stringify(queue.parameters), /status/);
});

test("moderation command schemas require decision and content versions", () => {
  for (const name of [
    "CommunityModerationCaseClaim",
    "CommunityModerationCaseDecision",
    "CommunityModerationAppealDecision",
  ]) {
    const contract = schema(name);
    assert.equal(contract.additionalProperties, false);
    assert.ok(contract.required?.includes("expectedDecisionVersion"));
    assert.ok(contract.required?.includes("expectedContentVersion"));
  }

  const decision = schema("CommunityModerationCaseDecision");
  assert.deepEqual(
    (decision.properties?.action as { enum: readonly string[] }).enum,
    ["approve", "reject", "restore"],
  );
  const appeal = schema("CommunityModerationAppealDecision");
  assert.deepEqual(
    (appeal.properties?.action as { enum: readonly string[] }).enum,
    ["uphold", "overturn"],
  );
});

test("governance response DTOs exclude reporter identities and internal signals", () => {
  for (const name of [
    "CommunityModerationQueueAppeal",
    "CommunityModerationQueueItem",
    "CommunityModerationCaseClaimResult",
    "CommunityModerationCaseDecisionResult",
    "CommunityModerationAppealResolutionResult",
    "CommunityModerationPolicy",
    "CommunityLevel",
    "CommunityLevelConfiguration",
  ]) {
    assert.equal(schema(name).additionalProperties, false, name);
  }

  const queue = schema("CommunityModerationQueueItem");
  assert.ok(Object.hasOwn(queue.properties ?? {}, "reportCount"));
  const serialized = JSON.stringify({ properties: queue.properties });
  assert.doesNotMatch(serialized, /reporter(Id|Name)/i);
  assert.doesNotMatch(serialized, /signals|fingerprint|assessment|detectedDomains/i);
});

test("route handlers enforce admin actors and transactional commands", () => {
  const readRoutes = [
    "../src/app/api/v1/admin/community/moderation-cases/route.ts",
    "../src/app/api/v1/admin/community/spaces/[id]/moderation-policy/route.ts",
    "../src/app/api/v1/admin/community/level-configuration/route.ts",
  ];
  for (const route of readRoutes) {
    const contents = source(route);
    assert.match(contents, /communityAdminApiActorForContext/);
    assert.match(contents, /handleApi/);
  }

  for (const route of [
    "../src/app/api/v1/admin/community/moderation-cases/[id]/claim/route.ts",
    "../src/app/api/v1/admin/community/moderation-cases/[id]/decision/route.ts",
    "../src/app/api/v1/admin/community/moderation-appeals/[id]/resolution/route.ts",
    "../src/app/api/v1/admin/community/spaces/[id]/moderation-policy/route.ts",
    "../src/app/api/v1/admin/community/level-configuration/route.ts",
  ]) {
    const contents = source(route);
    assert.match(contents, /communityAdminApiActorForContext/);
    assert.match(contents, /handleTransactionalApiCommand/);
    assert.match(contents, /parseJson/);
    assert.doesNotMatch(contents, /communityReports|communityModerationAssessments/);
  }

  const adminGuard = source("../src/lib/community-admin.ts");
  assert.match(adminGuard, /eq\(users\.organizationId, input\.organizationId\)/);
  assert.match(adminGuard, /eq\(users\.status, "active"\)/);
  assert.match(adminGuard, /inArray\(users\.role, \["owner", "admin"\]\)/);

  const orchestration = source("../src/lib/community-moderation-admin.ts");
  assert.match(orchestration, /decideCommunityModerationCase\(tx/);
  assert.match(orchestration, /resolveCommunityModerationAppeal\(tx/);
  assert.match(orchestration, /expectedDecisionVersion/);
  assert.match(orchestration, /expectedContentVersion/);

  const queue = source("../src/lib/community-moderation-queue.ts");
  assert.match(queue, /createHmac/);
  assert.match(queue, /timingSafeEqual/);
  assert.match(queue, /organizationId: input\.organizationId/);
  assert.match(queue, /gt\(communityModerationCases\.id, cursor\.id\)/);
  assert.doesNotMatch(queue, /\.offset\(/);
});
