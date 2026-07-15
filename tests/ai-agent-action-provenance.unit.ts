import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { canRemoveAiMembership } from "../src/lib/ai/agent-action-provenance";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  agent: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  group: "44444444-4444-4444-8444-444444444444",
};

const provenance = {
  organizationId: ids.organization,
  agentId: ids.agent,
  memberId: ids.member,
  targetType: "group" as const,
  targetGroupId: ids.group,
  targetBundleId: null,
  revokedAt: null,
};

function decision(overrides: Partial<Parameters<typeof canRemoveAiMembership>[0]> = {}) {
  return canRemoveAiMembership({
    organizationId: ids.organization,
    agentId: ids.agent,
    memberId: ids.member,
    target: { type: "group", id: ids.group },
    assignmentExists: true,
    provenance,
    ...overrides,
  });
}

test("AI membership removal accepts only the exact active provenance", () => {
  assert.equal(decision(), true);
});

test("manual, foreign-agent and revoked assignments cannot be removed", () => {
  assert.equal(decision({ provenance: null }), false);
  assert.equal(decision({ assignmentExists: false }), false);
  assert.equal(
    decision({ provenance: { ...provenance, agentId: randomUUID() } }),
    false,
  );
  assert.equal(
    decision({ provenance: { ...provenance, revokedAt: new Date() } }),
    false,
  );
});

test("tenant, member and typed target mismatches fail closed", () => {
  assert.equal(decision({ organizationId: randomUUID() }), false);
  assert.equal(decision({ memberId: randomUUID() }), false);
  assert.equal(
    decision({ target: { type: "group", id: randomUUID() } }),
    false,
  );
  assert.equal(
    decision({
      target: { type: "bundle", id: randomUUID() },
    }),
    false,
  );
});
