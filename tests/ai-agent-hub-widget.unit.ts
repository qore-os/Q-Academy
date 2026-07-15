import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hubCreateSchema } from "../src/lib/api/schemas";
import {
  hubLayoutAiAgentIds,
  publicHubLayout,
} from "../src/lib/hub-layout";

const agentId = "11111111-1111-4111-8111-111111111111";

function hubWith(widget: Record<string, unknown>) {
  return {
    title: "Agent Hub",
    layout: [{ id: "row-1", columns: [widget] }],
  };
}

test("hub schema stores only an agent identity and harmless presentation fields", () => {
  const parsed = hubCreateSchema.parse(
    hubWith({
      type: "ai_agent",
      title: "Lerncoach",
      description: "Direkt im Hub",
      color: "#2bb7a9",
      agentId,
    }),
  );
  assert.deepEqual(parsed.layout[0]?.columns[0], {
    type: "ai_agent",
    title: "Lerncoach",
    description: "Direkt im Hub",
    color: "#2bb7a9",
    agentId,
  });

  for (const invalid of [
    hubWith({ type: "ai_agent", title: "Ohne Referenz" }),
    hubWith({ type: "ai_agent", title: "Prompt", agentId, systemPrompt: "secret" }),
    hubWith({ type: "ai_agent", title: "Quellen", agentId, sources: [] }),
    hubWith({ type: "ai_agent", title: "Link", agentId, href: "/academy/ai" }),
    hubWith({ type: "text", title: "Falsch", agentId }),
  ]) {
    assert.equal(hubCreateSchema.safeParse(invalid).success, false);
  }
});

test("public hub projection removes privileged and malformed legacy configuration", () => {
  const projected = publicHubLayout([
    {
      id: "row-1",
      internalNote: "not public",
      columns: [
        {
          type: "ai_agent",
          title: "Lerncoach",
          description: "Sichere Beschreibung",
          color: "#2bb7a9",
          agentId,
          systemPrompt: "TOP SECRET",
          sources: [{ content: "INTERNAL KNOWLEDGE" }],
          accessGrants: [{ subjectRole: "owner" }],
        },
        {
          type: "ai_agent",
          title: "Kaputt",
          agentId: "not-a-uuid",
          systemPrompt: "MUST NOT LEAK",
        },
      ],
    },
  ]);
  assert.deepEqual(projected, [
    {
      id: "row-1",
      columns: [
        {
          type: "ai_agent",
          title: "Lerncoach",
          description: "Sichere Beschreibung",
          color: "#2bb7a9",
          agentId,
        },
      ],
    },
  ]);
  assert.deepEqual(hubLayoutAiAgentIds(projected), [agentId]);
  assert.doesNotMatch(JSON.stringify(projected), /TOP SECRET|INTERNAL|systemPrompt|sources|accessGrants/);
});

test("all hub mutation paths reuse the central published-agent validator", () => {
  const paths = [
    "src/lib/hub-actions.ts",
    "src/lib/hub-clone-service.ts",
    "src/app/api/v1/hubs/route.ts",
    "src/app/api/v1/hubs/[id]/route.ts",
  ];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /assertPublishedAiAgentHubLayout\s*\(/, path);
  }
  const central = readFileSync(
    "src/lib/hub-ai-agent-embedding.ts",
    "utf8",
  );
  assert.match(central, /assertPublishedAiAgentReferences\s*\(/);
});

test("builder and member view expose no privileged agent configuration", () => {
  const adminData = readFileSync("src/lib/hub-admin.ts", "utf8");
  assert.match(adminData, /id: aiAgents\.id, name: aiAgentVersions\.name/);
  assert.match(adminData, /eq\(aiAgents\.active, true\)/);
  assert.match(adminData, /eq\(aiAgentVersions\.state, "published"\)/);

  const member = readFileSync(
    "src/app/(member)/academy/hub/page.tsx",
    "utf8",
  );
  assert.match(member, /<EmbeddedAiAgent/);
  assert.match(member, /listAccessiblePublishedAiAgents/);
  assert.match(member, /getAiMemberCopy\(locale\)/);
  assert.match(member, /\{aiCopy\.embedded\.unavailable\}/);
  assert.match(member, /<EmbeddedAiAgent[\s\S]*locale=\{locale\}/);
  assert.doesNotMatch(member, /systemPrompt|knowledgeMode|accessGrants|sources\.map/);

  const dsar = readFileSync("scripts/export-user-data.ts", "utf8");
  const directHubAccess = dsar.slice(
    dsar.indexOf("const directHubAccess"),
    dsar.indexOf("const enrollments", dsar.indexOf("const directHubAccess")),
  );
  assert.match(directHubAccess, /hubId/);
  assert.doesNotMatch(
    directHubAccess,
    /layout|agentId|systemPrompt|knowledgeMode|sources/,
  );
});
