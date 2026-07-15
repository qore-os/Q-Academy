import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  createAiAgentDraftIdentity,
  publishAiAgentDraft,
  updateAiAgentDraft,
  type AiAgentActor,
} from "../src/lib/ai/agent-studio";
import { getAiAgentVersionKnowledgeContext } from "../src/lib/ai/conversations";
import type { WebKnowledgeSnapshot } from "../src/lib/ai/web-knowledge-source";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

function snapshot(
  marker: string,
  fetchedAt: Date,
): WebKnowledgeSnapshot {
  const content = `${marker}: This public handbook snapshot contains reviewed release and transfer guidance.`;
  return {
    sourceUrl: "https://example.com/handbook",
    title: `Public handbook ${marker}`,
    content,
    contentDigest: createHash("sha256").update(content, "utf8").digest("hex"),
    fetchedAt,
  };
}

function draft(input: {
  id: string;
  revision: number;
  name: string;
}) {
  return {
    expectedDraftVersionId: input.id,
    expectedDraftRevision: input.revision,
    agentType: "knowledge_assistant" as const,
    name: input.name,
    description: "Tenant-bound web snapshot integration test agent.",
    systemPrompt:
      "Answer only from the reviewed and immutable published source snapshot.",
    color: "#2bb7a9",
    icon: "sparkles",
    knowledgeMode: "selected_sources" as const,
    accessMode: "open" as const,
    sources: [
      {
        sourceType: "web_url" as const,
        url: "https://example.com/handbook",
      },
    ],
    accessGrants: [],
    actions: [],
  };
}

test(
  "web knowledge snapshots remain tenant-bound and immutable after publication",
  { timeout: 60_000 },
  async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const agentName = `Web Snapshot Agent ${suffix}`;
    const first = snapshot("SNAPSHOT_A", new Date("2026-07-12T09:00:00.000Z"));
    const second = snapshot("SNAPSHOT_B", new Date("2026-07-12T11:00:00.000Z"));
    let organizationId = "";

    try {
      const [organization] = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`Web Snapshot ${suffix}`}, ${`web-snapshot-${suffix}`})
        returning id
      `;
      organizationId = organization!.id;
      const [owner] = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${organizationId}, ${`owner-${suffix}@example.test`}, 'unused',
          'Web', 'Owner', 'owner', 'active'
        ) returning id
      `;
      const [member] = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${organizationId}, ${`member-${suffix}@example.test`}, 'unused',
          'Web', 'Member', 'member', 'active'
        ) returning id
      `;
      const actor: AiAgentActor = {
        id: owner!.id,
        organizationId,
        role: "owner",
      };
      const identity = await createAiAgentDraftIdentity({
        actor,
        name: agentName,
        description: "Initial web snapshot agent.",
        systemPrompt: "Use only approved public source snapshots for every answer.",
        color: "#2bb7a9",
        icon: "sparkles",
      });

      let fetchCount = 0;
      const updated = await updateAiAgentDraft(
        {
          actor,
          agentId: identity.agentId,
          draft: draft({ id: identity.draft.id, revision: 1, name: agentName }),
        },
        {
          fetchWebSnapshot: async () => {
            fetchCount += 1;
            return first;
          },
        },
      );
      assert.equal(fetchCount, 1);
      assert.equal(updated.draftRevision, 2);

      const [storedDraft] = await sql<
        Array<{
          organizationId: string;
          sourceUrl: string;
          title: string;
          content: string;
          contentDigest: string;
          fetchedAt: Date;
        }>
      >`
        select organization_id as "organizationId", source_url as "sourceUrl",
               title, content, content_digest as "contentDigest",
               fetched_at as "fetchedAt"
        from ai_agent_version_sources
        where agent_version_id = ${identity.draft.id}
      `;
      assert.deepEqual(storedDraft, {
        organizationId,
        sourceUrl: first.sourceUrl,
        title: first.title,
        content: first.content,
        contentDigest: first.contentDigest,
        fetchedAt: first.fetchedAt,
      });

      const publication = await publishAiAgentDraft({
        actor,
        agentId: identity.agentId,
        publication: {
          expectedDraftVersionId: identity.draft.id,
          expectedDraftRevision: 2,
        },
      });
      assert.equal(fetchCount, 1, "publication must not perform web egress");

      const publishedKnowledge = await getAiAgentVersionKnowledgeContext({
        organizationId,
        userId: member!.id,
        agentId: identity.agentId,
        agentVersionId: publication.published.id,
      });
      assert.equal(publishedKnowledge.courses.length, 1);
      assert.match(
        publishedKnowledge.courses[0]!.sources[0]!.excerpt,
        /SNAPSHOT_A/,
      );

      await updateAiAgentDraft(
        {
          actor,
          agentId: identity.agentId,
          draft: draft({
            id: publication.nextDraft.id,
            revision: 1,
            name: agentName,
          }),
        },
        { fetchWebSnapshot: async () => second },
      );

      const rows = await sql<
        Array<{
          state: string;
          content: string;
          contentDigest: string;
          fetchedAt: Date;
        }>
      >`
        select version.state::text as state, source.content,
               source.content_digest as "contentDigest",
               source.fetched_at as "fetchedAt"
        from ai_agent_version_sources source
        join ai_agent_versions version on version.id = source.agent_version_id
        where version.agent_id = ${identity.agentId}
        order by version.version
      `;
      assert.deepEqual([...rows], [
        {
          state: "published",
          content: first.content,
          contentDigest: first.contentDigest,
          fetchedAt: first.fetchedAt,
        },
        {
          state: "draft",
          content: second.content,
          contentDigest: second.contentDigest,
          fetchedAt: second.fetchedAt,
        },
      ]);

      const [publishedSource] = await sql<Array<{ id: string }>>`
        select source.id
        from ai_agent_version_sources source
        join ai_agent_versions version on version.id = source.agent_version_id
        where version.id = ${publication.published.id}
      `;
      await assert.rejects(
        sql`
          update ai_agent_version_sources
          set content = 'tampered'
          where id = ${publishedSource!.id}
        `,
        (error: unknown) => {
          assert.equal(
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : null,
            "55000",
          );
          return true;
        },
      );

      const audit = await sql<
        Array<{
          type: string;
          webSourceCount: string | null;
          digestCount: number;
        }>
      >`
        select type,
               metadata->>'webSourceCount' as "webSourceCount",
               jsonb_array_length(metadata->'webSnapshotDigests') as "digestCount"
        from activity_events
        where organization_id = ${organizationId}
          and type in ('agent.draft.updated', 'agent.version.published')
        order by created_at
      `;
      assert.deepEqual(
        [...audit].map((event) => ({
          type: event.type,
          webSourceCount: event.webSourceCount,
          digestCount: event.digestCount,
        })),
        [
          { type: "agent.draft.updated", webSourceCount: "1", digestCount: 1 },
          { type: "agent.version.published", webSourceCount: "1", digestCount: 1 },
          { type: "agent.draft.updated", webSourceCount: "1", digestCount: 1 },
        ],
      );
    } finally {
      if (organizationId) {
        await sql`delete from organizations where id = ${organizationId}`;
      }
    }
  },
);
