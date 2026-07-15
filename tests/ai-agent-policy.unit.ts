import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("all persisted agent chat paths use the central budget enforcement", () => {
  const conversations = source("src/lib/ai/conversations.ts");
  const reservation = conversations.indexOf("await reserveAiAgentCredit({");
  const provider = conversations.indexOf("await completeAiMessage({");
  assert.ok(reservation > 0);
  assert.ok(provider > reservation);

  for (const path of [
    "src/app/api/ai/route.ts",
    "src/app/api/v1/agents/[id]/chats/route.ts",
    "src/app/api/v1/agents/[id]/chats/[chatId]/messages/route.ts",
  ]) {
    assert.match(source(path), /sendAiConversationMessage\s*\(/);
  }
  assert.doesNotMatch(
    source("src/app/api/ai/route.ts"),
    /reserveAiAgentCredit\s*\(/,
  );
});

test("new chats enforce the kill switch and failed first messages are compensated", () => {
  const conversations = source("src/lib/ai/conversations.ts");
  const createStart = conversations.indexOf("export async function createAiConversation");
  const insert = conversations.indexOf(".insert(aiConversations)", createStart);
  const policy = conversations.indexOf(
    "requireAiAgentPolicyEnabled(input.organizationId)",
    createStart,
  );
  assert.ok(createStart > 0 && policy > createStart && insert > policy);
  assert.match(conversations, /export async function deleteEmptyAiConversation/);

  for (const path of [
    "src/app/api/ai/route.ts",
    "src/app/api/v1/agents/[id]/chats/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /deleteEmptyAiConversation\s*\(/);
    assert.match(route, /empty_conversation\.cleanup/);
  }
});

test("REST clients can read Retry-After through CORS", () => {
  const handler = source("src/lib/api/handler.ts");
  assert.match(
    handler,
    /Access-Control-Expose-Headers[\s\S]{0,300}Retry-After/,
  );
  assert.match(handler, /headers\.set\(\s*"Retry-After"/);
});

test("admin member preview stays outside customer credit accounting", () => {
  const studio = source("src/lib/ai/agent-studio.ts");
  const previewStart = studio.indexOf(
    "export async function previewAiAgentDraftAsMember",
  );
  const previewEnd = studio.indexOf(
    "export async function publishAiAgentDraft",
    previewStart,
  );
  const preview = studio.slice(previewStart, previewEnd);
  assert.ok(previewStart > 0 && previewEnd > previewStart);
  assert.match(preview, /completeAiMessage/);
  assert.doesNotMatch(preview, /reserveAiAgentCredit|sendAiConversationMessage/);
});

test("usage aggregation never selects message content or member identifiers", () => {
  const policy = source("src/lib/ai/agent-policy.ts");
  const insightsStart = policy.indexOf(
    "export async function getAiAgentUsageInsights",
  );
  const insights = policy.slice(insightsStart);
  assert.ok(insightsStart > 0);
  assert.doesNotMatch(
    insights,
    /aiMessages\.(content|citations|metadata)|users\.(email|firstName|lastName)/,
  );
  assert.match(insights, /count\(distinct \$\{aiConversations\.userId\}\)/);
});
