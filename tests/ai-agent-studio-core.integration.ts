import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  createAiAgentDraftIdentity,
  listAccessiblePublishedAiAgents,
  publishAiAgentDraft,
  requireAccessiblePublishedAiAgent,
  rollbackAiAgentVersion,
  updateAiAgentDraft,
  type AiAgentActor,
} from "../src/lib/ai/agent-studio";
import {
  createAiConversation,
  sendAiConversationMessage,
} from "../src/lib/ai/conversations";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 4, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

function apiError(status: number, code: string) {
  return (error: unknown) => {
    assert.equal(
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : null,
      status,
    );
    assert.equal(
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null,
      code,
    );
    return true;
  };
}

function databaseError(code: string) {
  return (error: unknown) => {
    assert.equal(
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null,
      code,
    );
    return true;
  };
}

function agentDraft(input: {
  draftVersionId: string;
  draftRevision: number;
  name: string;
  accessMode?: "open" | "restricted";
  sources?: Array<
    | { sourceType: "course_version"; courseId: string }
    | { sourceType: "manual_text"; title: string; content: string }
    | {
        sourceType: "media_asset";
        mediaAssetId: string;
        title: string;
        content: string;
      }
  >;
  accessGrants?: Array<
    | { subjectType: "role"; subjectRole: "owner" | "admin" | "trainer" | "member" }
    | { subjectType: "user"; subjectUserId: string }
    | { subjectType: "group"; subjectGroupId: string }
    | { subjectType: "bundle"; subjectBundleId: string }
  >;
}) {
  return {
    expectedDraftVersionId: input.draftVersionId,
    expectedDraftRevision: input.draftRevision,
    agentType: "knowledge_assistant" as const,
    name: input.name,
    description: "Versionsgebundener Agent-Studio-Integrationstest.",
    systemPrompt:
      "Antworte ausschliesslich anhand der freigegebenen und versiegelten Wissensquellen.",
    color: "#2BB7A9",
    icon: "brain-circuit",
    knowledgeMode: "selected_sources" as const,
    accessMode: input.accessMode ?? "open",
    sources:
      input.sources ?? [
        {
          sourceType: "manual_text" as const,
          title: "Freigegebene Testquelle",
          content: "Diese kuratierte Quelle enthaelt ausreichend Testinhalt.",
        },
      ],
    accessGrants: input.accessGrants ?? [],
  };
}

const documentDependencies = {
  extractDocumentSnapshot: async (input: {
    organizationId: string;
    mediaAssetId: string;
  }) => ({
    mediaAssetId: input.mediaAssetId,
    title: "Server-extracted document",
    content:
      "This text was extracted from the immutable ready document by the server.",
    contentDigest: "a".repeat(64),
    extractedAt: new Date("2026-07-12T12:00:00.000Z"),
  }),
};

const updateTestDraft = (
  input: Parameters<typeof updateAiAgentDraft>[0],
) => updateAiAgentDraft(input, documentDependencies);

const publishTestDraft = (
  input: Parameters<typeof publishAiAgentDraft>[0],
) => publishAiAgentDraft(input, documentDependencies);

test(
  "agent studio core seals publications, enforces tenant access and binds conversations to versions",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let organizationId = "";
    let foreignOrganizationId = "";

    try {
      const organizations = await sql<
        Array<{ id: string; slug: string }>
      >`
        insert into organizations (name, slug)
        values
          (${`Agent Studio Core ${suffix}`}, ${`agent-studio-core-${suffix}`}),
          (${`Agent Studio Foreign ${suffix}`}, ${`agent-studio-foreign-${suffix}`})
        returning id, slug
      `;
      organizationId = organizations[0]!.id;
      foreignOrganizationId = organizations[1]!.id;

      const createdUsers = await sql<
        Array<{ id: string; email: string; role: AiAgentActor["role"] }>
      >`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${organizationId}, ${`owner-${suffix}@example.test`}, 'unused', 'Core', 'Owner', 'owner'),
          (${organizationId}, ${`trainer-${suffix}@example.test`}, 'unused', 'Role', 'Trainer', 'trainer'),
          (${organizationId}, ${`direct-${suffix}@example.test`}, 'unused', 'Direct', 'Member', 'member'),
          (${organizationId}, ${`group-${suffix}@example.test`}, 'unused', 'Group', 'Member', 'member'),
          (${organizationId}, ${`bundle-${suffix}@example.test`}, 'unused', 'Bundle', 'Member', 'member'),
          (${organizationId}, ${`denied-${suffix}@example.test`}, 'unused', 'Denied', 'Member', 'member'),
          (${organizationId}, ${`replacement-${suffix}@example.test`}, 'unused', 'Replacement', 'Member', 'member'),
          (${foreignOrganizationId}, ${`foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', 'member')
        returning id, email, role
      `;
      const user = (prefix: string) =>
        createdUsers.find((candidate) => candidate.email.startsWith(prefix))!;
      const owner = user("owner-");
      const trainer = user("trainer-");
      const directMember = user("direct-");
      const groupMember = user("group-");
      const bundleMember = user("bundle-");
      const deniedMember = user("denied-");
      const replacementMember = user("replacement-");
      const foreignMember = user("foreign-");
      const actor: AiAgentActor = {
        id: owner.id,
        organizationId,
        role: owner.role,
      };

      const [group] = await sql<Array<{ id: string }>>`
        insert into groups (organization_id, name)
        values (${organizationId}, ${`Agent target group ${suffix}`})
        returning id
      `;
      await sql`
        insert into group_members (group_id, user_id)
        values (${group!.id}, ${groupMember.id})
      `;
      const [bundle] = await sql<Array<{ id: string }>>`
        insert into bundles (organization_id, name)
        values (${organizationId}, ${`Agent target bundle ${suffix}`})
        returning id
      `;
      await sql`
        insert into member_bundles (user_id, bundle_id)
        values (${bundleMember.id}, ${bundle!.id})
      `;

      const [course] = await sql<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description,
          status, created_by_id
        ) values (
          ${organizationId}, ${`Agent source course ${suffix}`},
          ${`agent-source-${suffix}`}, 'Agent source',
          'Published course used to verify source version freezing.',
          'published', ${owner.id}
        ) returning id
      `;
      const courseVersionIds = [randomUUID(), randomUUID()];
      for (const [index, courseVersionId] of courseVersionIds.entries()) {
        await sql`
          insert into course_versions (
            id, organization_id, course_id, version, snapshot, changelog,
            published_at, created_by_id
          ) values (
            ${courseVersionId}, ${organizationId}, ${course!.id}, ${index + 1},
            ${sql.json({
              schemaVersion: 6,
              accessPolicyVersion: 2,
              moduleKindVersion: 1,
              courseOutlineVersion: 1,
              capturedAt: new Date().toISOString(),
              course: {
                id: course!.id,
                organizationId,
                title: `Agent source course ${index + 1}`,
                slug: `agent-source-${suffix}`,
                shortDescription: "Agent source",
                description: "Frozen source snapshot",
                status: "published",
                difficulty: "Grundlagen",
                estimatedMinutes: 10,
                certificateEnabled: false,
                featured: false,
                visibleInCatalog: true,
                showProgressPercentage: true,
                publishedVersionId: courseVersionId,
                firstPublishedAt: new Date().toISOString(),
                createdById: owner.id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              learningGoals: [],
              authors: [],
              widgets: [],
              modules: [],
            })},
            ${`Published version ${index + 1}`}, now(), ${owner.id}
          )
        `;
      }
      await sql`
        update courses
        set published_version_id = ${courseVersionIds[0]},
            first_published_at = now()
        where id = ${course!.id}
      `;

      const readyMediaId = randomUUID();
      const pendingMediaId = randomUUID();
      const foreignMediaId = randomUUID();
      const insertMedia = async (input: {
        id: string;
        tenantId: string;
        uploaderId: string;
        status: "pending" | "ready";
      }) => {
        const ready = input.status === "ready";
        await sql`
          insert into media_assets (
            id, organization_id, uploaded_by_id, purpose, kind, status,
            storage_driver, storage_key, staging_storage_key,
            original_file_name, safe_file_name, declared_mime_type,
            detected_mime_type, declared_size_bytes, actual_size_bytes,
            quota_bytes, upload_expires_at, uploaded_at, scan_completed_at,
            content_sha256
          ) values (
            ${input.id}, ${input.tenantId}, ${input.uploaderId},
            'course_content', 'document', ${input.status}, 'filesystem',
            ${`tenants/${input.tenantId}/assets/${input.id}/knowledge.txt`},
            ${`incoming/tenants/${input.tenantId}/assets/${input.id}/knowledge.txt`},
            'knowledge.txt', 'knowledge.txt', 'text/plain',
            ${ready ? "text/plain" : null}, 128, ${ready ? 128 : null}, 128,
            now() + interval '1 hour', ${ready ? new Date() : null},
            ${ready ? new Date() : null}, ${ready ? "a".repeat(64) : null}
          )
        `;
      };
      await insertMedia({
        id: readyMediaId,
        tenantId: organizationId,
        uploaderId: owner.id,
        status: "ready",
      });
      await insertMedia({
        id: pendingMediaId,
        tenantId: organizationId,
        uploaderId: owner.id,
        status: "pending",
      });
      await insertMedia({
        id: foreignMediaId,
        tenantId: foreignOrganizationId,
        uploaderId: foreignMember.id,
        status: "ready",
      });

      const identity = await createAiAgentDraftIdentity({
        actor,
        name: `Core Agent ${suffix}`,
        description: "Draft-only agent for publication tests.",
        systemPrompt: "Use only reviewed and published learning sources.",
        color: "#2BB7A9",
        icon: "brain-circuit",
      });

      assert.deepEqual(
        await listAccessiblePublishedAiAgents({
          organizationId,
          userId: directMember.id,
        }),
        [],
        "draft-only agents must not be discoverable",
      );
      await assert.rejects(
        requireAccessiblePublishedAiAgent({
          organizationId,
          userId: directMember.id,
          agentId: identity.agentId,
        }),
        apiError(404, "not_found"),
      );

      await assert.rejects(
        updateTestDraft({
          actor,
          agentId: identity.agentId,
          draft: agentDraft({
            draftVersionId: identity.draft.id,
            draftRevision: 1,
            name: `Core Agent ${suffix}`,
            sources: [
              {
                sourceType: "media_asset",
                mediaAssetId: pendingMediaId,
                title: "Pending source",
                content: "Pending assets must never become agent knowledge.",
              },
            ],
          }),
        }),
        apiError(422, "validation_error"),
      );
      await assert.rejects(
        updateTestDraft({
          actor,
          agentId: identity.agentId,
          draft: agentDraft({
            draftVersionId: identity.draft.id,
            draftRevision: 1,
            name: `Core Agent ${suffix}`,
            sources: [
              {
                sourceType: "media_asset",
                mediaAssetId: foreignMediaId,
                title: "Foreign source",
                content: "Foreign tenant assets must fail closed every time.",
              },
            ],
          }),
        }),
        apiError(422, "validation_error"),
      );
      await assert.rejects(
        updateTestDraft({
          actor,
          agentId: identity.agentId,
          draft: agentDraft({
            draftVersionId: identity.draft.id,
            draftRevision: 1,
            name: `Core Agent ${suffix}`,
            accessMode: "restricted",
            accessGrants: [
              { subjectType: "user", subjectUserId: foreignMember.id },
            ],
          }),
        }),
        apiError(422, "validation_error"),
      );

      const validSources = [
        { sourceType: "course_version" as const, courseId: course!.id },
        {
          sourceType: "manual_text" as const,
          title: "Studio handbook",
          content: "This reviewed handbook remains immutable after publication.",
        },
        {
          sourceType: "media_asset" as const,
          mediaAssetId: readyMediaId,
          title: "Reviewed document",
          content: "This ready document is an accepted curated knowledge source.",
        },
      ];
      const validGrants = [
        { subjectType: "role" as const, subjectRole: "trainer" as const },
        { subjectType: "user" as const, subjectUserId: directMember.id },
        { subjectType: "group" as const, subjectGroupId: group!.id },
        { subjectType: "bundle" as const, subjectBundleId: bundle!.id },
      ];
      const updated = await updateTestDraft({
        actor,
        agentId: identity.agentId,
        draft: agentDraft({
          draftVersionId: identity.draft.id,
          draftRevision: 1,
          name: `Core Agent ${suffix}`,
          accessMode: "restricted",
          sources: validSources,
          accessGrants: validGrants,
        }),
      });
      assert.equal(updated.draftRevision, 2);
      assert.equal(updated.id, identity.draft.id);

      await assert.rejects(
        updateTestDraft({
          actor,
          agentId: identity.agentId,
          draft: agentDraft({
            draftVersionId: identity.draft.id,
            draftRevision: 1,
            name: `Stale Core Agent ${suffix}`,
            accessMode: "restricted",
            sources: validSources,
            accessGrants: validGrants,
          }),
        }),
        apiError(409, "conflict"),
      );

      await sql`
        update courses
        set published_version_id = ${courseVersionIds[1]}
        where id = ${course!.id}
      `;
      const firstPublication = await publishTestDraft({
        actor,
        agentId: identity.agentId,
        publication: {
          expectedDraftVersionId: identity.draft.id,
          expectedDraftRevision: 2,
        },
      });
      assert.equal(firstPublication.published.id, identity.draft.id);
      assert.equal(firstPublication.published.version, 1);
      assert.equal(firstPublication.published.state, "published");
      assert.ok(firstPublication.published.publishedAt);
      assert.equal(firstPublication.nextDraft.version, 2);
      assert.equal(firstPublication.nextDraft.state, "draft");
      assert.equal(firstPublication.nextDraft.draftRevision, 1);

      const [publishedPointers] = await sql<
        Array<{ draftVersionId: string; publishedVersionId: string }>
      >`
        select draft_version_id as "draftVersionId",
               published_version_id as "publishedVersionId"
        from ai_agents
        where id = ${identity.agentId}
      `;
      assert.deepEqual(publishedPointers, {
        draftVersionId: firstPublication.nextDraft.id,
        publishedVersionId: firstPublication.published.id,
      });

      const publishedSources = await sql<
        Array<{
          id: string;
          sourceType: string;
          courseVersionId: string | null;
          mediaAssetId: string | null;
          title: string | null;
          content: string | null;
          contentDigest: string | null;
          fetchedAt: Date | null;
        }>
      >`
        select id, source_type as "sourceType",
               course_version_id as "courseVersionId",
               media_asset_id as "mediaAssetId",
               title, content,
               content_digest as "contentDigest",
               fetched_at as "fetchedAt"
        from ai_agent_version_sources
        where agent_version_id = ${firstPublication.published.id}
        order by sort_order
      `;
      assert.equal(publishedSources.length, 3);
      assert.equal(
        publishedSources.find((source) => source.sourceType === "course_version")!
          .courseVersionId,
        courseVersionIds[1],
        "publication must freeze the course version current at publish time",
      );
      const publishedDocument = publishedSources.find(
        (source) => source.sourceType === "media_asset",
      )!;
      assert.equal(publishedDocument.mediaAssetId, readyMediaId);
      assert.equal(publishedDocument.title, "Server-extracted document");
      assert.equal(
        publishedDocument.content,
        "This text was extracted from the immutable ready document by the server.",
      );
      assert.notEqual(
        publishedDocument.content,
        "This ready document is an accepted curated knowledge source.",
      );
      assert.equal(publishedDocument.contentDigest, "a".repeat(64));
      assert.equal(
        publishedDocument.fetchedAt?.toISOString(),
        "2026-07-12T12:00:00.000Z",
      );

      const [publishedGrant] = await sql<Array<{ id: string }>>`
        select id from ai_agent_version_access_grants
        where agent_version_id = ${firstPublication.published.id}
        order by created_at
        limit 1
      `;
      for (const operation of [
        () => sql`
          update ai_agent_versions set name = 'Mutated publication'
          where id = ${firstPublication.published.id}
        `,
        () => sql`
          update ai_agent_version_sources set title = 'Mutated source'
          where id = ${publishedSources[1]!.id}
        `,
        () => sql`
          delete from ai_agent_version_access_grants
          where id = ${publishedGrant!.id}
        `,
      ]) {
        await assert.rejects(operation(), databaseError("55000"));
      }

      await sql`
        update ai_agents set active = true
        where id = ${identity.agentId}
      `;
      for (const granted of [
        owner,
        trainer,
        directMember,
        groupMember,
        bundleMember,
      ]) {
        const accessible = await listAccessiblePublishedAiAgents({
          organizationId,
          userId: granted.id,
        });
        assert.ok(
          accessible.some((agent) => agent.agentId === identity.agentId),
          `expected access for ${granted.email}`,
        );
      }
      assert.equal(
        (
          await listAccessiblePublishedAiAgents({
            organizationId,
            userId: deniedMember.id,
          })
        ).some((agent) => agent.agentId === identity.agentId),
        false,
      );
      assert.deepEqual(
        await listAccessiblePublishedAiAgents({
          organizationId: foreignOrganizationId,
          userId: foreignMember.id,
        }),
        [],
      );
      await assert.rejects(
        listAccessiblePublishedAiAgents({
          organizationId,
          userId: foreignMember.id,
        }),
        apiError(404, "not_found"),
      );

      const openIdentity = await createAiAgentDraftIdentity({
        actor,
        name: `Open Agent ${suffix}`,
        description: "Open published agent for access verification.",
        systemPrompt: "Answer all active members from approved knowledge only.",
        color: "#4F7CAC",
        icon: "bot",
        publish: true,
        active: true,
      });
      const openAgents = await listAccessiblePublishedAiAgents({
        organizationId,
        userId: deniedMember.id,
      });
      assert.ok(
        openAgents.some((agent) => agent.agentId === openIdentity.agentId),
        "open publications must be visible to every active tenant member",
      );

      const oldConversation = await createAiConversation({
        organizationId,
        agentId: identity.agentId,
        userId: directMember.id,
        title: "Version one conversation",
      });
      assert.equal(
        oldConversation.agentVersionId,
        firstPublication.published.id,
        "conversation creation must bind the current publication",
      );

      const secondDraft = await updateTestDraft({
        actor,
        agentId: identity.agentId,
        draft: agentDraft({
          draftVersionId: firstPublication.nextDraft.id,
          draftRevision: 1,
          name: `Core Agent v2 ${suffix}`,
          accessMode: "restricted",
          accessGrants: [
            {
              subjectType: "user",
              subjectUserId: replacementMember.id,
            },
          ],
        }),
      });
      const secondPublication = await publishTestDraft({
        actor,
        agentId: identity.agentId,
        publication: {
          expectedDraftVersionId: secondDraft.id,
          expectedDraftRevision: secondDraft.draftRevision,
        },
      });
      assert.equal(secondPublication.published.version, 2);
      assert.equal(secondPublication.nextDraft.version, 3);

      await assert.rejects(
        requireAccessiblePublishedAiAgent({
          organizationId,
          userId: directMember.id,
          agentId: identity.agentId,
        }),
        apiError(404, "not_found"),
      );
      await assert.rejects(
        sendAiConversationMessage({
          organizationId,
          conversationId: oldConversation.id,
          content: "This send must be rejected after publication access changed.",
        }),
        apiError(404, "not_found"),
      );
      const [unchangedConversation] = await sql<
        Array<{ agentVersionId: string; messageCount: number }>
      >`
        select agent_version_id as "agentVersionId",
               message_count as "messageCount"
        from ai_conversations where id = ${oldConversation.id}
      `;
      assert.deepEqual(unchangedConversation, {
        agentVersionId: firstPublication.published.id,
        messageCount: 0,
      });
      const replacementConversation = await createAiConversation({
        organizationId,
        agentId: identity.agentId,
        userId: replacementMember.id,
      });
      assert.equal(
        replacementConversation.agentVersionId,
        secondPublication.published.id,
      );

      const [foreignPublishedVersion] = await sql<Array<{ id: string }>>`
        select published_version_id as id
        from ai_agents
        where organization_id = ${foreignOrganizationId}
          and published_version_id is not null
        limit 1
      `;
      if (foreignPublishedVersion) {
        await assert.rejects(
          rollbackAiAgentVersion({
            actor,
            agentId: identity.agentId,
            rollback: { publishedVersionId: foreignPublishedVersion.id },
          }),
          apiError(404, "not_found"),
        );
      } else {
        await assert.rejects(
          rollbackAiAgentVersion({
            actor,
            agentId: identity.agentId,
            rollback: { publishedVersionId: randomUUID() },
          }),
          apiError(404, "not_found"),
        );
      }
      const [beforeRollback] = await sql<Array<{ id: string }>>`
        select published_version_id as id from ai_agents
        where id = ${identity.agentId}
      `;
      assert.equal(beforeRollback!.id, secondPublication.published.id);

      const rolledBack = await rollbackAiAgentVersion({
        actor,
        agentId: identity.agentId,
        rollback: { publishedVersionId: firstPublication.published.id },
      });
      assert.equal(rolledBack.id, firstPublication.published.id);
      const [afterRollback] = await sql<
        Array<{ id: string; eventCount: number }>
      >`
        select agent.published_version_id as id,
               (
                 select count(*)::int from activity_events as event
                 where event.organization_id = ${organizationId}
                   and event.entity_id = agent.id
                   and event.type = 'agent.version.rolled_back'
               ) as "eventCount"
        from ai_agents as agent where agent.id = ${identity.agentId}
      `;
      assert.deepEqual(afterRollback, {
        id: firstPublication.published.id,
        eventCount: 1,
      });
      const restoredConversation = await createAiConversation({
        organizationId,
        agentId: identity.agentId,
        userId: directMember.id,
      });
      assert.equal(restoredConversation.agentVersionId, rolledBack.id);
      const boundVersions = await sql<Array<{ id: string }>>`
        select agent_version_id as id from ai_conversations
        where id in (${oldConversation.id}, ${replacementConversation.id})
        order by id
      `;
      assert.deepEqual(
        new Set(boundVersions.map((row) => row.id)),
        new Set([
          firstPublication.published.id,
          secondPublication.published.id,
        ]),
        "rollback must not rewrite historical conversation bindings",
      );
    } finally {
      for (const tenantId of [organizationId, foreignOrganizationId].filter(Boolean)) {
        await sql`delete from organizations where id = ${tenantId}`;
      }
    }
  },
);
