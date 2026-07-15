import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";
import {
  AUTOMATION_CONNECTOR_CONTRACT_VERSION,
  AUTOMATION_CONNECTOR_REQUIRED_SCOPES,
  automationConnectorStatus,
} from "../src/lib/automation-connector";

type OpenApiSchema = {
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, unknown>;
};

function responseSchemaRef(response: Record<string, unknown> | undefined) {
  assert.ok(response);
  const content = response.content as Record<string, unknown>;
  const mediaType = content["application/json"] as Record<string, unknown>;
  const envelope = mediaType.schema as {
    properties: { data: { $ref?: string } };
  };
  return envelope.properties.data.$ref;
}

test("connector status DTO is stable and contains no credential material", () => {
  const status = automationConnectorStatus({
    organizationId: "11111111-1111-4111-8111-111111111111",
    apiKeyName: "Zapier Produktion",
  });

  assert.deepEqual(status, {
    connected: true,
    contractVersion: AUTOMATION_CONNECTOR_CONTRACT_VERSION,
    apiVersion: "v1",
    organizationId: "11111111-1111-4111-8111-111111111111",
    apiKeyName: "Zapier Produktion",
    requiredScopes: [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES],
    capabilities: { memberUpsert: true, bundleSelection: true },
  });
  assert.doesNotMatch(JSON.stringify(status), /secret|token|authorization/i);
});

test("connector status route is GET-only business logic with both scopes", () => {
  const source = readFileSync(
    new URL(
      "../src/app/api/v1/automation/connector-status/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /scopes: \[\.\.\.AUTOMATION_CONNECTOR_REQUIRED_SCOPES\]/);
  assert.match(source, /automationConnectorStatus/);
  assert.doesNotMatch(
    source,
    /export async function (?:POST|PUT|PATCH|DELETE)|parseJson|db\.|\.insert\(|\.update\(|\.delete\(|transaction\(/,
  );
});

test("OpenAPI publishes the connector test and both member-upsert outcomes", () => {
  const status = openApiDocument.paths["/automation/connector-status"]?.get;
  assert.ok(status);
  assert.equal(status.operationId, "getAutomationConnectorStatus");
  assert.deepEqual(
    status["x-required-scopes"],
    AUTOMATION_CONNECTOR_REQUIRED_SCOPES,
  );
  assert.equal(
    responseSchemaRef(status.responses["200"]),
    "#/components/schemas/AutomationConnectorStatus",
  );

  const upsert = openApiDocument.paths["/automation/members/upsert"]?.post;
  assert.ok(upsert);
  assert.deepEqual(Object.keys(upsert.responses).filter((code) => code < "300"), [
    "200",
    "201",
  ]);
  for (const code of ["200", "201"] as const) {
    assert.equal(
      responseSchemaRef(upsert.responses[code]),
      "#/components/schemas/AutomationMemberUpsertResult",
    );
  }
});

test("OpenAPI response schemas are closed and match the route DTO fields", () => {
  const status = openApiDocument.components.schemas
    .AutomationConnectorStatus as OpenApiSchema;
  const upsert = openApiDocument.components.schemas
    .AutomationMemberUpsertResult as OpenApiSchema;

  assert.equal(status.additionalProperties, false);
  assert.deepEqual(status.required, [
    "connected",
    "contractVersion",
    "apiVersion",
    "organizationId",
    "apiKeyName",
    "requiredScopes",
    "capabilities",
  ]);
  assert.equal(upsert.additionalProperties, false);
  assert.deepEqual(upsert.required, [
    "id",
    "email",
    "status",
    "created",
    "bundleId",
    "bundleAction",
    "bundleAccessChanged",
  ]);
  assert.deepEqual(Object.keys(upsert.properties ?? {}), upsert.required);
});
