import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  createAiAgentDraftIdentity,
  previewAiAgentDraftAsMember,
  updateAiAgentDraft,
  type AiAgentActor,
} from "../src/lib/ai/agent-studio";
import {
  DEFAULT_AI_AGENT_POLICY,
  getCurrentAiAgentCreditUsage,
} from "../src/lib/ai/agent-policy";
import type { AiCompletionInput } from "../src/lib/ai/provider";

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

test(
  "draft member preview enforces audience, tenant and live source access without user-data persistence",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let organizationId = "";
    let foreignOrganizationId = "";

    try {
      const organizations = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values
          (${`Agent Preview ${suffix}`}, ${`agent-preview-${suffix}`}),
          (${`Foreign Preview ${suffix}`}, ${`foreign-preview-${suffix}`})
        returning id
      `;
      organizationId = organizations[0]!.id;
      foreignOrganizationId = organizations[1]!.id;

      const userRows = await sql<
        Array<{ id: string; email: string; role: AiAgentActor["role"] }>
      >`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${organizationId}, ${`owner-${suffix}@example.test`}, 'unused', 'Preview', 'Owner', 'owner'),
          (${organizationId}, ${`trainer-${suffix}@example.test`}, 'unused', 'Role', 'Trainer', 'trainer'),
          (${organizationId}, ${`direct-${suffix}@example.test`}, 'unused', 'Direct', 'Member', 'member'),
          (${organizationId}, ${`group-${suffix}@example.test`}, 'unused', 'Group', 'Member', 'member'),
          (${organizationId}, ${`bundle-${suffix}@example.test`}, 'unused', 'Bundle', 'Member', 'member'),
          (${organizationId}, ${`denied-${suffix}@example.test`}, 'unused', 'Denied', 'Member', 'member'),
          (${foreignOrganizationId}, ${`foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', 'member')
        returning id, email, role
      `;
      const user = (prefix: string) =>
        userRows.find((candidate) => candidate.email.startsWith(prefix))!;
      const owner = user("owner-");
      const trainer = user("trainer-");
      const directMember = user("direct-");
      const groupMember = user("group-");
      const bundleMember = user("bundle-");
      const deniedMember = user("denied-");
      const foreignMember = user("foreign-");
      const actor: AiAgentActor = {
        id: owner.id,
        organizationId,
        role: owner.role,
      };

      const [group] = await sql<Array<{ id: string }>>`
        insert into groups (organization_id, name)
        values (${organizationId}, ${`Preview group ${suffix}`})
        returning id
      `;
      await sql`
        insert into group_members (group_id, user_id)
        values (${group!.id}, ${groupMember.id})
      `;
      const [bundle] = await sql<Array<{ id: string }>>`
        insert into bundles (organization_id, name)
        values (${organizationId}, ${`Preview bundle ${suffix}`})
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
          ${organizationId}, ${`Preview course ${suffix}`},
          ${`preview-course-${suffix}`}, 'Preview source',
          'A published source used by the member preview.', 'published',
          ${owner.id}
        ) returning id
      `;
      const courseVersionId = randomUUID();
      await sql`
        insert into course_versions (
          id, organization_id, course_id, version, snapshot, changelog,
          published_at, created_by_id
        ) values (
          ${courseVersionId}, ${organizationId}, ${course!.id}, 1,
          ${sql.json({
            schemaVersion: 6,
            accessPolicyVersion: 2,
            moduleKindVersion: 1,
            courseOutlineVersion: 1,
            capturedAt: new Date().toISOString(),
            course: {
              id: course!.id,
              organizationId,
              title: `Preview course ${suffix}`,
              slug: `preview-course-${suffix}`,
              shortDescription: "Preview source",
              description: "A frozen preview source.",
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
          'Initial preview publication', now(), ${owner.id}
        )
      `;
      await sql`
        update courses
        set published_version_id = ${courseVersionId}, first_published_at = now()
        where id = ${course!.id}
      `;
      await sql`
        insert into enrollments (user_id, course_id, access_active, progress)
        values (${directMember.id}, ${course!.id}, true, 20)
      `;
      await sql`
        insert into course_access_grants (
          organization_id, user_id, course_id, source
        ) values (
          ${organizationId}, ${directMember.id}, ${course!.id}, 'preview-test'
        )
      `;

      const mediaAssetId = randomUUID();
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, purpose, kind, status,
          storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          detected_mime_type, declared_size_bytes, actual_size_bytes,
          quota_bytes, upload_expires_at, uploaded_at, scan_completed_at,
          content_sha256
        ) values (
          ${mediaAssetId}, ${organizationId}, ${owner.id},
          'course_content', 'document', 'ready', 'filesystem',
          ${`tenants/${organizationId}/assets/${mediaAssetId}/preview.txt`},
          ${`incoming/tenants/${organizationId}/assets/${mediaAssetId}/preview.txt`},
          'preview.txt', 'preview.txt', 'text/plain', 'text/plain',
          128, 128, 128, now() + interval '1 hour', now(), now(),
          ${"b".repeat(64)}
        )
      `;

      const systemPrompt =
        "SYSTEM-PREVIEW-SECRET: Use the private internal evaluation rubric.";
      const manualContent =
        `MANUAL-PREVIEW-SECRET contains the reviewed answer for this test. Internal ${course!.id} at /academy/courses/private.`;
      const mediaContent =
        "MEDIA-PREVIEW-SECRET contains another reviewed answer.";
      const identity = await createAiAgentDraftIdentity({
        actor,
        name: `Preview Agent ${suffix}`,
        description: "Draft preview integration test.",
        systemPrompt,
        color: "#2BB7A9",
        icon: "bot",
      });
      const updatedDraft = await updateAiAgentDraft(
        {
          actor,
          agentId: identity.agentId,
          draft: {
          expectedDraftVersionId: identity.draft.id,
          expectedDraftRevision: identity.draft.draftRevision,
          agentType: "knowledge_assistant",
          name: `Preview Agent ${suffix}`,
          description: "Draft preview integration test.",
          systemPrompt,
          color: "#2BB7A9",
          icon: "bot",
          knowledgeMode: "selected_sources",
          accessMode: "restricted",
          sources: [
            { sourceType: "course_version", courseId: course!.id },
            {
              sourceType: "manual_text",
              title: "Preview handbook",
              content: manualContent,
            },
            {
              sourceType: "media_asset",
              mediaAssetId,
              title: "Preview document",
              content: mediaContent,
            },
          ],
          accessGrants: [
            { subjectType: "role", subjectRole: "trainer" },
            { subjectType: "user", subjectUserId: directMember.id },
            { subjectType: "group", subjectGroupId: group!.id },
            { subjectType: "bundle", subjectBundleId: bundle!.id },
          ],
          },
        },
        {
          extractDocumentSnapshot: async () => ({
            mediaAssetId,
            title: "Preview document",
            content: mediaContent,
            contentDigest: "b".repeat(64),
            extractedAt: new Date("2026-07-12T12:00:00.000Z"),
          }),
        },
      );
      assert.equal(updatedDraft.draftRevision, 2);

      const [before] = await sql<
        Array<{
          conversations: number;
          messages: number;
          activities: number;
          apiAudits: number;
        }>
      >`
        select
          (select count(*)::int from ai_conversations where organization_id = ${organizationId}) as conversations,
          (select count(*)::int from ai_messages where organization_id = ${organizationId}) as messages,
          (select count(*)::int from activity_events where organization_id = ${organizationId}) as activities,
          (select count(*)::int from api_audit_logs where organization_id = ${organizationId}) as "apiAudits"
      `;

      let completionCalls = 0;
      const providerInputs: AiCompletionInput[] = [];
      const complete = async (providerInput: AiCompletionInput) => {
        completionCalls += 1;
        providerInputs.push(providerInput);
        const projectedContent = providerInput.courses
          .flatMap((course) => course.sources.map((source) => source.excerpt))
          .join("\n");
        return {
          content: `${providerInput.agentSystemPrompt}\n${projectedContent}\napi_key=provider-secret\n${course!.id}\n/academy/courses/internal/learn/unit`,
          suggestions: [
            providerInput.agentSystemPrompt,
            "Welche Inhalte sind sichtbar?",
          ],
          provider: "preview-test",
          model: "preview-test",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          citations: [],
          metadata: {},
        };
      };
      const runPreview = (memberId: string) =>
        previewAiAgentDraftAsMember(
          {
            actor,
            agentId: identity.agentId,
            preview: {
              expectedDraftVersionId: identity.draft.id,
              expectedDraftRevision: 2,
              memberId,
              message: "Welche Kursinhalte kann ich verwenden?",
            },
          },
          { complete },
        );

      for (const grantedMember of [
        trainer,
        directMember,
        groupMember,
        bundleMember,
      ]) {
        const result = await runPreview(grantedMember.id);
        assert.equal(result.allowed, true);
        assert.equal(result.status, "allowed");
        const serialized = JSON.stringify(result);
        assert.doesNotMatch(serialized, /SYSTEM-PREVIEW-SECRET/i);
        assert.doesNotMatch(serialized, /MANUAL-PREVIEW-SECRET/i);
        assert.doesNotMatch(serialized, /MEDIA-PREVIEW-SECRET/i);
        assert.doesNotMatch(serialized, /provider-secret/i);
        assert.equal(serialized.includes(course!.id), false);
        assert.doesNotMatch(serialized, /\/academy\//i);
        assert.equal(serialized.includes(identity.agentId), false);
        assert.equal(serialized.includes(grantedMember.id), false);
        assert.equal(serialized.includes(organizationId), false);
      }
      assert.equal(completionCalls, 4);
      for (const providerInput of providerInputs) {
        const serialized = JSON.stringify(providerInput);
        assert.equal(providerInput.userFirstName, "Testmitglied");
        assert.match(providerInput.safetyIdentifier, /^[0-9a-f]{64}$/);
        assert.equal(serialized.includes(organizationId), false);
        assert.equal(serialized.includes(course!.id), false);
        assert.equal(serialized.includes(courseVersionId), false);
        assert.equal(serialized.includes(mediaAssetId), false);
        assert.doesNotMatch(serialized, /\/academy\//i);
        for (const context of providerInput.courses) {
          assert.equal(context.progress, 0);
          assert.doesNotMatch(context.id, /^[0-9a-f-]{36}$/i);
          for (const source of context.sources) {
            assert.equal(source.href, "");
            assert.doesNotMatch(source.id, /^[0-9a-f-]{36}$/i);
          }
        }
      }

      const visibleKnowledge = await runPreview(directMember.id);
      assert.deepEqual(visibleKnowledge.coverage, {
        courseCount: 1,
        manualSourceCount: 1,
        mediaSourceCount: 1,
        webSourceCount: 0,
        referenceCount: 2,
        unavailableSourceCount: 0,
      });
      assert.equal(completionCalls, 5);

      const denied = await runPreview(deniedMember.id);
      assert.equal(denied.allowed, false);
      assert.equal(denied.status, "not_in_audience");
      assert.equal(denied.answer, null);
      assert.deepEqual(denied.suggestions, []);
      assert.equal(completionCalls, 5, "denied previews must not call a provider");

      await assert.rejects(
        previewAiAgentDraftAsMember(
          {
            actor,
            agentId: identity.agentId,
            preview: {
              expectedDraftVersionId: identity.draft.id,
              expectedDraftRevision: 1,
              memberId: directMember.id,
              message: "Stale preview",
            },
          },
          { complete },
        ),
        apiError(409, "conflict"),
      );
      await assert.rejects(
        runPreview(foreignMember.id),
        apiError(404, "not_found"),
      );

      await sql`
        update enrollments set access_active = false
        where user_id = ${directMember.id} and course_id = ${course!.id}
      `;
      await sql`
        update media_assets set status = 'quarantined', updated_at = now()
        where id = ${mediaAssetId}
      `;
      const revoked = await runPreview(directMember.id);
      assert.equal(revoked.allowed, true);
      assert.deepEqual(revoked.coverage, {
        courseCount: 0,
        manualSourceCount: 1,
        mediaSourceCount: 0,
        webSourceCount: 0,
        referenceCount: 1,
        unavailableSourceCount: 2,
      });

      await sql`
        update enrollments set access_active = true
        where user_id = ${directMember.id} and course_id = ${course!.id}
      `;
      await sql`
        update media_assets set status = 'ready', updated_at = now()
        where id = ${mediaAssetId}
      `;
      const callsBeforeRace = completionCalls;
      let eligibilityRechecks = 0;
      await assert.rejects(
        previewAiAgentDraftAsMember(
          {
            actor,
            agentId: identity.agentId,
            preview: {
              expectedDraftVersionId: identity.draft.id,
              expectedDraftRevision: 2,
              memberId: directMember.id,
              message: "Wird ein paralleler Entzug sicher erkannt?",
            },
          },
          {
            complete,
            beforeEligibilityRecheck: async () => {
              eligibilityRechecks += 1;
              await sql`
                update enrollments set access_active = false
                where user_id = ${directMember.id} and course_id = ${course!.id}
              `;
            },
          },
        ),
        apiError(409, "conflict"),
      );
      assert.equal(eligibilityRechecks, 1);
      assert.equal(
        completionCalls,
        callsBeforeRace,
        "eligibility changes must prevent provider dispatch",
      );
      const previewCreditUsage = await getCurrentAiAgentCreditUsage(
        organizationId,
        { ...DEFAULT_AI_AGENT_POLICY },
      );
      assert.equal(
        previewCreditUsage.creditsUsed,
        0,
        "admin previews must not consume customer credits",
      );

      const disabledPolicy = {
        schemaVersion: 1,
        enabled: false,
        monthlyCreditLimit: 10_000,
        perMemberHourlyLimit: 60,
      };
      await sql`
        insert into platform_settings (organization_id, key, value)
        values (${organizationId}, 'ai_agent_policy', ${sql.json(disabledPolicy)})
        on conflict (organization_id, key)
        do update set value = excluded.value, updated_at = now()
      `;
      await assert.rejects(
        runPreview(directMember.id),
        apiError(403, "forbidden"),
      );
      assert.equal(completionCalls, callsBeforeRace);

      await sql`
        update platform_settings
        set value = ${sql.json({ ...disabledPolicy, enabled: "invalid" })},
            updated_at = now()
        where organization_id = ${organizationId} and key = 'ai_agent_policy'
      `;
      await assert.rejects(
        runPreview(directMember.id),
        apiError(503, "internal_error"),
      );
      assert.equal(
        completionCalls,
        callsBeforeRace,
        "disabled or invalid policy must prevent provider dispatch",
      );

      const [afterPreview] = await sql<Array<typeof before>>`
        select
          (select count(*)::int from ai_conversations where organization_id = ${organizationId}) as conversations,
          (select count(*)::int from ai_messages where organization_id = ${organizationId}) as messages,
          (select count(*)::int from activity_events where organization_id = ${organizationId}) as activities,
          (select count(*)::int from api_audit_logs where organization_id = ${organizationId}) as "apiAudits"
      `;
      assert.deepEqual(afterPreview, before);
    } finally {
      for (const tenantId of [organizationId, foreignOrganizationId].filter(
        Boolean,
      )) {
        await sql`delete from organizations where id = ${tenantId}`;
      }
    }
  },
);
