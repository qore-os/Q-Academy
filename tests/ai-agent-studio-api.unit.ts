import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

type Method = "get" | "post" | "put";

function operation(path: string, method: Method) {
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} is not documented.`);
  return value;
}

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Agent Studio publishes versioned draft, publish, rollback and history APIs", () => {
  assert.equal(openApiDocument.info.version, "1.7.0");
  for (const [path, method, operationId, schema] of [
    ["/agents/{id}/draft", "put", "replaceAgentDraft", "AgentDraftUpdate"],
    ["/agents/{id}/publish", "post", "publishAgentDraft", "AgentPublish"],
    ["/agents/{id}/rollback", "post", "rollbackAgentVersion", "AgentRollback"],
    ["/agents/{id}/versions", "get", "listAgentVersions", null],
  ] as const) {
    const value = operation(path, method);
    assert.equal(value.operationId, operationId);
    assert.deepEqual(value["x-required-scopes"], [
      method === "get" ? "agents:read" : "agents:write",
    ]);
    if (schema) {
      assert.match(JSON.stringify(value.requestBody), new RegExp(schema));
      assert.match(JSON.stringify(value.parameters), /IdempotencyKey/);
    }
  }
});

test("Agent Studio schemas fail closed on revisions, sources and target shapes", () => {
  const schemas = openApiDocument.components.schemas;
  const draft = JSON.stringify(schemas.AgentDraftUpdate);
  assert.match(draft, /expectedDraftVersionId/);
  assert.match(draft, /expectedDraftRevision/);
  assert.match(draft, /selected_sources/);
  assert.match(draft, /course_version/);
  assert.match(draft, /manual_text/);
  assert.match(draft, /media_asset/);
  assert.match(draft, /web_url/);
  assert.match(draft, /subjectType/);
  assert.doesNotMatch(draft, /providerSecret|apiKey/);

  const publish = JSON.stringify(schemas.AgentPublish);
  assert.match(publish, /expectedDraftVersionId/);
  assert.match(publish, /expectedDraftRevision/);
  assert.equal(
    (schemas.AgentPublish as { additionalProperties?: boolean })
      .additionalProperties,
    false,
  );
});

test("Agent Studio routes delegate to the centralized audited lifecycle", () => {
  for (const [path, command] of [
    ["../src/app/api/v1/agents/[id]/draft/route.ts", "updateAiAgentDraft"],
    ["../src/app/api/v1/agents/[id]/publish/route.ts", "publishAiAgentDraft"],
    ["../src/app/api/v1/agents/[id]/rollback/route.ts", "rollbackAiAgentVersion"],
  ] as const) {
    const contents = source(path);
    assert.match(contents, /requireAiApiAdminActor/);
    assert.match(contents, new RegExp(command));
    assert.match(contents, /parseJson/);
    assert.doesNotMatch(contents, /\.insert\(aiAgentVersions\)|\.update\(aiAgentVersions\)/);
  }
});
