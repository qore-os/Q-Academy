import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import postgres, { type Sql } from "postgres";
import {
  sanitizeAiMessageCitations,
  sanitizeAssessmentSnapshot,
  sanitizeExportMetadata,
  sanitizePrivacyEventMetadata,
} from "../scripts/export-user-data";
import { ensureCommunityAreaFixture } from "./helpers/community-area";

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const tsxCli = path.join(
  process.cwd(),
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

type ExportFixture = {
  announcementInteractionOccurredAt: string;
  announcementInteractionSecret: string;
  announcementTitle: string;
  announcementId: string;
  directBundleName: string;
  communityBoostReason: string;
  communityBoostSecret: string;
  communityRichTextUnsafeHref: string;
  email: string;
  groupBundleName: string;
  internalAgentSourceId: string;
  mediaFileNames: string[];
  mutableAgentName: string;
  oidcAllowedDomain: string;
  oidcClientIdMarker: string;
  oidcClientSecretMarker: string;
  oidcDisplayName: string;
  oidcEmailAtLink: string;
  oidcIssuer: string;
  oidcOtherMarker: string;
  oidcSubject: string;
  oidcTargetMarker: string;
  otherAnnouncementMarker: string;
  otherMarker: string;
  otherOrganizationSlug: string;
  privacyClientRequestId: string;
  reportAboutConfidentialDetails: string;
  reportMadeDetails: string;
  restrictedSpaceSecret: string;
  secretMarkers: string[];
  targetApiKeyId: string;
  targetAgentVersionId: string;
  targetAgentVersionName: string;
  targetCourseTitle: string;
  targetGroupName: string;
  targetMarker: string;
  targetOrganizationId: string;
  targetOrganizationSlug: string;
  targetPeerId: string;
  targetUserId: string;
  targetPhone: string;
  webhookDeliveryId: string;
};

async function createVersionedAgentFixture(
  sql: Sql,
  input: {
    organizationId: string;
    createdById: string;
    legacyName: string;
    versionName: string;
    systemPrompt: string;
    source?: { id: string; title: string; content: string };
    grants?: {
      subjectUserIds?: string[];
      subjectGroupId?: string;
      subjectBundleId?: string;
      subjectRole?: "owner" | "admin" | "trainer" | "member";
    };
  },
) {
  const agentId = randomUUID();
  const publishedVersionId = randomUUID();
  const nextDraftVersionId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into ai_agents (
        id, organization_id, draft_version_id, published_version_id,
        name, description, system_prompt
      ) values (
        ${agentId}, ${input.organizationId}, ${publishedVersionId}, null,
        ${input.legacyName}, 'Mutable legacy agent shell', ${input.systemPrompt}
      )
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, type, name,
        description, system_prompt, knowledge_mode, access_mode,
        created_by_id
      ) values (
        ${publishedVersionId}, ${input.organizationId}, ${agentId}, 1,
        'draft', 'knowledge_assistant', ${input.versionName},
        'Immutable published fixture version', ${input.systemPrompt},
        ${input.source ? "selected_sources" : "all_accessible_courses"},
        ${input.grants ? "restricted" : "open"}, ${input.createdById}
      )
    `;
    if (input.source) {
      await tx`
        insert into ai_agent_version_sources (
          id, organization_id, agent_version_id, source_type, title, content
        ) values (
          ${input.source.id}, ${input.organizationId}, ${publishedVersionId},
          'manual_text', ${input.source.title}, ${input.source.content}
        )
      `;
    }
    for (const subjectUserId of input.grants?.subjectUserIds ?? []) {
      await tx`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_user_id
        ) values (
          ${input.organizationId}, ${publishedVersionId}, 'user',
          ${subjectUserId}
        )
      `;
    }
    if (input.grants?.subjectRole) {
      await tx`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_role
        ) values (
          ${input.organizationId}, ${publishedVersionId}, 'role',
          ${input.grants.subjectRole}
        )
      `;
    }
    if (input.grants?.subjectGroupId) {
      await tx`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_group_id
        ) values (
          ${input.organizationId}, ${publishedVersionId}, 'group',
          ${input.grants.subjectGroupId}
        )
      `;
    }
    if (input.grants?.subjectBundleId) {
      await tx`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_bundle_id
        ) values (
          ${input.organizationId}, ${publishedVersionId}, 'bundle',
          ${input.grants.subjectBundleId}
        )
      `;
    }
    await tx`
      update ai_agent_versions
      set state = 'published', published_at = now(), updated_at = now()
      where id = ${publishedVersionId} and state = 'draft'
    `;
    await tx`
      insert into ai_agent_versions (
        id, organization_id, agent_id, version, state, type, name,
        description, system_prompt, knowledge_mode, access_mode,
        created_by_id
      ) values (
        ${nextDraftVersionId}, ${input.organizationId}, ${agentId}, 2,
        'draft', 'knowledge_assistant', ${input.versionName},
        'Safe next draft metadata', ${input.systemPrompt},
        ${input.source ? "selected_sources" : "all_accessible_courses"},
        ${input.grants ? "restricted" : "open"}, ${input.createdById}
      )
    `;
    if (input.source) {
      await tx`
        insert into ai_agent_version_sources (
          organization_id, agent_version_id, source_type, course_id,
          course_version_id, media_asset_id, title, content, sort_order
        )
        select organization_id, ${nextDraftVersionId}, source_type, course_id,
               course_version_id, media_asset_id, title, content, sort_order
        from ai_agent_version_sources
        where agent_version_id = ${publishedVersionId}
      `;
    }
    if (input.grants) {
      await tx`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_role,
          subject_user_id, subject_group_id, subject_bundle_id
        )
        select organization_id, ${nextDraftVersionId}, subject_type,
               subject_role, subject_user_id, subject_group_id,
               subject_bundle_id
        from ai_agent_version_access_grants
        where agent_version_id = ${publishedVersionId}
      `;
    }
    await tx`
      update ai_agents
      set published_version_id = ${publishedVersionId},
          draft_version_id = ${nextDraftVersionId}
      where id = ${agentId} and organization_id = ${input.organizationId}
    `;
  });
  return { agentId, publishedVersionId, nextDraftVersionId };
}

async function createFixture(sql: Sql): Promise<ExportFixture> {
  const suffix = randomUUID().replaceAll("-", "");
  const short = suffix.slice(0, 12);
  const targetOrganizationSlug = `dsar-target-${short}`;
  const otherOrganizationSlug = `dsar-other-${short}`;
  const email = `subject-${short}@example.test`;
  const targetMarker = `TARGET-DATA-${suffix}`;
  const otherMarker = `OTHER-TENANT-DATA-${suffix}`;
  const announcementInteractionSecret = `ANNOUNCEMENT-INTERNAL-${suffix}`;
  const otherAnnouncementMarker = `OTHER-ANNOUNCEMENT-${suffix}`;
  const announcementInteractionOccurredAt = "2025-04-05T10:30:00.000Z";
  const oidcTargetMarker = `OIDC-TARGET-${suffix}`;
  const oidcOtherMarker = `OIDC-OTHER-${suffix}`;
  const oidcIssuer = `https://identity.example.test/${oidcTargetMarker}`;
  const oidcSubject = `subject-${oidcTargetMarker}`;
  const oidcEmailAtLink = `oidc-${short}@example.test`;
  const oidcDisplayName = `SSO ${oidcTargetMarker}`;
  const oidcAllowedDomain = `target-${short}.example.test`;
  const oidcClientIdMarker = `OIDC-CLIENT-ID-${suffix}`;
  const oidcClientSecretMarker = `OIDC-CLIENT-SECRET-${suffix}`;
  const passwordHash = `PASSWORD-HASH-${suffix}`;
  const sessionHash = `SESSION-JTI-${suffix}`;
  const invitationHash = `INVITATION-TOKEN-${suffix}`;
  const resetHash = `RESET-TOKEN-${suffix}`;
  const apiKeyHash = `API-KEY-HASH-${suffix}`;
  const apiKeyPrefix = `API-PREFIX-${short}`;
  const webhookSecret = `WEBHOOK-SECRET-${suffix}`;
  const webhookUrlSecret = `WEBHOOK-URL-SECRET-${suffix}`;
  const emailCiphertext = `EMAIL-CIPHERTEXT-${suffix}`;
  const agentPrompt = `AGENT-SYSTEM-PROMPT-${suffix}`;
  const agentSourceContent = `AGENT-SOURCE-CONTENT-${suffix}`;
  const mutableAgentName = `MUTABLE-AGENT-NAME-${suffix}`;
  const targetAgentVersionName = `Published target agent ${short}`;
  const systemMessage = `AI-SYSTEM-MESSAGE-${suffix}`;
  const metadataSecret = `ACTIVITY-METADATA-SECRET-${suffix}`;
  const environmentSecret = `DATA-ENCRYPTION-KEY-${suffix}`;
  const queryTokenSecret = `QUERY-TOKEN-${suffix}`;
  const signatureSecret = `SIGNATURE-${suffix}`;
  const credentialSecret = `CREDENTIAL-${suffix}`;
  const webhookPayloadSecret = `WEBHOOK-PAYLOAD-${suffix}`;
  const webhookResponseSecret = `WEBHOOK-RESPONSE-${suffix}`;
  const idempotencyKeySecret = `IDEMPOTENCY-KEY-${suffix}`;
  const idempotencyRequestHash = createHash("sha256")
    .update(`request-${suffix}`)
    .digest("hex");
  const idempotencyClaimToken = randomUUID();
  const idempotencyResponseSecret = `IDEMPOTENCY-RESPONSE-${suffix}`;
  const privacySubjectReference = createHash("sha256")
    .update(`subject-${suffix}`)
    .digest("hex");
  const privacyActorReference = createHash("sha256")
    .update(`actor-${suffix}`)
    .digest("hex");
  const privacyClaimToken = randomUUID();
  const privacyPolicySecret = `PRIVACY-POLICY-${suffix}`;
  const privacyHoldSecret = `PRIVACY-HOLD-${suffix}`;
  const privacyStorageSecret = `privacy-storage-${suffix}`;
  const privacyFailureSecret = `PRIVACY-FAILURE-${suffix}`;
  const communityBoostReason = `Relevant boost ${targetMarker}`;
  const communityBoostSecret = `qak_${suffix}`;

  const [targetOrganization] = await sql<Array<{ id: string }>>`
    insert into organizations (name, slug)
    values (${`DSAR target ${short}`}, ${targetOrganizationSlug})
    returning id
  `;
  const [otherOrganization] = await sql<Array<{ id: string }>>`
    insert into organizations (name, slug)
    values (${`DSAR other ${short}`}, ${otherOrganizationSlug})
    returning id
  `;
  const [targetUser] = await sql<Array<{ id: string }>>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name, phone
    ) values (
      ${targetOrganization.id}, ${email}, ${passwordHash}, 'Data', 'Subject',
      '+491701234567'
    )
    returning id
  `;
  await sql`
    insert into user_notification_preferences (
      organization_id, user_id, category, email_enabled, push_enabled
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, 'community', false, true
    )
  `;
  const [targetPeer] = await sql<Array<{ id: string }>>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${targetOrganization.id}, ${`peer-${short}@example.test`},
      ${`PEER-${passwordHash}`}, 'Peer', 'User'
    )
    returning id
  `;
  const [otherUser] = await sql<Array<{ id: string }>>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${otherOrganization.id}, ${email}, ${`OTHER-${passwordHash}`},
      'Other', 'Subject'
    )
    returning id
  `;
  const announcementTitle = `Relevant announcement ${targetMarker}`;
  const [announcement] = await sql<Array<{ id: string }>>`
    insert into announcements (
      organization_id, title, body, audience, created_by_id
    ) values (
      ${targetOrganization.id}, ${announcementTitle},
      ${announcementInteractionSecret}, 'all', ${targetPeer.id}
    )
    returning id
  `;
  const [otherAnnouncement] = await sql<Array<{ id: string }>>`
    insert into announcements (
      organization_id, title, body, audience, created_by_id
    ) values (
      ${otherOrganization.id}, ${otherAnnouncementMarker},
      ${`Internal ${otherAnnouncementMarker}`}, 'all', ${otherUser.id}
    )
    returning id
  `;
  await sql`
    insert into announcement_interactions (
      organization_id, announcement_id, user_id, kind, occurred_at
    ) values (
      ${targetOrganization.id}, ${announcement.id}, ${targetUser.id},
      'click', ${announcementInteractionOccurredAt}
    ), (
      ${otherOrganization.id}, ${otherAnnouncement.id}, ${otherUser.id},
      'impression', now()
    )
  `;
  await sql`
    insert into oidc_configurations (
      organization_id, enabled, display_name, issuer, client_id,
      client_secret_encrypted, auto_provision_members,
      allowed_email_domains, password_login_enabled, version
    ) values (
      ${targetOrganization.id}, false, ${oidcDisplayName},
      ${oidcIssuer}, ${oidcClientIdMarker},
      ${sql.json({
        v: "2",
        kid: "fixture-key",
        iv: "fixture-iv",
        tag: "fixture-tag",
        ciphertext: oidcClientSecretMarker,
      })},
      true, ${sql.json([oidcAllowedDomain])}, true, 7
    ), (
      ${otherOrganization.id}, false, ${`SSO ${oidcOtherMarker}`},
      ${`https://identity.example.test/${oidcOtherMarker}`},
      ${`CLIENT-ID-${oidcOtherMarker}`},
      ${sql.json({
        v: "2",
        kid: "other-fixture-key",
        iv: "other-fixture-iv",
        tag: "other-fixture-tag",
        ciphertext: `SECRET-${oidcOtherMarker}`,
      })},
      true, ${sql.json([`other-${short}.example.test`])}, true, 8
    )
  `;
  await sql`
    insert into oidc_identities (
      organization_id, user_id, issuer, subject, email_at_link,
      last_configuration_version
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, ${oidcIssuer},
      ${oidcSubject}, ${oidcEmailAtLink}, 7
    ), (
      ${otherOrganization.id}, ${otherUser.id},
      ${`https://identity.example.test/${oidcOtherMarker}`},
      ${`subject-${oidcOtherMarker}`}, ${email}, 8
    )
  `;

  const reportMadeDetails = `Own report details ${targetMarker}`;
  const reportAboutConfidentialDetails = `CONFIDENTIAL-REPORTER-${short}`;
  const restrictedSpaceSecret = `RESTRICTED-SPACE-${suffix}`;
  const communityRichTextUnsafeHref = `javascript:COMMUNITY-RICH-TEXT-${suffix}`;
  const area = await ensureCommunityAreaFixture(sql, targetOrganization.id);
  const [communitySpace] = await sql<Array<{ id: string }>>`
    insert into community_spaces (
      organization_id, area_id, title, slug, type, sort_order
    ) values (
      ${targetOrganization.id}, ${area.id}, 'DSAR reports',
      ${`dsar-reports-${short}`}, 'discussion', ${area.nextSpaceSortOrder}
    )
    returning id
  `;
  await sql`
    insert into community_spaces (
      organization_id, area_id, title, slug, type, access_mode, sort_order
    ) values (
      ${targetOrganization.id}, ${area.id}, ${restrictedSpaceSecret},
      ${`restricted-space-${short}`}, 'discussion', 'restricted',
      ${area.nextSpaceSortOrder + 1}
    )
  `;
  const [peerPost] = await sql<Array<{ id: string }>>`
    insert into posts (organization_id, space_id, author_id, title, content)
    values (
      ${targetOrganization.id}, ${communitySpace.id}, ${targetPeer.id},
      ${`Peer thread ${targetMarker}`},
      ${`Peer content ${targetMarker}`}
    )
    returning id
  `;
  const [subjectPost] = await sql<Array<{ id: string }>>`
    insert into posts (
      organization_id, space_id, author_id, title, content, content_format,
      rich_text, content_projection_version, locked
    )
    values (
      ${targetOrganization.id}, ${communitySpace.id}, ${targetUser.id},
      ${`Subject thread ${targetMarker}`},
      ${`Subject content @peer-${short} ${targetMarker}`}, 'rich_text',
      ${sql.json({
        version: 1,
        blocks: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: `Subject content ${targetMarker}`, bold: true },
              {
                type: "link",
                href: communityRichTextUnsafeHref,
                children: [{ type: "text", text: "unsafe link text" }],
              },
            ],
          },
        ],
      })}, 1, true
    )
    returning id
  `;
  const [rootComment] = await sql<Array<{ id: string }>>`
    insert into comments (organization_id, post_id, author_id, content)
    values (
      ${targetOrganization.id}, ${subjectPost.id}, ${targetPeer.id},
      'Peer root reply'
    )
    returning id
  `;
  const [subjectReply] = await sql<Array<{ id: string }>>`
    insert into comments (
      organization_id, post_id, author_id, parent_id, content,
      content_format, rich_text, content_projection_version
    )
    values (
      ${targetOrganization.id}, ${subjectPost.id}, ${targetUser.id},
      ${rootComment.id},
      ${`Subject nested reply ${targetMarker}`}, 'rich_text',
      ${sql.json({
        version: 1,
        blocks: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: `Subject nested reply ${targetMarker}` },
              {
                type: "link",
                href: communityRichTextUnsafeHref,
                children: [{ type: "text", text: "unsafe comment link" }],
              },
            ],
          },
        ],
      })}, 1
    )
    returning id
  `;
  await sql`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values (
      ${targetOrganization.id}, ${peerPost.id}, ${targetUser.id}, 'insightful'
    )
  `;
  await sql`
    insert into comment_reactions (
      organization_id, comment_id, post_id, user_id, reaction
    ) values (
      ${targetOrganization.id}, ${rootComment.id}, ${subjectPost.id},
      ${targetUser.id}, 'insightful'
    ), (
      ${targetOrganization.id}, ${subjectReply.id}, ${subjectPost.id},
      ${targetPeer.id}, 'celebrate'
    )
  `;
  await sql`
    insert into community_score_contributions (
      organization_id, recipient_id, actor_id, kind,
      post_id, comment_id, reaction_comment_id, points
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, ${targetPeer.id},
      'post_comment', null, ${rootComment.id}, null, 2
    ), (
      ${targetOrganization.id}, ${targetPeer.id}, ${targetUser.id},
      'comment_reply', null, ${subjectReply.id}, null, 1
    ), (
      ${targetOrganization.id}, ${targetUser.id}, ${targetPeer.id},
      'comment_reaction', null, null, ${subjectReply.id}, 1
    )
  `;
  await sql`
    insert into post_votes (organization_id, post_id, user_id, value)
    values (${targetOrganization.id}, ${peerPost.id}, ${targetUser.id}, 1)
  `;
  await sql`
    insert into community_mentions (
      organization_id, post_id, comment_id, mentioned_user_id,
      mentioned_by_id, handle
    ) values (
      ${targetOrganization.id}, ${subjectPost.id}, ${subjectReply.id},
      ${targetPeer.id}, ${targetUser.id}, ${`peer-${short}`}
    ), (
      ${targetOrganization.id}, ${peerPost.id}, null,
      ${targetUser.id}, ${targetPeer.id}, ${email.split("@")[0]}
    )
  `;
  await sql`
    insert into community_reports (
      organization_id, reporter_id, target_type, target_id,
      target_author_id, content_excerpt, reason, details, status,
      handled_by_id, outcome, resolution_note, resolved_at
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, 'post', ${peerPost.id},
      ${targetPeer.id}, ${`Peer content ${targetMarker}`}, 'spam',
      ${reportMadeDetails}, 'dismissed', ${targetPeer.id}, 'dismissed',
      'No policy violation found.', now()
    ), (
      ${targetOrganization.id}, ${targetPeer.id}, 'post', ${subjectPost.id},
      ${targetUser.id}, ${`Subject content ${targetMarker}`}, 'privacy',
      ${reportAboutConfidentialDetails}, 'resolved', ${targetPeer.id},
      'content_removed', 'Personal data was removed.', now()
    )
  `;
  await sql`
    insert into community_follows (
      organization_id, follower_id, target_type, target_author_id,
      target_space_id, notify
    ) values
      (${targetOrganization.id}, ${targetUser.id}, 'author', ${targetPeer.id},
        null, false),
      (${targetOrganization.id}, ${targetUser.id}, 'space', null,
        ${communitySpace.id}, false),
      (${targetOrganization.id}, ${targetPeer.id}, 'author', ${targetUser.id},
        null, false)
  `;
  await sql`
    insert into community_author_boosts (
      organization_id, author_id, strength, starts_at, ends_at, reason,
      created_by_id
    ) values
      (${targetOrganization.id}, ${targetUser.id}, 'medium',
        now() - interval '1 day', now() + interval '30 days',
        ${communityBoostReason}, ${targetPeer.id}),
      (${targetOrganization.id}, ${targetPeer.id}, 'light',
        now() - interval '1 day', now() + interval '30 days',
        ${communityBoostSecret}, ${targetUser.id})
  `;

  const targetGroupName = `Target group ${targetMarker}`;
  const [targetGroup] = await sql<Array<{ id: string }>>`
    insert into groups (organization_id, name)
    values (${targetOrganization.id}, ${targetGroupName})
    returning id
  `;
  const [otherGroup] = await sql<Array<{ id: string }>>`
    insert into groups (organization_id, name)
    values (${otherOrganization.id}, ${`Other group ${otherMarker}`})
    returning id
  `;
  await sql`
    insert into group_members (group_id, user_id)
    values
      (${targetGroup.id}, ${targetUser.id}),
      (${otherGroup.id}, ${otherUser.id})
  `;

  const targetCourseTitle = `Target course ${targetMarker}`;
  const [targetCourse] = await sql<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${targetOrganization.id}, ${targetCourseTitle}, ${`target-${short}`},
      'Target course', 'Target course'
    )
    returning id
  `;
  const [otherCourse] = await sql<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${otherOrganization.id}, ${`Other course ${otherMarker}`},
      ${`other-${short}`}, 'Other course', 'Other course'
    )
    returning id
  `;
  await sql`
    insert into enrollments (user_id, course_id, status, progress)
    values
      (${targetUser.id}, ${targetCourse.id}, 'in_progress', 25),
      (${targetUser.id}, ${otherCourse.id}, 'in_progress', 75),
      (${otherUser.id}, ${otherCourse.id}, 'completed', 100)
  `;

  const directBundleName = `Direct bundle ${targetMarker}`;
  const groupBundleName = `Group bundle ${targetMarker}`;
  const [directBundle] = await sql<Array<{ id: string }>>`
    insert into bundles (organization_id, name)
    values (${targetOrganization.id}, ${directBundleName})
    returning id
  `;
  const [groupBundle] = await sql<Array<{ id: string }>>`
    insert into bundles (organization_id, name)
    values (${targetOrganization.id}, ${groupBundleName})
    returning id
  `;
  await sql`
    insert into member_bundles (user_id, bundle_id)
    values (${targetUser.id}, ${directBundle.id})
  `;
  await sql`
    insert into group_courses (group_id, course_id)
    values (${targetGroup.id}, ${targetCourse.id})
  `;
  await sql`
    insert into group_bundles (group_id, bundle_id)
    values (${targetGroup.id}, ${groupBundle.id})
  `;
  await sql`
    insert into bundle_courses (
      bundle_id, course_id, available_from, available_until, delay_days, visible
    )
    values
      (
        ${directBundle.id}, ${targetCourse.id},
        '2027-01-15T09:00:00Z', '2027-03-15T09:00:00Z', 3, false
      ),
      (${groupBundle.id}, ${targetCourse.id}, null, null, 5, true)
  `;

  const [targetModule] = await sql<Array<{ id: string }>>`
    insert into modules (organization_id, title, description)
    values (
      ${targetOrganization.id}, 'DSAR assessment module',
      'DSAR assessment module'
    )
    returning id
  `;
  await sql`
    insert into course_modules (organization_id, course_id, module_id)
    values (${targetOrganization.id}, ${targetCourse.id}, ${targetModule.id})
  `;
  const [targetLesson] = await sql<Array<{ id: string }>>`
    insert into lessons (organization_id, module_id, title, slug, type)
    values (
      ${targetOrganization.id}, ${targetModule.id}, 'DSAR assessment',
      ${`dsar-assessment-${short}`}, 'quiz'
    )
    returning id
  `;
  const assessmentBlockId = randomUUID();
  const [assessmentAttempt] = await sql<Array<{ id: string }>>`
    insert into assessment_attempts (
      organization_id, user_id, course_id, lesson_id, attempt_number,
      status, score, passed, question_count, correct_count,
      assessment_snapshot, submitted_at, graded_at
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, ${targetCourse.id},
      ${targetLesson.id}, 1, 'graded', 100, true, 1, 1,
      ${sql.json({
        schemaVersion: 2,
        passingScore: 80,
        maxAttempts: 3,
        shuffleQuestions: false,
        questions: [
          {
            blockId: assessmentBlockId,
            type: "multiple_choice",
            title: "DSAR question",
            prompt: "Choose",
            options: ["A", "B"],
            correctOption: 1,
            correctOptions: [1],
            acceptedAnswers: ["secret answer"],
            correctOrder: [1, 0],
            presentationOrder: [0, 1],
            required: true,
            feedback: "secret feedback",
            nested: { Correct_Option: 1 },
          },
        ],
      })},
      now(), now()
    )
    returning id
  `;
  await sql`
    insert into assessment_answers (
      organization_id, attempt_id, block_id, question_snapshot,
      selected_option, answer_snapshot, correct
    ) values (
      ${targetOrganization.id}, ${assessmentAttempt.id}, ${assessmentBlockId},
      ${sql.json({
        blockId: assessmentBlockId,
        type: "multiple_choice",
        title: "DSAR question",
        prompt: "Choose",
        options: ["A", "B"],
        correctOption: 1,
        correctOptions: [1],
        acceptedAnswers: ["secret answer"],
        correctOrder: [1, 0],
        presentationOrder: [0, 1],
        required: true,
        feedback: "secret feedback",
        nested: { correctOption: 1 },
      })},
      1, ${sql.json({ selectedOption: 1, optionText: "B" })}, true
    )
  `;

  const ownerMediaId = randomUUID();
  const uploadedMediaId = randomUUID();
  const mediaFileNames = [`owned-${short}.png`, `uploaded-${short}.png`];
  await sql`
    insert into media_assets (
      id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
      status, storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      declared_size_bytes, quota_bytes, upload_expires_at
    ) values (
      ${ownerMediaId}, ${targetOrganization.id}, ${targetPeer.id},
      ${targetUser.id}, 'course_content', 'image', 'pending', 'filesystem',
      ${`tenants/${targetOrganization.id}/assets/${ownerMediaId}/owned.png`},
      ${`incoming/tenants/${targetOrganization.id}/assets/${ownerMediaId}/owned.png`},
      ${mediaFileNames[0]}, 'owned.png', 'image/png', 100, 100,
      now() + interval '1 hour'
    ), (
      ${uploadedMediaId}, ${targetOrganization.id}, ${targetUser.id},
      ${targetPeer.id}, 'course_content', 'image', 'pending', 'filesystem',
      ${`tenants/${targetOrganization.id}/assets/${uploadedMediaId}/uploaded.png`},
      ${`incoming/tenants/${targetOrganization.id}/assets/${uploadedMediaId}/uploaded.png`},
      ${mediaFileNames[1]}, 'uploaded.png', 'image/png', 100, 100,
      now() + interval '1 hour'
    )
  `;
  await sql`
    insert into course_media_assets (
      organization_id, course_id, media_asset_id, attached_by_id
    ) values
      (${targetOrganization.id}, ${targetCourse.id}, ${ownerMediaId}, ${targetPeer.id}),
      (${targetOrganization.id}, ${targetCourse.id}, ${uploadedMediaId}, ${targetPeer.id})
  `;

  const internalAgentSourceId = randomUUID();
  const targetAgent = await createVersionedAgentFixture(sql, {
    organizationId: targetOrganization.id,
    createdById: targetUser.id,
    legacyName: `Target agent shell ${short}`,
    versionName: targetAgentVersionName,
    systemPrompt: agentPrompt,
    source: {
      id: internalAgentSourceId,
      title: `Internal source ${short}`,
      content: agentSourceContent,
    },
    grants: {
      subjectUserIds: [targetUser.id, targetPeer.id],
      subjectGroupId: targetGroup.id,
      subjectBundleId: directBundle.id,
      subjectRole: "member",
    },
  });
  const otherAgent = await createVersionedAgentFixture(sql, {
    organizationId: otherOrganization.id,
    createdById: otherUser.id,
    legacyName: `Other agent shell ${short}`,
    versionName: `Other agent version ${otherMarker}`,
    systemPrompt: otherMarker,
  });
  const [targetConversation] = await sql<Array<{ id: string }>>`
    insert into ai_conversations (
      organization_id, agent_id, agent_version_id, user_id, title,
      message_count
    ) values (
      ${targetOrganization.id}, ${targetAgent.agentId},
      ${targetAgent.publishedVersionId}, ${targetUser.id},
      'Target conversation', 3
    )
    returning id
  `;
  const [otherConversation] = await sql<Array<{ id: string }>>`
    insert into ai_conversations (
      organization_id, agent_id, agent_version_id, user_id, title,
      message_count
    ) values (
      ${otherOrganization.id}, ${otherAgent.agentId},
      ${otherAgent.publishedVersionId}, ${otherUser.id}, ${otherMarker}, 1
    )
    returning id
  `;
  await sql`
    insert into ai_messages (
      organization_id, conversation_id, role, content, citations, tool_calls,
      metadata
    )
    values
      (${targetOrganization.id}, ${targetConversation.id}, 'user',
       ${targetMarker}, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb),
      (${targetOrganization.id}, ${targetConversation.id}, 'assistant',
       ${`Assistant ${targetMarker}`}, ${sql.json([
         {
           title: `Internal source ${short}`,
           href: `/academy/ai?safe=${targetMarker}&access_token=${queryTokenSecret}`,
           courseId: `agent-source:${internalAgentSourceId}`,
           lessonId: `agent-source:${internalAgentSourceId}`,
           excerpt: agentSourceContent,
         },
         {
           title: "Safe course citation",
           href: `/academy/course?safe=${targetMarker}&sig=${signatureSecret}`,
           courseId: targetCourse.id,
           lessonId: randomUUID(),
           excerpt: `Safe citation ${targetMarker}`,
           providerSecret: agentPrompt,
         },
       ])}, ${sql.json([
         { sourceId: internalAgentSourceId, content: agentSourceContent },
       ])}, ${sql.json({
         grounding: {
           sourceIds: [`agent-source:${internalAgentSourceId}`],
           sourceContent: agentSourceContent,
         },
       })}),
      (${targetOrganization.id}, ${targetConversation.id}, 'system',
       ${systemMessage}, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb),
      (${otherOrganization.id}, ${otherConversation.id}, 'user',
       ${otherMarker}, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)
  `;
  await sql`
    update ai_agents set name = ${mutableAgentName}
    where id = ${targetAgent.agentId}
      and organization_id = ${targetOrganization.id}
  `;

  await sql`
    insert into activity_events (
      organization_id, user_id, type, metadata
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, 'dsar.target',
      ${sql.json({
        safeMarker: targetMarker,
        webhookSecret: metadataSecret,
        clientCredential: credentialSecret,
        nested: {
          xSignature: signatureSecret,
          callbackUrl: `https://example.test/callback?safe=${targetMarker}&access_token=${queryTokenSecret}#access_token=${queryTokenSecret}`,
        },
      })}
    ), (
      ${otherOrganization.id}, ${otherUser.id}, 'dsar.other',
      ${sql.json({ safeMarker: otherMarker })}
    )
  `;
  await sql`
    insert into user_sessions (organization_id, user_id, jti_hash, expires_at)
    values (
      ${targetOrganization.id}, ${targetUser.id}, ${sessionHash},
      now() + interval '1 day'
    )
  `;
  await sql`
    insert into invitations (
      organization_id, user_id, email, token_hash, expires_at
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, ${email}, ${invitationHash},
      now() + interval '1 day'
    )
  `;
  await sql`
    insert into password_reset_tokens (user_id, token_hash, expires_at)
    values (${targetUser.id}, ${resetHash}, now() + interval '1 hour')
  `;
  const [targetApiKey] = await sql<Array<{ id: string }>>`
    insert into api_keys (
      organization_id, name, prefix, key_hash, scopes, created_by_id
    ) values (
      ${targetOrganization.id}, 'DSAR key', ${apiKeyPrefix}, ${apiKeyHash},
      array['*'], ${targetUser.id}
    )
    returning id
  `;
  const [targetWebhook] = await sql<Array<{ id: string }>>`
    insert into webhooks (
      organization_id, name, url, signing_secret_encrypted, events, created_by_id
    ) values (
      ${targetOrganization.id}, 'DSAR webhook',
      ${`https://example.test/hooks/${webhookUrlSecret}`}, ${webhookSecret},
      array['course.published'], ${targetUser.id}
    )
    returning id
  `;
  const [webhookDelivery] = await sql<Array<{ id: string }>>`
    insert into webhook_deliveries (
      organization_id, webhook_id, event, payload, status, attempt,
      response_status, response_body, duration_ms, delivered_at
    ) values (
      ${targetOrganization.id}, ${targetWebhook.id}, 'member.updated',
      ${sql.json({
        resource: { userId: targetUser.id },
        payloadSecret: webhookPayloadSecret,
      })},
      'delivered', 1, 200, ${webhookResponseSecret}, 25, now()
    )
    returning id
  `;
  await sql`
    insert into webhook_delivery_attempts (
      organization_id, delivery_id, webhook_id, replay_generation,
      attempt, outcome, response_status, response_body_redacted,
      duration_ms, started_at, completed_at
    ) values (
      ${targetOrganization.id}, ${webhookDelivery.id}, ${targetWebhook.id}, 0,
      1, 'delivered', 200, true, 25,
      now() - interval '25 milliseconds', now()
    )
  `;
  await sql`
    insert into api_idempotency_keys (
      organization_id, api_key_id, key, method, path, request_hash, status,
      claim_token, response_status, response_body, expires_at
    ) values (
      ${targetOrganization.id}, ${targetApiKey.id}, ${idempotencyKeySecret},
      'POST',
      ${`/api/v1/members?safe=${targetMarker}&access_token=${queryTokenSecret}`},
      ${idempotencyRequestHash}, 'completed', ${idempotencyClaimToken}, 201,
      ${sql.json({
        v: 1,
        alg: "A256GCM",
        iv: "idempotency-iv",
        tag: "idempotency-tag",
        ciphertext: idempotencyResponseSecret,
      })},
      now() + interval '1 day'
    )
  `;
  await sql`
    insert into api_audit_logs (
      organization_id, api_key_id, request_id, method, path, action,
      resource_type, resource_id, response_status, duration_ms, metadata
    ) values (
      ${targetOrganization.id}, ${targetApiKey.id}, ${randomUUID()}, 'POST',
      ${`/api/v1/members?safe=${targetMarker}&signature=${signatureSecret}`},
      'dsar.api.fixture', 'course', ${targetCourse.id}, 201, 15,
      ${sql.json({
        safeMarker: targetMarker,
        clientCredential: credentialSecret,
        callbackUrl: `https://example.test/result?safe=${targetMarker}&token=${queryTokenSecret}`,
      })}
    )
  `;
  await sql`
    insert into email_deliveries (
      organization_id, user_id, event, recipient_email, payload
    ) values (
      ${targetOrganization.id}, ${targetUser.id}, 'dsar.fixture', ${email},
      ${sql.json({
        v: 1,
        alg: "A256GCM",
        iv: "fixture-iv",
        tag: "fixture-tag",
        ciphertext: emailCiphertext,
      })}
    )
  `;

  const privacyRequestId = randomUUID();
  const privacyClientRequestId = `privacy-${suffix}`;
  await sql`
    insert into privacy_requests (
      id, organization_id, subject_user_id, subject_reference,
      requested_by_id, client_request_id, type, status, due_at,
      identity_verified_at, identity_verified_by_id, approved_at,
      approved_by_id, processing_started_at, policy_version,
      policy_snapshot, processing_attempt, processing_claim_token,
      processing_claimed_at, processing_lease_expires_at
    ) values (
      ${privacyRequestId}, ${targetOrganization.id}, ${targetUser.id},
      ${privacySubjectReference}, ${targetUser.id}, ${privacyClientRequestId},
      'access_export', 'processing', now() + interval '30 days', now(),
      ${targetUser.id}, now(), ${targetUser.id}, now(), 'fixture-v1',
      ${sql.json({ internalSecret: privacyPolicySecret })}, 1,
      ${privacyClaimToken}, now(), now() + interval '10 minutes'
    )
  `;
  await sql`
    insert into privacy_request_events (
      organization_id, request_id, actor_reference, event,
      from_status, to_status, metadata
    ) values (
      ${targetOrganization.id}, ${privacyRequestId}, ${privacyActorReference},
      'privacy.fixture', 'approved', 'processing',
      ${sql.json({
        type: "access_export",
        policyVersion: "fixture-v1",
        reason: privacyHoldSecret,
        failureCode: privacyFailureSecret,
        signingCredential: credentialSecret,
        resultUrl: `https://example.test/privacy?safe=${targetMarker}&sig=${signatureSecret}`,
      })}
    )
  `;
  await sql`
    insert into privacy_legal_holds (
      organization_id, request_id, subject_user_id, subject_reference,
      scope, reference, reason, legal_basis, created_by_id, expires_at
    ) values (
      ${targetOrganization.id}, ${privacyRequestId}, ${targetUser.id},
      ${privacySubjectReference}, 'audit', ${`hold-${suffix}`},
      ${privacyHoldSecret}, ${`LEGAL-${privacyHoldSecret}`},
      ${targetUser.id}, now() + interval '1 day'
    )
  `;
  await sql`
    insert into privacy_export_artifacts (
      organization_id, request_id, status, format, storage_driver,
      storage_key, safe_file_name, content_type, expires_at,
      failure_code, failure_detail
    ) values (
      ${targetOrganization.id}, ${privacyRequestId}, 'failed', 'json',
      'filesystem',
      ${`tenants/${targetOrganization.id}/privacy-exports/${privacyRequestId}/${privacyStorageSecret}.json`},
      'privacy-export.json', 'application/json', now() + interval '1 day',
      ${privacyFailureSecret}, ${`DETAIL-${privacyFailureSecret}`}
    )
  `;

  return {
    announcementId: announcement.id,
    announcementInteractionOccurredAt,
    announcementInteractionSecret,
    announcementTitle,
    communityBoostReason,
    communityBoostSecret,
    communityRichTextUnsafeHref,
    directBundleName,
    email,
    groupBundleName,
    internalAgentSourceId,
    mediaFileNames,
    mutableAgentName,
    oidcAllowedDomain,
    oidcClientIdMarker,
    oidcClientSecretMarker,
    oidcDisplayName,
    oidcEmailAtLink,
    oidcIssuer,
    oidcOtherMarker,
    oidcSubject,
    oidcTargetMarker,
    otherAnnouncementMarker,
    otherMarker,
    otherOrganizationSlug,
    privacyClientRequestId,
    reportAboutConfidentialDetails,
    reportMadeDetails,
    restrictedSpaceSecret,
    secretMarkers: [
      passwordHash,
      sessionHash,
      invitationHash,
      resetHash,
      apiKeyHash,
      apiKeyPrefix,
      webhookSecret,
      webhookUrlSecret,
      emailCiphertext,
      agentPrompt,
      agentSourceContent,
      mutableAgentName,
      systemMessage,
      metadataSecret,
      environmentSecret,
      queryTokenSecret,
      signatureSecret,
      credentialSecret,
      webhookPayloadSecret,
      webhookResponseSecret,
      idempotencyKeySecret,
      idempotencyRequestHash,
      idempotencyClaimToken,
      idempotencyResponseSecret,
      privacySubjectReference,
      privacyActorReference,
      privacyClaimToken,
      privacyPolicySecret,
      privacyHoldSecret,
      privacyStorageSecret,
      privacyFailureSecret,
      reportAboutConfidentialDetails,
      oidcClientIdMarker,
      oidcClientSecretMarker,
      communityBoostSecret,
      communityRichTextUnsafeHref,
    ],
    targetApiKeyId: targetApiKey.id,
    targetAgentVersionId: targetAgent.publishedVersionId,
    targetAgentVersionName,
    targetCourseTitle,
    targetGroupName,
    targetMarker,
    targetOrganizationId: targetOrganization.id,
    targetOrganizationSlug,
    targetPeerId: targetPeer.id,
    targetUserId: targetUser.id,
    targetPhone: "+491701234567",
    webhookDeliveryId: webhookDelivery.id,
  };
}

async function removeFixtureOrganizations(sql: Sql, organizationIds: string[]) {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`
      delete from privacy_request_events
      where organization_id = any(${organizationIds}::uuid[])
    `;
    await tx`
      delete from community_moderation_events
      where organization_id = any(${organizationIds}::uuid[])
    `;
    await tx.unsafe("set local session_replication_role = origin");
    await tx`
      delete from privacy_export_artifacts
      where organization_id = any(${organizationIds}::uuid[])
    `;
    await tx`
      delete from privacy_legal_holds
      where organization_id = any(${organizationIds}::uuid[])
    `;
    await tx`
      delete from privacy_requests
      where organization_id = any(${organizationIds}::uuid[])
    `;
    await tx`
      delete from organizations
      where id = any(${organizationIds}::uuid[])
    `;
  });
}

async function removeFixture(sql: Sql, fixture: ExportFixture) {
  const otherOrganizationIds = await sql<Array<{ id: string }>>`
    select id from organizations
    where slug = ${fixture.otherOrganizationSlug}
  `;
  await removeFixtureOrganizations(sql, [
    fixture.targetOrganizationId,
    ...otherOrganizationIds.map((row) => row.id),
  ]);
}

async function runExport(
  fixture: ExportFixture,
  output: string,
  subject: { organizationSlug?: string; email?: string } = {},
) {
  await mkdir(path.dirname(output), { recursive: true });
  return execFileAsync(
    process.execPath,
    [
      tsxCli,
      "scripts/export-user-data.ts",
      "--organization-slug",
      subject.organizationSlug ?? fixture.targetOrganizationSlug,
      "--user-email",
      subject.email ?? fixture.email,
      "--output",
      output,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATA_ENCRYPTION_KEY: fixture.secretMarkers.at(-1),
      },
      timeout: 45_000,
    },
  );
}

async function addCommunityModerationExportFixture(
  sql: Sql,
  fixture: ExportFixture,
) {
  const marker = `MODERATION-DSAR-${randomUUID()}`;
  const internalEventNote = `INTERNAL-EVENT-${randomUUID()}`;
  const assessmentSignal = `ASSESSMENT-SIGNAL-${randomUUID()}`;
  const appealStatement = `Eigener Widerspruch ${marker}`;
  const appealResolutionNote = `INTERNAL-APPEAL-NOTE-${randomUUID()}`;
  const [context] = await sql<Array<{ postId: string; spaceId: string }>>`
    select id as "postId", space_id as "spaceId"
    from posts
    where organization_id = ${fixture.targetOrganizationId}
      and author_id = ${fixture.targetUserId}
      and title = ${`Subject thread ${fixture.targetMarker}`}
    limit 1
  `;
  if (!context) throw new Error("DSAR community fixture is missing.");

  const hiddenPosts = await sql<Array<{ id: string; state: string }>>`
    insert into posts (
      organization_id, space_id, author_id, title, content,
      moderation_state, moderation_version, moderation_fingerprint,
      published_at, moderated_at, moderated_by_id
    ) values
      (${fixture.targetOrganizationId}, ${context.spaceId},
       ${fixture.targetUserId}, ${`${marker}-POST-PENDING`},
       ${`${marker}-POST-PENDING`}, 'pending', 2,
       ${createHash("sha256").update(`${marker}-post-pending`).digest("hex")},
       null, null, null),
      (${fixture.targetOrganizationId}, ${context.spaceId},
       ${fixture.targetUserId}, ${`${marker}-POST-HELD`},
       ${`${marker}-POST-HELD`}, 'held', 3,
       ${createHash("sha256").update(`${marker}-post-held`).digest("hex")},
       null, now() - interval '2 hours', ${fixture.targetPeerId}),
      (${fixture.targetOrganizationId}, ${context.spaceId},
       ${fixture.targetUserId}, ${`${marker}-POST-REJECTED`},
       ${`${marker}-POST-REJECTED`}, 'rejected', 4,
       ${createHash("sha256").update(`${marker}-post-rejected`).digest("hex")},
       null, now() - interval '1 hour', ${fixture.targetPeerId})
    returning id, moderation_state as state
  `;
  const heldPost = hiddenPosts.find((post) => post.state === "held");
  if (!heldPost) throw new Error("Held DSAR post fixture is missing.");

  await sql`
    insert into comments (
      organization_id, post_id, author_id, content,
      moderation_state, moderation_version, moderation_fingerprint,
      published_at, moderated_at, moderated_by_id
    ) values
      (${fixture.targetOrganizationId}, ${context.postId},
       ${fixture.targetUserId}, ${`${marker}-COMMENT-PENDING`}, 'pending', 2,
       ${createHash("sha256").update(`${marker}-comment-pending`).digest("hex")},
       null, null, null),
      (${fixture.targetOrganizationId}, ${context.postId},
       ${fixture.targetUserId}, ${`${marker}-COMMENT-HELD`}, 'held', 3,
       ${createHash("sha256").update(`${marker}-comment-held`).digest("hex")},
       null, now() - interval '2 hours', ${fixture.targetPeerId}),
      (${fixture.targetOrganizationId}, ${context.postId},
       ${fixture.targetUserId}, ${`${marker}-COMMENT-REJECTED`}, 'rejected', 4,
       ${createHash("sha256").update(`${marker}-comment-rejected`).digest("hex")},
       null, now() - interval '1 hour', ${fixture.targetPeerId})
  `;

  const [moderationCase] = await sql<Array<{ id: string }>>`
    insert into community_moderation_cases (
      organization_id, target_type, target_id, target_author_id,
      content_version, policy_version, reason, priority, status,
      claimed_by_id, claimed_at, resolved_by_id, resolved_at,
      decision_version
    ) values (
      ${fixture.targetOrganizationId}, 'post', ${heldPost.id},
      ${fixture.targetUserId}, 3, 1, 'manual', 87, 'appealed',
      ${fixture.targetPeerId}, now() - interval '3 hours',
      ${fixture.targetPeerId}, now() - interval '2 hours', 2
    ) returning id
  `;
  await sql`
    insert into community_moderation_events (
      organization_id, case_id, action, actor_id, reason_code,
      content_version, policy_version, decision_version, note
    ) values (
      ${fixture.targetOrganizationId}, ${moderationCase.id}, 'appealed',
      ${fixture.targetPeerId}, 'manual', 3, 1, 2, ${internalEventNote}
    )
  `;
  await sql`
    insert into community_moderation_assessments (
      organization_id, case_id, revision, policy_version,
      fingerprint, signals, outcome
    ) values (
      ${fixture.targetOrganizationId}, ${moderationCase.id}, 1, 1,
      ${createHash("sha256").update(assessmentSignal).digest("hex")},
      ${sql.json({ confidentialMarker: assessmentSignal, reportCount: 99 })},
      'held'
    )
  `;
  const [appeal] = await sql<Array<{ id: string }>>`
    insert into community_moderation_appeals (
      organization_id, case_id, appellant_id, statement,
      decision_version, resolution_action, resolved_by_id,
      resolved_at, resolution_note
    ) values (
      ${fixture.targetOrganizationId}, ${moderationCase.id},
      ${fixture.targetUserId}, ${appealStatement}, 2,
      'appeal_overturned', ${fixture.targetPeerId}, now(),
      ${appealResolutionNote}
    ) returning id
  `;

  return {
    marker,
    caseId: moderationCase.id,
    heldPostId: heldPost.id,
    appealId: appeal.id,
    appealStatement,
    internalMarkers: [
      internalEventNote,
      assessmentSignal,
      appealResolutionNote,
    ],
  };
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted DSAR database flow",
  );
});

test("DSAR sanitizers remove credential keys and signed URL material recursively", () => {
  const secret = `sanitizer-${randomUUID()}`;
  const privateKeyMarker = "-----BEGIN " + "PRIVATE KEY-----";
  const sanitized = sanitizeExportMetadata({
    safeMarker: "retained",
    tokenCount: 12,
    authorization: `Bearer ${secret}`,
    clientCredential: secret,
    nested: {
      xSignature: secret,
      callbackUrl: `https://user-${secret}:pass-${secret}@example.test/result?safe=retained&access_token=${secret}&X-Amz-Signature=${secret}#token=${secret}`,
      relativeUrl: `/result?safe=retained&sig=${secret}`,
      headerValue: `Bearer ${secret}`,
      privateMaterial: `${privateKeyMarker}\n${secret}\n-----END PRIVATE KEY-----`,
    },
  }) as {
    safeMarker: string;
    tokenCount: number;
    authorization?: string;
    clientCredential?: string;
    nested: {
      xSignature?: string;
      callbackUrl: string;
      relativeUrl: string;
      headerValue: string;
      privateMaterial: string;
    };
  };

  expect(sanitized.safeMarker).toBe("retained");
  expect(sanitized.tokenCount).toBe(12);
  expect(sanitized.authorization).toBeUndefined();
  expect(sanitized.clientCredential).toBeUndefined();
  expect(sanitized.nested.xSignature).toBeUndefined();
  expect(sanitized.nested.callbackUrl).toBe(
    "https://example.test/result?safe=retained",
  );
  expect(sanitized.nested.relativeUrl).toBe("/result?safe=retained");
  expect(sanitized.nested.headerValue).toBe("[redacted]");
  expect(sanitized.nested.privateMaterial).toBe("[redacted]");
  expect(JSON.stringify(sanitized)).not.toContain(secret);

  const assessment = sanitizeAssessmentSnapshot({
    schemaVersion: 2,
    questions: [
      {
        prompt: "Retained",
        correctOption: 1,
        correctOptions: [0, 2],
        acceptedAnswers: ["secret"],
        correctOrder: [2, 0, 1],
        presentationOrder: [1, 2, 0],
        feedback: "secret feedback",
        nested: {
          Correct_Option: 2,
          CORRECT_OPTIONS: [1],
          accepted_answers: ["secret"],
          correct_order: [1, 0],
          presentation_order: [0, 1],
          safe: true,
        },
      },
    ],
  });
  expect(assessment).toEqual({
    schemaVersion: 2,
    questions: [{ prompt: "Retained", nested: { safe: true } }],
  });
  expect(
    sanitizePrivacyEventMetadata({
      type: "access_export",
      policyVersion: "fixture-v1",
      reason: secret,
      reference: secret,
      failureCode: secret,
      arbitrary: { safeLookingSecret: secret },
    }),
  ).toEqual({ type: "access_export", policyVersion: "fixture-v1" });

  expect(
    sanitizeAiMessageCitations([
      {
        title: "Internal source",
        href: `/academy/ai?safe=retained&access_token=${secret}`,
        courseId: `agent-source:${secret}`,
        lessonId: `agent-source:${secret}`,
        excerpt: secret,
        providerSecret: secret,
      },
      {
        title: "Course citation",
        href: `/academy/course?safe=retained&sig=${secret}`,
        courseId: randomUUID(),
        lessonId: randomUUID(),
        excerpt: "Safe excerpt",
      },
    ]),
  ).toEqual([
    { title: "Internal source", href: "/academy/ai?safe=retained" },
    {
      title: "Course citation",
      href: "/academy/course?safe=retained",
      excerpt: "Safe excerpt",
    },
  ]);
});

test("DSAR export remains bound to the selected tenant", async ({}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let fixture: ExportFixture | null = null;
  try {
    fixture = await createFixture(sql);
    const output = testInfo.outputPath("tenant-bound-export.json");
    const result = await runExport(fixture, output, {
      organizationSlug: fixture.targetOrganizationSlug.toUpperCase(),
      email: fixture.email.toUpperCase(),
    });
    expect(result.stdout).toBe("");

    const raw = await readFile(output, "utf8");
    const exported = JSON.parse(raw) as {
      schemaVersion: number;
      exportManifest: {
        excludedFields: Array<{ path: string; reason: string }>;
      };
      organization: { slug: string };
      subject: { email: string; phone: string | null; communityPoints: number };
      data: {
        groups: Array<{ name: string }>;
        access: {
          groupCourseAssignments: Array<{ courseTitle: string }>;
          groupBundleAssignments: Array<{ bundleName: string }>;
          bundleCourseAssignments: Array<{
            bundleName: string;
            relationship: "direct" | "group";
            availableFrom: string | null;
            availableUntil: string | null;
            delayDays: number;
            visible: boolean;
          }>;
        };
        learning: {
          enrollments: Array<{ courseTitle: string }>;
          assessmentAttempts: Array<{ assessmentSnapshot: unknown }>;
          assessmentAnswers: Array<{ questionSnapshot: unknown }>;
          courseMediaBindings: Array<{
            originalFileName: string;
            ownedBySubject: boolean;
            uploadedBySubject: boolean;
          }>;
        };
        community: {
          posts: Array<{
            title: string | null;
            spaceType: string;
            areaId: string;
            areaTitle: string;
            locked: boolean;
            contentFormat: "plain_text" | "rich_text";
            richText: unknown;
            contentProjectionVersion: number;
            moderationState: string;
            publishedAt: string | null;
            moderatedAt: string | null;
          }>;
          comments: Array<{
            parentId: string | null;
            content: string;
            contentFormat: "plain_text" | "rich_text";
            richText: unknown;
            contentProjectionVersion: number;
            moderationState: string;
            publishedAt: string | null;
            moderatedAt: string | null;
          }>;
          likes: Array<{ reaction: string }>;
          commentReactions: {
            made: Array<{ reaction: string }>;
            receivedSummary: Array<{ reaction: string; count: number }>;
          };
          scoreContributions: Array<{
            kind: string;
            points: number;
            relationship: "received" | "generated";
            sourceType: string;
            sourceId: string;
          }>;
          votes: Array<{ value: number }>;
          follows: Array<{
            targetType: "author" | "space";
            targetAuthorId: string | null;
            targetSpaceId: string | null;
            notify: boolean;
          }>;
          followerSummary: { authorFollowerCount: number };
          authorBoosts: Array<{
            authorId: string;
            strength: "light" | "medium" | "high";
            reason: string;
            administeredBySubject: boolean;
          }>;
          mentionsMade: Array<{ handle: string }>;
          mentionsReceived: Array<{ handle: string }>;
          reportsMade: Array<Record<string, unknown> & { details?: string }>;
          reportsAbout: Array<Record<string, unknown>>;
          moderationCases: Array<Record<string, unknown>>;
          moderationAppeals: Array<Record<string, unknown>>;
        };
        notifications: {
          preferences: Array<{
            category: string;
            emailEnabled: boolean;
            pushEnabled: boolean;
          }>;
          announcementInteractions: Array<
            Record<string, unknown> & {
              announcementId: string;
              announcementTitle: string;
              kind: "impression" | "click" | "dismiss";
              occurredAt: string;
            }
          >;
        };
        ai: {
          conversations: Array<{
            agentVersionId: string;
            agentVersion: {
              name: string;
              type: string;
              version: number;
              publishedAt: string | null;
            };
            agentId?: string;
            agentName?: string;
            metadata?: unknown;
          }>;
          messages: Array<{
            content: string;
            citations: Array<{
              title?: string;
              href?: string;
              excerpt?: string;
              courseId?: string;
              lessonId?: string;
              pageId?: string;
              sourceId?: string;
            }>;
            toolCalls?: unknown;
            metadata?: unknown;
          }>;
          authoredAgentVersions: Array<{
            agentVersionId: string;
            name: string;
            type: string;
            version: number;
            publishedAt: string | null;
            systemPrompt?: string;
            description?: string;
            createdById?: string;
          }>;
          agentAccessGrants: Array<{
            agentVersionId: string;
            name: string;
            type: string;
            version: number;
            publishedAt: string;
            relationship: "direct_user" | "role" | "group" | "bundle";
            subjectUserId?: string;
            subjectGroupId?: string;
            subjectBundleId?: string;
            subjectRole?: string;
          }>;
        };
        integrations: {
          webhookDeliveryHistory: Array<{
            id: string;
            payload?: unknown;
            attempts: Array<{
              replayGeneration: number;
              attempt: number;
              outcome: string;
              responseBodyRedacted: boolean;
              durationMs: number;
            }>;
          }>;
          apiIdempotency: Array<{ path: string }>;
        };
        privacy: {
          requests: Array<{ clientRequestId: string }>;
          events: Array<{
            metadata: { type?: string; policyVersion?: string };
          }>;
          legalHolds: Array<Record<string, unknown>>;
          exportArtifacts: Array<Record<string, unknown>>;
        };
        audit: {
          activityEvents: Array<{
            metadata: {
              safeMarker?: string;
              webhookSecret?: string;
              nested?: { callbackUrl?: string };
            };
          }>;
          apiAuditLog: Array<{
            relationship: string;
            path: string;
            metadata: { safeMarker?: string; callbackUrl?: string };
          }>;
        };
        authenticationActivity: {
          oidcIdentities: Array<{
            issuer: string;
            subject: string;
            emailAtLink: string;
            lastConfigurationVersion: number | null;
            lastLoginAt: string;
            createdAt: string;
          }>;
          oidcConfigurationContext: {
            enabled: boolean;
            displayName: string;
            autoProvisionMembers: boolean;
            allowedEmailDomains: string[];
            passwordLoginEnabled: boolean;
            version: number;
            createdAt: string;
            updatedAt: string;
          } | null;
        };
      };
    };
    expect(exported.schemaVersion).toBe(23);
    expect(exported.organization.slug).toBe(fixture.targetOrganizationSlug);
    expect(exported.subject.email).toBe(fixture.email);
    expect(exported.subject.phone).toBe(fixture.targetPhone);
    expect(exported.subject.communityPoints).toBeGreaterThan(0);
    expect(exported.data.authenticationActivity.oidcIdentities).toEqual([
      {
        issuer: fixture.oidcIssuer,
        subject: fixture.oidcSubject,
        emailAtLink: fixture.oidcEmailAtLink,
        lastConfigurationVersion: 7,
        lastLoginAt: expect.any(String),
        createdAt: expect.any(String),
      },
    ]);
    expect(
      exported.data.authenticationActivity.oidcConfigurationContext,
    ).toEqual({
      enabled: false,
      displayName: fixture.oidcDisplayName,
      autoProvisionMembers: true,
      allowedEmailDomains: [fixture.oidcAllowedDomain],
      passwordLoginEnabled: true,
      version: 7,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(raw).toContain(fixture.oidcTargetMarker);
    expect(raw).not.toContain(fixture.oidcOtherMarker);
    expect(raw).not.toContain(fixture.oidcClientIdMarker);
    expect(raw).not.toContain(fixture.oidcClientSecretMarker);
    expect(raw).not.toContain('"clientId"');
    expect(raw).not.toContain('"clientSecretEncrypted"');
    expect(exported.data.groups.map((group) => group.name)).toEqual([
      fixture.targetGroupName,
    ]);
    expect(
      exported.data.learning.enrollments.map(
        (enrollment) => enrollment.courseTitle,
      ),
    ).toEqual([fixture.targetCourseTitle]);
    expect(
      exported.data.access.groupCourseAssignments.map(
        (assignment) => assignment.courseTitle,
      ),
    ).toEqual([fixture.targetCourseTitle]);
    expect(
      exported.data.access.groupBundleAssignments.map(
        (assignment) => assignment.bundleName,
      ),
    ).toEqual([fixture.groupBundleName]);
    const bundleCourseRelationships =
      exported.data.access.bundleCourseAssignments.map((assignment) => ({
        bundleName: assignment.bundleName,
        relationship: assignment.relationship,
        availableFrom: assignment.availableFrom,
        availableUntil: assignment.availableUntil,
        delayDays: assignment.delayDays,
        visible: assignment.visible,
      }));
    expect(bundleCourseRelationships).toHaveLength(2);
    expect(bundleCourseRelationships).toEqual(
      expect.arrayContaining([
        {
          bundleName: fixture.directBundleName,
          relationship: "direct",
          availableFrom: "2027-01-15T09:00:00.000Z",
          availableUntil: "2027-03-15T09:00:00.000Z",
          delayDays: 3,
          visible: false,
        },
        {
          bundleName: fixture.groupBundleName,
          relationship: "group",
          availableFrom: null,
          availableUntil: null,
          delayDays: 5,
          visible: true,
        },
      ]),
    );
    expect(
      exported.data.learning.courseMediaBindings.map(
        (binding) => binding.originalFileName,
      ),
    ).toEqual(expect.arrayContaining(fixture.mediaFileNames));
    const mediaRelationships = exported.data.learning.courseMediaBindings.map(
      (binding) => ({
        ownedBySubject: binding.ownedBySubject,
        uploadedBySubject: binding.uploadedBySubject,
      }),
    );
    expect(mediaRelationships).toHaveLength(2);
    expect(mediaRelationships).toEqual(
      expect.arrayContaining([
        { ownedBySubject: true, uploadedBySubject: false },
        { ownedBySubject: false, uploadedBySubject: true },
      ]),
    );
    expect(
      JSON.stringify({
        attempts: exported.data.learning.assessmentAttempts,
        answers: exported.data.learning.assessmentAnswers,
      }),
    ).not.toMatch(
      /accepted[_-]?answers|correct[_-]?(?:option|options|order)|feedback|presentation[_-]?order/i,
    );
    expect(exported.data.community.reportsMade).toHaveLength(1);
    expect(exported.data.community.posts).toEqual([
      expect.objectContaining({
        title: `Subject thread ${fixture.targetMarker}`,
        spaceType: "discussion",
        areaId: expect.any(String),
        areaTitle: "Allgemein",
        locked: true,
        contentFormat: "rich_text",
        contentProjectionVersion: 1,
        richText: {
          version: 1,
          blocks: [
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: `Subject content ${fixture.targetMarker}`,
                  bold: true,
                },
                { type: "text", text: "unsafe link text" },
              ],
            },
          ],
        },
        moderationState: "published",
        publishedAt: expect.any(String),
      }),
    ]);
    expect(exported.data.community.comments).toEqual([
      expect.objectContaining({
        content: `Subject nested reply ${fixture.targetMarker}`,
        contentFormat: "rich_text",
        contentProjectionVersion: 1,
        richText: {
          version: 1,
          blocks: [
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: `Subject nested reply ${fixture.targetMarker}`,
                },
                { type: "text", text: "unsafe comment link" },
              ],
            },
          ],
        },
        parentId: expect.any(String),
        moderationState: "published",
        publishedAt: expect.any(String),
      }),
    ]);
    expect(raw).not.toContain(fixture.communityRichTextUnsafeHref);
    expect(exported.data.community.likes).toEqual([
      expect.objectContaining({ reaction: "insightful" }),
    ]);
    expect(exported.data.community.commentReactions.made).toEqual([
      expect.objectContaining({ reaction: "insightful" }),
    ]);
    expect(
      exported.data.community.commentReactions.receivedSummary,
    ).toEqual([
      expect.objectContaining({ reaction: "celebrate", count: 1 }),
    ]);
    expect(exported.data.community.scoreContributions.length).toBeGreaterThan(0);
    expect(
      exported.data.community.scoreContributions.map(
        (contribution) => contribution.relationship,
      ),
    ).toEqual(expect.arrayContaining(["received", "generated"]));
    for (const contribution of exported.data.community.scoreContributions) {
      expect(contribution).not.toHaveProperty("actorId");
      expect(contribution).not.toHaveProperty("recipientId");
    }
    expect(exported.data.community.votes).toEqual([
      expect.objectContaining({ value: 1 }),
    ]);
    expect(exported.data.community.follows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "author",
          targetAuthorId: fixture.targetPeerId,
          targetSpaceId: null,
          notify: false,
        }),
        expect.objectContaining({
          targetType: "space",
          targetAuthorId: null,
          targetSpaceId: expect.any(String),
          notify: false,
        }),
      ]),
    );
    expect(exported.data.community.follows).toHaveLength(2);
    expect(exported.data.community.followerSummary).toEqual({
      authorFollowerCount: 1,
    });
    expect(exported.data.community.authorBoosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorId: fixture.targetUserId,
          strength: "medium",
          reason: fixture.communityBoostReason,
          administeredBySubject: false,
        }),
        expect.objectContaining({
          authorId: fixture.targetPeerId,
          strength: "light",
          reason: "[redacted]",
          administeredBySubject: true,
        }),
      ]),
    );
    expect(exported.data.community.authorBoosts).toHaveLength(2);
    for (const boost of exported.data.community.authorBoosts) {
      expect(boost).not.toHaveProperty("createdById");
    }
    expect(raw).not.toContain(fixture.communityBoostSecret);
    expect(exported.data.community.mentionsMade).toEqual([
      expect.objectContaining({ handle: expect.stringMatching(/^peer-/) }),
    ]);
    expect(exported.data.community.mentionsReceived).toEqual([
      expect.objectContaining({ handle: fixture.email.split("@")[0] }),
    ]);
    expect(exported.data.community.reportsMade[0]).toEqual(
      expect.objectContaining({ details: fixture.reportMadeDetails }),
    );
    expect(exported.data.community.reportsMade[0]).not.toHaveProperty(
      "reporterId",
    );
    expect(exported.data.community.reportsMade[0]).not.toHaveProperty(
      "targetAuthorId",
    );
    expect(exported.data.community.reportsMade[0]).not.toHaveProperty(
      "handledById",
    );
    expect(exported.data.community.reportsMade[0]).not.toHaveProperty(
      "resolutionNote",
    );
    expect(exported.data.community.reportsAbout).toHaveLength(1);
    expect(exported.data.community.reportsAbout[0]).toEqual(
      expect.objectContaining({
        reason: "privacy",
        outcome: "content_removed",
      }),
    );
    expect(exported.data.community.reportsAbout[0]).not.toHaveProperty(
      "details",
    );
    expect(exported.data.community.reportsAbout[0]).not.toHaveProperty(
      "reporterId",
    );
    expect(exported.data.community.reportsAbout[0]).not.toHaveProperty(
      "handledById",
    );
    expect(exported.data.community.reportsAbout[0]).not.toHaveProperty(
      "resolutionNote",
    );
    expect(exported.data.community.moderationCases).toEqual([]);
    expect(exported.data.community.moderationAppeals).toEqual([]);
    expect(exported.data.notifications.announcementInteractions).toEqual([
      {
        announcementId: fixture.announcementId,
        announcementTitle: fixture.announcementTitle,
        kind: "click",
        occurredAt: fixture.announcementInteractionOccurredAt,
      },
    ]);
    expect(exported.data.notifications.preferences).toEqual([
      expect.objectContaining({
        category: "community",
        emailEnabled: false,
        pushEnabled: true,
      }),
    ]);
    const [announcementInteraction] =
      exported.data.notifications.announcementInteractions;
    for (const internalField of [
      "organizationId",
      "userId",
      "body",
      "createdById",
      "targetRuleSet",
    ]) {
      expect(announcementInteraction).not.toHaveProperty(internalField);
    }
    expect(raw).not.toContain(fixture.announcementInteractionSecret);
    expect(raw).not.toContain(fixture.otherAnnouncementMarker);
    expect(exported.data.ai.conversations).toEqual([
      expect.objectContaining({
        agentVersionId: fixture.targetAgentVersionId,
        agentVersion: {
          name: fixture.targetAgentVersionName,
          type: "knowledge_assistant",
          version: 1,
          publishedAt: expect.any(String),
        },
      }),
    ]);
    expect(exported.data.ai.conversations[0]).not.toHaveProperty("agentId");
    expect(exported.data.ai.conversations[0]).not.toHaveProperty("agentName");
    expect(exported.data.ai.conversations[0]).not.toHaveProperty("metadata");
    expect(exported.data.ai.messages.map((message) => message.content)).toEqual([
      fixture.targetMarker,
      `Assistant ${fixture.targetMarker}`,
    ]);
    expect(exported.data.ai.messages[1]?.citations).toEqual([
      {
        title: expect.stringContaining("Internal source"),
        href: `/academy/ai?safe=${fixture.targetMarker}`,
      },
      {
        title: "Safe course citation",
        href: `/academy/course?safe=${fixture.targetMarker}`,
        excerpt: `Safe citation ${fixture.targetMarker}`,
      },
    ]);
    for (const message of exported.data.ai.messages) {
      expect(message).not.toHaveProperty("toolCalls");
      expect(message).not.toHaveProperty("metadata");
      for (const citation of message.citations) {
        expect(citation).not.toHaveProperty("courseId");
        expect(citation).not.toHaveProperty("lessonId");
        expect(citation).not.toHaveProperty("pageId");
        expect(citation).not.toHaveProperty("sourceId");
      }
    }
    expect(exported.data.ai.authoredAgentVersions).toHaveLength(2);
    expect(exported.data.ai.authoredAgentVersions).toEqual(
      expect.arrayContaining([
        {
          agentVersionId: fixture.targetAgentVersionId,
          name: fixture.targetAgentVersionName,
          type: "knowledge_assistant",
          version: 1,
          publishedAt: expect.any(String),
        },
        expect.objectContaining({
          name: fixture.targetAgentVersionName,
          type: "knowledge_assistant",
          version: 2,
          publishedAt: null,
        }),
      ]),
    );
    for (const version of exported.data.ai.authoredAgentVersions) {
      expect(version).not.toHaveProperty("systemPrompt");
      expect(version).not.toHaveProperty("description");
      expect(version).not.toHaveProperty("createdById");
    }
    expect(
      exported.data.ai.agentAccessGrants.map((grant) => grant.relationship),
    ).toEqual(["bundle", "direct_user", "group", "role"]);
    for (const grant of exported.data.ai.agentAccessGrants) {
      expect(grant.agentVersionId).toBe(fixture.targetAgentVersionId);
      expect(grant.name).toBe(fixture.targetAgentVersionName);
      expect(grant).not.toHaveProperty("subjectUserId");
      expect(grant).not.toHaveProperty("subjectGroupId");
      expect(grant).not.toHaveProperty("subjectBundleId");
      expect(grant).not.toHaveProperty("subjectRole");
    }
    expect(raw).not.toContain(fixture.mutableAgentName);
    expect(raw).not.toContain(fixture.internalAgentSourceId);
    expect(
      exported.data.audit.activityEvents.map(
        (event) => event.metadata.safeMarker,
      ),
    ).toContain(fixture.targetMarker);
    expect(
      exported.data.audit.activityEvents[0]?.metadata.nested?.callbackUrl,
    ).toBe(`https://example.test/callback?safe=${fixture.targetMarker}`);
    expect(exported.data.integrations.webhookDeliveryHistory).toEqual([
      expect.objectContaining({ id: fixture.webhookDeliveryId }),
    ]);
    expect(
      exported.data.integrations.webhookDeliveryHistory[0]?.payload,
    ).toBeUndefined();
    expect(
      exported.data.integrations.webhookDeliveryHistory[0]?.attempts,
    ).toMatchObject([
      {
        replayGeneration: 0,
        attempt: 1,
        outcome: "delivered",
        responseBodyRedacted: true,
        durationMs: 25,
      },
    ]);
    expect(exported.data.integrations.apiIdempotency).toEqual([
      expect.objectContaining({
        path: `/api/v1/members?safe=${fixture.targetMarker}`,
      }),
    ]);
    expect(exported.data.privacy.requests).toEqual([
      expect.objectContaining({
        clientRequestId: fixture.privacyClientRequestId,
      }),
    ]);
    expect(exported.data.privacy.events[0]?.metadata).toEqual({
      type: "access_export",
      policyVersion: "fixture-v1",
    });
    expect(exported.data.privacy.legalHolds).toHaveLength(1);
    expect(exported.data.privacy.legalHolds[0]).not.toHaveProperty("reason");
    expect(exported.data.privacy.legalHolds[0]).not.toHaveProperty(
      "legalBasis",
    );
    expect(exported.data.privacy.exportArtifacts).toHaveLength(1);
    expect(exported.data.privacy.exportArtifacts[0]).not.toHaveProperty(
      "storageKey",
    );
    expect(exported.data.privacy.exportArtifacts[0]).not.toHaveProperty(
      "failureCode",
    );
    expect(exported.data.audit.apiAuditLog).toEqual([
      expect.objectContaining({
        relationship: "apiCredential",
        path: `/api/v1/members?safe=${fixture.targetMarker}`,
        metadata: {
          safeMarker: fixture.targetMarker,
          callbackUrl: `https://example.test/result?safe=${fixture.targetMarker}`,
        },
      }),
    ]);
    expect(
      exported.exportManifest.excludedFields.map((entry) => entry.path),
    ).toContain(
      "data.integrations.webhookDeliveryHistory[].payload|responseBody|claimedAt",
    );
    expect(
      exported.exportManifest.excludedFields.map((entry) => entry.path),
    ).toContain(
      "data.authenticationActivity.oidcConfigurationContext.issuer|clientId|clientSecretEncrypted",
    );
    expect(raw.includes(fixture.otherMarker)).toBe(false);
    expect(raw.includes(fixture.restrictedSpaceSecret)).toBe(false);
  } finally {
    if (fixture) await removeFixture(sql, fixture);
    await sql.end();
  }
});

test("DSAR includes hidden authored content and only safe moderation outcomes", async ({}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let fixture: ExportFixture | null = null;
  try {
    fixture = await createFixture(sql);
    const moderation = await addCommunityModerationExportFixture(sql, fixture);
    const output = testInfo.outputPath("community-moderation-export.json");
    await runExport(fixture, output);
    const raw = await readFile(output, "utf8");
    const exported = JSON.parse(raw) as {
      schemaVersion: number;
      data: {
        community: {
          posts: Array<{
            id: string;
            title: string;
            moderationState: string;
            publishedAt: string | null;
            moderatedAt: string | null;
          }>;
          comments: Array<{
            content: string;
            moderationState: string;
            publishedAt: string | null;
            moderatedAt: string | null;
          }>;
          reportsMade: Array<Record<string, unknown>>;
          reportsAbout: Array<Record<string, unknown>>;
          moderationCases: Array<Record<string, unknown>>;
          moderationAppeals: Array<Record<string, unknown>>;
        };
      };
    };

    expect(exported.schemaVersion).toBe(23);
    const hiddenPosts = exported.data.community.posts.filter((post) =>
      post.title.startsWith(moderation.marker),
    );
    expect(hiddenPosts.map((post) => post.moderationState).sort()).toEqual([
      "held",
      "pending",
      "rejected",
    ]);
    for (const post of hiddenPosts) expect(post.publishedAt).toBeNull();

    const hiddenComments = exported.data.community.comments.filter((comment) =>
      comment.content.startsWith(moderation.marker),
    );
    expect(hiddenComments.map((comment) => comment.moderationState).sort()).toEqual([
      "held",
      "pending",
      "rejected",
    ]);
    for (const comment of hiddenComments) expect(comment.publishedAt).toBeNull();

    const moderationCase = exported.data.community.moderationCases.find(
      (entry) => entry.id === moderation.caseId,
    );
    expect(moderationCase).toEqual(
      expect.objectContaining({
        id: moderation.caseId,
        targetType: "post",
        targetId: moderation.heldPostId,
        contentState: "held",
        reasonCode: "manual",
        status: "appealed",
        contentPublishedAt: null,
        contentModeratedAt: expect.any(String),
        openedAt: expect.any(String),
        resolvedAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
    for (const forbidden of [
      "targetAuthorId",
      "contentVersion",
      "claimedById",
      "claimedAt",
      "resolvedById",
      "priority",
      "policyVersion",
      "decisionVersion",
      "note",
    ]) {
      expect(moderationCase).not.toHaveProperty(forbidden);
    }

    const appeal = exported.data.community.moderationAppeals.find(
      (entry) => entry.id === moderation.appealId,
    );
    expect(appeal).toEqual(
      expect.objectContaining({
        id: moderation.appealId,
        caseId: moderation.caseId,
        statement: moderation.appealStatement,
        result: "appeal_overturned",
        resolvedAt: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
    for (const forbidden of [
      "appellantId",
      "decisionVersion",
      "resolvedById",
      "resolutionNote",
    ]) {
      expect(appeal).not.toHaveProperty(forbidden);
    }
    for (const report of [
      ...exported.data.community.reportsMade,
      ...exported.data.community.reportsAbout,
    ]) {
      expect(report).not.toHaveProperty("reporterId");
      expect(report).not.toHaveProperty("caseId");
      expect(report).not.toHaveProperty("targetAuthorId");
      expect(report).not.toHaveProperty("handledById");
      expect(report).not.toHaveProperty("resolutionNote");
    }
    for (const internalMarker of moderation.internalMarkers) {
      expect(raw).not.toContain(internalMarker);
    }
  } finally {
    if (fixture) await removeFixture(sql, fixture);
    await sql.end();
  }
});

test("DSAR effective community access is false for disabled subjects", async ({}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let fixture: ExportFixture | null = null;
  try {
    fixture = await createFixture(sql);
    await sql`
      update users
      set role = 'owner', status = 'disabled'
      where id = ${fixture.targetUserId}
        and organization_id = ${fixture.targetOrganizationId}
    `;

    const output = testInfo.outputPath("disabled-community-access-export.json");
    await runExport(fixture, output);
    const raw = await readFile(output, "utf8");
    const exported = JSON.parse(raw) as {
      data: {
        community: {
          effectiveSpaceAccess: Array<{
            canView: boolean;
            canPost: boolean;
            canComment: boolean;
          }>;
        };
      };
    };

    expect(exported.data.community.effectiveSpaceAccess.length).toBeGreaterThan(
      0,
    );
    for (const access of exported.data.community.effectiveSpaceAccess) {
      expect(access).toEqual(
        expect.objectContaining({
          canView: false,
          canPost: false,
          canComment: false,
        }),
      );
    }
    expect(raw.includes(fixture.restrictedSpaceSecret)).toBe(false);
  } finally {
    if (fixture) await removeFixture(sql, fixture);
    await sql.end();
  }
});

test("DSAR subject resolution fails closed for zero or multiple case-insensitive matches", async ({}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let fixture: ExportFixture | null = null;
  try {
    fixture = await createFixture(sql);
    await sql`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values (
        ${fixture.targetOrganizationId}, ${fixture.email.toUpperCase()},
        'ambiguous-password-hash', 'Ambiguous', 'Subject'
      )
    `;

    for (const candidate of [
      {
        email: fixture.email.toUpperCase(),
        output: testInfo.outputPath("ambiguous-subject.json"),
      },
      {
        email: `missing-${fixture.email}`,
        output: testInfo.outputPath("missing-subject.json"),
      },
    ]) {
      let failure: unknown;
      try {
        await runExport(fixture, candidate.output, { email: candidate.email });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeTruthy();
      const result = failure as { stdout?: string; stderr?: string };
      expect(result.stdout ?? "").toBe("");
      expect(result.stderr ?? "").toContain(
        "Benutzer im angegebenen Tenant konnte nicht eindeutig aufgeloest werden",
      );
      await expect(stat(candidate.output)).rejects.toThrow();
    }
  } finally {
    if (fixture) await removeFixture(sql, fixture);
    await sql.end();
  }
});

test("DSAR export excludes credential material and never writes data to stdout", async ({}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let fixture: ExportFixture | null = null;
  try {
    fixture = await createFixture(sql);
    const output = testInfo.outputPath("secret-safe-export.json");
    const result = await runExport(fixture, output);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DSAR export completed.");
    expect(
      fixture.secretMarkers.map((marker) => result.stderr.includes(marker)),
    ).toEqual(fixture.secretMarkers.map(() => false));

    const raw = await readFile(output, "utf8");
    expect(fixture.secretMarkers.map((marker) => raw.includes(marker))).toEqual(
      fixture.secretMarkers.map(() => false),
    );
    expect(raw.includes('"passwordHash"')).toBe(false);
    expect(raw.includes('"tokenHash"')).toBe(false);
    expect(raw.includes('"jtiHash"')).toBe(false);
    expect(raw.includes('"keyHash"')).toBe(false);
    expect(raw.includes('"signingSecretEncrypted"')).toBe(false);
    expect(raw.includes('"payload"')).toBe(false);
    expect(raw.includes('"claimToken"')).toBe(false);
    expect(raw.includes('"requestHash"')).toBe(false);
    expect(raw.includes('"responseBody"')).toBe(false);
    expect(raw.includes('"storageKey"')).toBe(false);
    expect(raw.includes('"storageVersionId"')).toBe(false);
    expect(raw.includes('"failureCode"')).toBe(false);
    expect(raw.includes('"failureDetail"')).toBe(false);
    expect(raw.includes('"clientId"')).toBe(false);
    expect(raw.includes('"clientSecretEncrypted"')).toBe(false);
    expect(raw.includes('"ciphertext"')).toBe(false);
    expect(raw).not.toMatch(/"correct[_-]?option"/i);
    if (process.platform !== "win32") {
      expect((await stat(output)).mode & 0o777).toBe(0o600);
    }

    let duplicateFailure: unknown;
    try {
      await runExport(fixture, output);
    } catch (error) {
      duplicateFailure = error;
    }
    expect(duplicateFailure).toBeTruthy();
    const duplicateResult = duplicateFailure as {
      stderr?: string;
      stdout?: string;
    };
    expect(duplicateResult.stdout ?? "").toBe("");
    expect(duplicateResult.stderr ?? "").toContain(
      "Exportdatei konnte nicht sicher und exklusiv geschrieben werden",
    );
    expect(await readFile(output, "utf8")).toBe(raw);
  } finally {
    if (fixture) await removeFixture(sql, fixture);
    await sql.end();
  }
});

test("DSAR export requires an explicitly provided DATABASE_URL", async ({}, testInfo) => {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  let failure: unknown;
  try {
    await execFileAsync(
      process.execPath,
      [
        tsxCli,
        "scripts/export-user-data.ts",
        "--organization-slug",
        "example-tenant",
        "--user-email",
        "subject@example.test",
        "--output",
        testInfo.outputPath("must-not-exist.json"),
      ],
      { cwd: process.cwd(), env: environment, timeout: 30_000 },
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeTruthy();
  const result = failure as { stdout?: string; stderr?: string };
  expect(result.stdout ?? "").toBe("");
  expect(result.stderr ?? "").toContain(
    "DATABASE_URL muss explizit gesetzt sein",
  );
});
