import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import type { CourseVersionSnapshot } from "../src/db/schema";
import {
  cancelAiAgentActionRequest,
  createAiAgentActionRequest,
  decideAiAgentActionRequest,
  listAiAgentActionEvents,
  listAvailableAiAgentActionsForMember,
} from "../src/lib/ai/agent-actions";
import {
  createAiAgentDraftIdentity,
  publishAiAgentDraft,
  updateAiAgentDraft,
  type AiAgentActor,
} from "../src/lib/ai/agent-studio";
import { updateAiAgentPolicy } from "../src/lib/ai/agent-policy";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 6, prepare: false });

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
  "agent actions require approval, execute exactly once and retain immutable audit",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const organizations = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values
        (${`Action tenant ${suffix}`}, ${`action-tenant-${suffix}`}),
        (${`Foreign action tenant ${suffix}`}, ${`foreign-action-${suffix}`})
      returning id
    `;
    const organizationId = organizations[0]!.id;
    const foreignOrganizationId = organizations[1]!.id;
    const users = await sql<
      Array<{
        id: string;
        organization_id: string;
        email: string;
        role: AiAgentActor["role"];
      }>
    >`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role
      ) values
        (${organizationId}, ${`owner-${suffix}@example.test`}, 'unused', 'Action', 'Owner', 'owner'),
        (${organizationId}, ${`approve-${suffix}@example.test`}, 'unused', 'Approve', 'Member', 'member'),
        (${organizationId}, ${`reject-${suffix}@example.test`}, 'unused', 'Reject', 'Member', 'member'),
        (${organizationId}, ${`cancel-${suffix}@example.test`}, 'unused', 'Cancel', 'Member', 'member'),
        (${foreignOrganizationId}, ${`foreign-owner-${suffix}@example.test`}, 'unused', 'Foreign', 'Owner', 'owner')
      returning id, organization_id, email, role
    `;
    const user = (prefix: string) =>
      users.find((candidate) => candidate.email.startsWith(prefix))!;
    const owner = user("owner-");
    const approveMember = user("approve-");
    const rejectMember = user("reject-");
    const cancelMember = user("cancel-");
    const foreignOwner = user("foreign-owner-");
    const actor: AiAgentActor = {
      id: owner.id,
      organizationId,
      role: owner.role,
    };

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${organizationId}, ${`Action course ${suffix}`},
        ${`action-course-${suffix}`}, 'Approval target',
        'Course access is granted only after approval.', 'published', ${owner.id}
      ) returning id
    `;
    const courseVersionId = randomUUID();
    const capturedAt = new Date().toISOString();
    const courseSnapshot: CourseVersionSnapshot = {
      schemaVersion: 6,
      accessPolicyVersion: 2,
      moduleKindVersion: 1,
      courseOutlineVersion: 1,
      capturedAt,
      course: {
        id: course!.id,
        organizationId,
        categoryId: null,
        title: `Action course ${suffix}`,
        slug: `action-course-${suffix}`,
        shortDescription: "Approval target",
        description: "Course access is granted only after approval.",
        coverImage: null,
        status: "published",
        difficulty: "Grundlagen",
        estimatedMinutes: 60,
        certificateEnabled: true,
        featured: false,
        visibleInCatalog: true,
        showProgressPercentage: true,
        publishedVersionId: courseVersionId,
        firstPublishedAt: capturedAt,
        createdById: owner.id,
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
      learningGoals: [],
      authors: [],
      widgets: [],
      modules: [],
    };
    await sql`
      insert into course_versions (
        id, organization_id, course_id, version, snapshot, changelog,
        published_at, created_by_id
      ) values (
        ${courseVersionId}, ${organizationId}, ${course!.id}, 1,
        ${sql.json(courseSnapshot)},
        'Action approval test', now(), ${owner.id}
      )
    `;
    await sql`
      update courses
      set published_version_id = ${courseVersionId}, first_published_at = now()
      where id = ${course!.id}
    `;
    const [group] = await sql<Array<{ id: string }>>`
      insert into groups (organization_id, name, description)
      values (${organizationId}, ${`Action group ${suffix}`}, 'AI provenance group')
      returning id
    `;
    const [bundle] = await sql<Array<{ id: string }>>`
      insert into bundles (organization_id, name, description, active)
      values (${organizationId}, ${`Action bundle ${suffix}`}, 'AI provenance bundle', true)
      returning id
    `;

    const identity = await createAiAgentDraftIdentity({
      actor,
      name: `Action Agent ${suffix}`,
      description: "Offers approval-gated learning access.",
      systemPrompt: "Only explain configured actions and never grant access directly.",
      color: "#2BB7A9",
      icon: "bot",
    });
    const draft = await updateAiAgentDraft({
      actor,
      agentId: identity.agentId,
      draft: {
        expectedDraftVersionId: identity.draft.id,
        expectedDraftRevision: identity.draft.draftRevision,
        agentType: "learning_coach",
        name: `Action Agent ${suffix}`,
        description: "Offers approval-gated learning access.",
        systemPrompt: "Only explain configured actions and never grant access directly.",
        color: "#2BB7A9",
        icon: "bot",
        knowledgeMode: "all_accessible_courses",
        accessMode: "open",
        sources: [],
        accessGrants: [],
        actions: [
          {
            actionType: "course_enrollment",
            courseId: course!.id,
            label: "Kurszugriff anfragen",
            description: "Sendet die Anfrage zur expliziten Admin-Freigabe.",
          },
          {
            actionType: "course_unenrollment",
            courseId: course!.id,
            label: "Direkten Kurszugriff entfernen",
            description:
              "Entfernt direkte Freigaben erst nach expliziter Admin-Freigabe.",
          },
          {
            actionType: "group_membership_add",
            groupId: group!.id,
            label: "Projektgruppe beitreten",
            description: "Erstellt eine ausgewiesene KI-Gruppenzuweisung.",
          },
          {
            actionType: "group_membership_remove",
            groupId: group!.id,
            label: "Projektgruppe verlassen",
            description: "Entfernt nur die ausgewiesene KI-Gruppenzuweisung.",
          },
          {
            actionType: "bundle_assignment_add",
            bundleId: bundle!.id,
            label: "Transfer-Bundle zuweisen",
            description: "Erstellt eine ausgewiesene KI-Bundle-Zuweisung.",
          },
          {
            actionType: "bundle_assignment_remove",
            bundleId: bundle!.id,
            label: "Transfer-Bundle entfernen",
            description: "Entfernt nur die ausgewiesene KI-Bundle-Zuweisung.",
          },
        ],
      },
    });
    const published = await publishAiAgentDraft({
      actor,
      agentId: identity.agentId,
      publication: {
        expectedDraftVersionId: draft.id,
        expectedDraftRevision: draft.draftRevision,
      },
    });
    await sql`
      update ai_agents set active = true
      where id = ${identity.agentId} and organization_id = ${organizationId}
    `;
    const actions = await listAvailableAiAgentActionsForMember({
      organizationId,
      memberId: approveMember.id,
      agentId: identity.agentId,
    });
    assert.equal(actions.length, 6);
    const enrollmentAction = actions.find(
      (action) => action.actionType === "course_enrollment",
    );
    const unenrollmentAction = actions.find(
      (action) => action.actionType === "course_unenrollment",
    );
    const groupAssignmentAction = actions.find(
      (action) => action.actionType === "group_membership_add",
    );
    const groupRemovalAction = actions.find(
      (action) => action.actionType === "group_membership_remove",
    );
    const bundleAssignmentAction = actions.find(
      (action) => action.actionType === "bundle_assignment_add",
    );
    const bundleRemovalAction = actions.find(
      (action) => action.actionType === "bundle_assignment_remove",
    );
    assert.equal(enrollmentAction?.state, "available");
    assert.equal(unenrollmentAction?.state, "completed");
    assert.ok(enrollmentAction);
    assert.ok(unenrollmentAction);
    assert.ok(groupAssignmentAction);
    assert.ok(groupRemovalAction);
    assert.ok(bundleAssignmentAction);
    assert.ok(bundleRemovalAction);
    const actionConfigurationId = enrollmentAction.id;

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () =>
        createAiAgentActionRequest({
          organizationId,
          actor: {
            kind: "user",
            id: approveMember.id,
            userId: approveMember.id,
          },
          request: {
            agentId: identity.agentId,
            actionConfigurationId,
            memberId: approveMember.id,
          },
        }),
      ),
    );
    assert.equal(concurrent.filter((result) => result.created).length, 1);
    assert.equal(new Set(concurrent.map((result) => result.request.id)).size, 1);
    const approvalRequest = concurrent[0]!.request;
    assert.equal(approvalRequest.agentVersionId, published.published.id);
    await assert.rejects(
      sql`
        update ai_agent_action_requests
        set status = 'rejected', label_snapshot = 'Manipulated', revision = revision + 1
        where id = ${approvalRequest.id}
      `,
      /payload is immutable/,
    );

    const approved = await decideAiAgentActionRequest({
      organizationId,
      actorId: owner.id,
      actor: { kind: "user", id: owner.id, userId: owner.id },
      requestId: approvalRequest.id,
      decision: { decision: "approve", expectedRevision: 1 },
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.revision, 2);
    assert.ok(approved.executedAt);
    await assert.rejects(
      decideAiAgentActionRequest({
        organizationId,
        actorId: owner.id,
        actor: { kind: "user", id: owner.id, userId: owner.id },
        requestId: approvalRequest.id,
        decision: { decision: "approve", expectedRevision: 1 },
      }),
      apiError(409, "conflict"),
    );
    const grants = await sql<
      Array<{ source: string; access_active: boolean }>
    >`
      select access_grant.source, enrollment.access_active
      from course_access_grants access_grant
      join enrollments enrollment
        on enrollment.user_id = access_grant.user_id
       and enrollment.course_id = access_grant.course_id
      where access_grant.organization_id = ${organizationId}
        and access_grant.user_id = ${approveMember.id}
        and access_grant.course_id = ${course!.id}
        and access_grant.source = ${`ai_action:${approvalRequest.id}`}
    `;
    assert.deepEqual([...grants], [
      { source: `ai_action:${approvalRequest.id}`, access_active: true },
    ]);

    const actionsAfterGrant = await listAvailableAiAgentActionsForMember({
      organizationId,
      memberId: approveMember.id,
      agentId: identity.agentId,
    });
    assert.equal(
      actionsAfterGrant.find(
        (action) => action.actionType === "course_unenrollment",
      )?.state,
      "available",
    );
    const revocationRequest = await createAiAgentActionRequest({
      organizationId,
      actor: {
        kind: "user",
        id: approveMember.id,
        userId: approveMember.id,
      },
      request: {
        agentId: identity.agentId,
        actionConfigurationId: unenrollmentAction.id,
        memberId: approveMember.id,
      },
    });
    const revoked = await decideAiAgentActionRequest({
      organizationId,
      actorId: owner.id,
      actor: { kind: "user", id: owner.id, userId: owner.id },
      requestId: revocationRequest.request.id,
      decision: { decision: "approve", expectedRevision: 1 },
    });
    assert.equal(revoked.actionType, "course_unenrollment");
    assert.equal(revoked.status, "approved");
    const [accessAfterRevocation] = await sql<
      Array<{ access_active: boolean; direct_grants: number }>
    >`
      select enrollment.access_active,
             (
               select count(*)::int
               from course_access_grants access_grant
               where access_grant.organization_id = ${organizationId}
                 and access_grant.user_id = ${approveMember.id}
                 and access_grant.course_id = ${course!.id}
                 and (
                   access_grant.source like 'direct:%'
                   or access_grant.source like 'ai_action:%'
                 )
             ) as direct_grants
      from enrollments enrollment
      where enrollment.user_id = ${approveMember.id}
        and enrollment.course_id = ${course!.id}
    `;
    assert.deepEqual(accessAfterRevocation, {
      access_active: false,
      direct_grants: 0,
    });
    const actionsAfterRevocation = await listAvailableAiAgentActionsForMember({
      organizationId,
      memberId: approveMember.id,
      agentId: identity.agentId,
    });
    assert.equal(
      actionsAfterRevocation.find(
        (action) => action.actionType === "course_unenrollment",
      )?.state,
      "completed",
    );

    const groupGrantRequest = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: approveMember.id, userId: approveMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId: groupAssignmentAction.id,
        memberId: approveMember.id,
      },
    });
    const concurrentGroupDecisions = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        decideAiAgentActionRequest({
          organizationId,
          actorId: owner.id,
          actor: { kind: "user", id: owner.id, userId: owner.id },
          requestId: groupGrantRequest.request.id,
          decision: { decision: "approve", expectedRevision: 1 },
        }),
      ),
    );
    assert.equal(
      concurrentGroupDecisions.filter((result) => result.status === "fulfilled")
        .length,
      1,
    );
    assert.equal(
      concurrentGroupDecisions.filter((result) => result.status === "rejected")
        .length,
      1,
    );
    const [groupGrant] = await sql<
      Array<{ membership_count: number; provenance_count: number }>
    >`
      select
        (select count(*)::int from group_members
          where group_id = ${group!.id} and user_id = ${approveMember.id}) as membership_count,
        (select count(*)::int from ai_agent_membership_provenance
          where organization_id = ${organizationId}
            and member_id = ${approveMember.id}
            and target_group_id = ${group!.id}
            and grant_request_id = ${groupGrantRequest.request.id}
            and revoked_at is null) as provenance_count
    `;
    assert.deepEqual(groupGrant, { membership_count: 1, provenance_count: 1 });
    const groupRevokeRequest = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: approveMember.id, userId: approveMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId: groupRemovalAction.id,
        memberId: approveMember.id,
      },
    });
    await decideAiAgentActionRequest({
      organizationId,
      actorId: owner.id,
      actor: { kind: "user", id: owner.id, userId: owner.id },
      requestId: groupRevokeRequest.request.id,
      decision: { decision: "approve", expectedRevision: 1 },
    });
    const [groupRevoked] = await sql<
      Array<{
        membership_count: number;
        revocation_reason: string;
        revoked_by_request_id: string;
      }>
    >`
      select
        (select count(*)::int from group_members
          where group_id = ${group!.id} and user_id = ${approveMember.id}) as membership_count,
        provenance.revocation_reason,
        provenance.revoked_by_request_id
      from ai_agent_membership_provenance provenance
      where provenance.grant_request_id = ${groupGrantRequest.request.id}
    `;
    assert.deepEqual(groupRevoked, {
      membership_count: 0,
      revocation_reason: "ai_action",
      revoked_by_request_id: groupRevokeRequest.request.id,
    });

    const directRemovalGrant = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: cancelMember.id, userId: cancelMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId: groupAssignmentAction.id,
        memberId: cancelMember.id,
      },
    });
    await decideAiAgentActionRequest({
      organizationId,
      actorId: owner.id,
      actor: { kind: "user", id: owner.id, userId: owner.id },
      requestId: directRemovalGrant.request.id,
      decision: { decision: "approve", expectedRevision: 1 },
    });
    await sql`
      delete from group_members
      where group_id = ${group!.id} and user_id = ${cancelMember.id}
    `;
    const [directRemovalProvenance] = await sql<
      Array<{ reason: string; revoked_by_request_id: string | null }>
    >`
      select revocation_reason as reason, revoked_by_request_id
      from ai_agent_membership_provenance
      where grant_request_id = ${directRemovalGrant.request.id}
    `;
    assert.deepEqual(directRemovalProvenance, {
      reason: "manual_removal",
      revoked_by_request_id: null,
    });

    await sql`
      insert into group_members (group_id, user_id)
      values (${group!.id}, ${rejectMember.id})
    `;
    await assert.rejects(
      createAiAgentActionRequest({
        organizationId,
        actor: { kind: "user", id: rejectMember.id, userId: rejectMember.id },
        request: {
          agentId: identity.agentId,
          actionConfigurationId: groupRemovalAction.id,
          memberId: rejectMember.id,
        },
      }),
      apiError(409, "conflict"),
    );

    const bundleGrantRequest = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: approveMember.id, userId: approveMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId: bundleAssignmentAction.id,
        memberId: approveMember.id,
      },
    });
    await decideAiAgentActionRequest({
      organizationId,
      actorId: owner.id,
      actor: { kind: "user", id: owner.id, userId: owner.id },
      requestId: bundleGrantRequest.request.id,
      decision: { decision: "approve", expectedRevision: 1 },
    });
    await sql`
      insert into member_bundles (user_id, bundle_id)
      values (${approveMember.id}, ${bundle!.id})
      on conflict do nothing
    `;
    await assert.rejects(
      createAiAgentActionRequest({
        organizationId,
        actor: { kind: "user", id: approveMember.id, userId: approveMember.id },
        request: {
          agentId: identity.agentId,
          actionConfigurationId: bundleRemovalAction.id,
          memberId: approveMember.id,
        },
      }),
      apiError(409, "conflict"),
    );
    const [manualTakeover] = await sql<
      Array<{
        assignment_count: number;
        revocation_reason: string;
        revoked_by_request_id: string | null;
      }>
    >`
      select
        (select count(*)::int from member_bundles
          where bundle_id = ${bundle!.id} and user_id = ${approveMember.id}) as assignment_count,
        provenance.revocation_reason,
        provenance.revoked_by_request_id
      from ai_agent_membership_provenance provenance
      where provenance.grant_request_id = ${bundleGrantRequest.request.id}
    `;
    assert.deepEqual(manualTakeover, {
      assignment_count: 1,
      revocation_reason: "manual_takeover",
      revoked_by_request_id: null,
    });

    const rejection = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: rejectMember.id, userId: rejectMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId,
        memberId: rejectMember.id,
      },
    });
    const rejected = await decideAiAgentActionRequest({
      organizationId,
      actorId: owner.id,
      actor: { kind: "user", id: owner.id, userId: owner.id },
      requestId: rejection.request.id,
      decision: {
        decision: "reject",
        expectedRevision: 1,
        note: "Voraussetzungen fehlen.",
      },
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.executedAt, null);

    const cancellation = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: cancelMember.id, userId: cancelMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId,
        memberId: cancelMember.id,
      },
    });
    await assert.rejects(
      decideAiAgentActionRequest({
        organizationId: foreignOrganizationId,
        actorId: foreignOwner.id,
        actor: {
          kind: "user",
          id: foreignOwner.id,
          userId: foreignOwner.id,
        },
        requestId: cancellation.request.id,
        decision: { decision: "approve", expectedRevision: 1 },
      }),
      apiError(404, "not_found"),
    );
    const cancelled = await cancelAiAgentActionRequest({
      organizationId,
      memberId: cancelMember.id,
      actor: { kind: "user", id: cancelMember.id, userId: cancelMember.id },
      requestId: cancellation.request.id,
      cancellation: { expectedRevision: 1 },
    });
    assert.equal(cancelled.status, "cancelled");

    const policyBlocked = await createAiAgentActionRequest({
      organizationId,
      actor: { kind: "user", id: cancelMember.id, userId: cancelMember.id },
      request: {
        agentId: identity.agentId,
        actionConfigurationId,
        memberId: cancelMember.id,
      },
    });
    await updateAiAgentPolicy({
      actor,
      policy: {
        enabled: false,
        monthlyCreditLimit: 10_000,
        perMemberHourlyLimit: 60,
      },
    });
    await assert.rejects(
      createAiAgentActionRequest({
        organizationId,
        actor: { kind: "user", id: rejectMember.id, userId: rejectMember.id },
        request: {
          agentId: identity.agentId,
          actionConfigurationId,
          memberId: rejectMember.id,
        },
      }),
      apiError(403, "forbidden"),
    );
    await assert.rejects(
      decideAiAgentActionRequest({
        organizationId,
        actorId: owner.id,
        actor: { kind: "user", id: owner.id, userId: owner.id },
        requestId: policyBlocked.request.id,
        decision: { decision: "approve", expectedRevision: 1 },
      }),
      apiError(403, "forbidden"),
    );
    const [stillPending] = await sql<Array<{ status: string; revision: number }>>`
      select status, revision from ai_agent_action_requests
      where id = ${policyBlocked.request.id}
    `;
    assert.deepEqual(stillPending, { status: "pending", revision: 1 });
    await cancelAiAgentActionRequest({
      organizationId,
      memberId: cancelMember.id,
      actor: { kind: "user", id: cancelMember.id, userId: cancelMember.id },
      requestId: policyBlocked.request.id,
      cancellation: { expectedRevision: 1 },
    });

    const eventRows = await sql<Array<{ event: string; revision: number }>>`
      select event, revision
      from ai_agent_action_events
      where request_id = ${approvalRequest.id}
      order by revision
    `;
    assert.deepEqual([...eventRows], [
      { event: "requested", revision: 1 },
      { event: "approved", revision: 2 },
    ]);
    assert.deepEqual(
      (await listAiAgentActionEvents({
        organizationId,
        requestId: approvalRequest.id,
      })).map(({ event, fromStatus, toStatus, revision }) => ({
        event,
        fromStatus,
        toStatus,
        revision,
      })),
      [
        {
          event: "requested",
          fromStatus: null,
          toStatus: "pending",
          revision: 1,
        },
        {
          event: "approved",
          fromStatus: "pending",
          toStatus: "approved",
          revision: 2,
        },
      ],
    );
    await assert.rejects(
      sql`
        update ai_agent_action_requests
        set label_snapshot = 'Manipulated', revision = revision + 1
        where id = ${approvalRequest.id}
      `,
      /may only transition once from pending/,
    );
    await assert.rejects(
      sql`
        update ai_agent_action_events
        set event = 'rewritten'
        where request_id = ${approvalRequest.id} and revision = 2
      `,
      /append-only/,
    );
  },
);
