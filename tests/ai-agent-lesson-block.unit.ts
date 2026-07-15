import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicAssessmentBlockData } from "../src/lib/assessment-engine";
import {
  contentBlockCreateSchema,
  validateAssessmentContentBlock,
} from "../src/lib/api/schemas";

const agentId = "11111111-1111-4111-8111-111111111111";

test("ai_agent blocks require and preserve exactly one agent identity", () => {
  const parsed = contentBlockCreateSchema.parse({
    type: "ai_agent",
    title: "Lerncoach",
    data: { agentId },
  });
  assert.deepEqual(parsed.data, { agentId });
  assert.equal(
    contentBlockCreateSchema.safeParse({ type: "ai_agent", data: {} }).success,
    false,
  );
  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "ai_agent",
      data: { agentId, prompt: "Darf nicht im Block gespeichert werden" },
    }).success,
    false,
  );
  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "text",
      data: { text: "Hallo", agentId },
    }).success,
    false,
  );
});

test("combined update validation rejects missing or misplaced agent references", () => {
  assert.equal(
    validateAssessmentContentBlock({
      type: "ai_agent",
      data: { agentId },
    }).success,
    true,
  );
  assert.equal(
    validateAssessmentContentBlock({ type: "ai_agent", data: {} }).success,
    false,
  );
  assert.equal(
    validateAssessmentContentBlock({
      type: "heading",
      data: { text: "Titel", agentId },
    }).success,
    false,
  );
});

test("public block projection transports agentId without privileged agent configuration", () => {
  const projected = publicAssessmentBlockData({
    id: "22222222-2222-4222-8222-222222222222",
    type: "ai_agent",
    title: "Lerncoach",
    required: false,
    data: { agentId },
  });
  assert.deepEqual(projected, { agentId });
  assert.equal("systemPrompt" in projected, false);
  assert.equal("sources" in projected, false);
});

test("every REST block write path enforces the central published-agent validator", () => {
  const routes = [
    "src/app/api/v1/lessons/[id]/blocks/route.ts",
    "src/app/api/v1/pages/[id]/blocks/route.ts",
    "src/app/api/v1/blocks/[id]/route.ts",
  ];
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /assertPublishedAiAgentContentBlock\s*\(/);
  }
});

test("embedded member UI never renders system messages, source lists or prompts", () => {
  const source = readFileSync(
    "src/components/academy/embedded-ai-agent.tsx",
    "utf8",
  );
  assert.match(
    source,
    /message\.role === "user" \|\| message\.role === "assistant"/,
  );
  assert.doesNotMatch(source, /systemPrompt|knowledgeMode|\.citations|sources\.map/);
});
