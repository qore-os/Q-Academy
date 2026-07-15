import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(
  new URL("../src/db/schema.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/lib/ai/agent-actions.ts", import.meta.url),
  "utf8",
);
const access = readFileSync(
  new URL("../src/lib/access.ts", import.meta.url),
  "utf8",
);
const openapi = readFileSync(
  new URL("../src/lib/api/openapi.ts", import.meta.url),
  "utf8",
);

test("membership actions use typed targets and tenant-bound provenance", () => {
  for (const actionType of [
    "group_membership_add",
    "group_membership_remove",
    "bundle_assignment_add",
    "bundle_assignment_remove",
  ]) {
    assert.match(schema, new RegExp(`"${actionType}"`));
  }
  assert.match(schema, /aiAgentActionTargetTypeEnum[\s\S]*"course", "group", "bundle"/);
  assert.match(schema, /export const aiAgentMembershipProvenance = pgTable/);
  assert.match(schema, /ai_agent_membership_provenance_member_tenant_fk/);
  assert.match(schema, /ai_agent_membership_provenance_grant_request_tenant_fk/);
  assert.match(schema, /ai_agent_membership_provenance_active_group_idx/);
  assert.match(schema, /ai_agent_membership_provenance_active_bundle_idx/);
  assert.match(schema, /ai_agent_action_requests_target_shape_check/);
  assert.match(schema, /ai_agent_version_actions_target_shape_check/);
});

test("removal is provenance-gated and manual writes end AI ownership", () => {
  assert.match(service, /canRemoveAiMembership/);
  assert.match(service, /pg_advisory_xact_lock[\s\S]*ai-membership:/);
  assert.match(service, /revocationReason: "ai_action"/);
  assert.match(access, /reason: "manual_takeover"/);
  assert.match(access, /reason: "manual_removal"/);
  assert.match(access, /closeAiMembershipProvenance/);
});

test("REST, webhook and OpenAPI projections expose typed targets", () => {
  assert.match(service, /presentAiAgentActionRequest[\s\S]*targetType: target\.type/);
  assert.match(service, /presentAiAgentActionWebhook[\s\S]*targetGroupId/);
  assert.match(openapi, /typed course, group, or bundle targets/);
  assert.match(openapi, /provenance update/);
});
