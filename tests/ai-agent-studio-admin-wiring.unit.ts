import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("agent studio page combines versioned administration data with usage statistics", () => {
  const page = source("src/app/(admin)/admin/ai/page.tsx");

  assert.match(page, /requireOrganizationAdmin\(\)/);
  assert.doesNotMatch(page, /requireAdmin\(\)/);
  assert.match(page, /getAiAgentStudioAdminData\(actor\)/);
  assert.match(page, /getOrganizationExperienceData\(user\.organizationId\)/);
  assert.match(page, /options=\{studio\.options\}/);
});

test("agent studio actions normalize structured sources and grants into the central domain", () => {
  const actions = source("src/lib/admin/ai-agent-studio-actions.ts");

  for (const domainMutation of [
    "updateAiAgentDraft",
    "publishAiAgentDraft",
    "rollbackAiAgentVersion",
  ]) {
    assert.match(actions, new RegExp(`${domainMutation}\\(`));
  }
  for (const field of [
    "courseIds",
    "manualTitles",
    "manualContents",
    "mediaAssetIds",
    "webUrls",
    "grantRoles",
    "grantUserIds",
    "grantGroupIds",
    "grantBundleIds",
    "profileFieldIds",
    "additionalPromptLabels",
    "additionalPromptContents",
  ]) {
    assert.match(actions, new RegExp(`\"${field}\"`));
  }
  assert.match(actions, /knowledgeMode === "selected_sources"/);
  assert.match(actions, /accessMode === "restricted"/);
  assert.match(actions, /confirmed: z\.literal\(true\)/);
  assert.match(actions, /revalidatePath\("\/admin\/ai"\)/);
  assert.match(actions, /error instanceof z\.ZodError/);
  assert.match(actions, /error instanceof ApiError/);
});

test("agent studio UI exposes explicit controls without JSON payload editing", () => {
  const manager = source("src/components/admin/ai-agent-manager.tsx");

  for (const field of [
    "agentType",
    "knowledgeMode",
    "accessMode",
    "courseIds",
    "manualTitles",
    "manualContents",
    "mediaAssetIds",
    "webUrls",
    "grantRoles",
    "grantUserIds",
    "grantGroupIds",
    "grantBundleIds",
    "profileFieldIds",
    "additionalPromptLabels",
    "additionalPromptContents",
  ]) {
    assert.match(manager, new RegExp(`name=\"${field}`));
  }
  assert.doesNotMatch(manager, /JSON\.stringify|JSON\.parse|name="sourcesJson"/);
  assert.match(manager, /const canToggle = Boolean\(agent\.published\)/);
  assert.match(manager, /disabled=\{pending \|\| !canToggle\}/);
  assert.match(manager, /PublishAgentDialog/);
  assert.match(manager, /RollbackAgentDialog/);
  assert.match(manager, /disabled=\{pending \|\| !confirmed\}/);
  assert.doesNotMatch(manager, /updateAiAgentAdminAction/);
  assert.doesNotMatch(manager, /mediaTitle:|mediaContent:/);
});

test("agent studio feedback and error context never interpolate prompt or source text", () => {
  const actions = source("src/lib/admin/ai-agent-studio-actions.ts");

  assert.doesNotMatch(actions, /message:\s*`[^`]*(systemPrompt|content|source)/);
  assert.doesNotMatch(
    actions,
    /logServerError\([^;]*(systemPrompt|content|source)/,
  );
  assert.match(actions, /sourceCount|sources/);
});

test("document sources remain bound to the currently ready asset digest", () => {
  const studio = source("src/lib/ai/agent-studio.ts");
  const conversations = source("src/lib/ai/conversations.ts");

  assert.match(studio, /mediaAssets\.contentSha256/);
  assert.match(
    studio,
    /mediaDigestsById\.get\(source\.mediaAssetId\)[\s\S]*documentSnapshot\.contentDigest/,
  );
  assert.match(
    conversations,
    /source\.mediaContentDigest !== source\.contentDigest/,
  );
});
