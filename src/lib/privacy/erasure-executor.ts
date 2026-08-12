import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { mediaAssetIdentity, type MediaAsset } from "@/lib/media/asset-service";
import { deleteStoredMediaObject } from "@/lib/media/storage";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { lockPrivacyLegalHoldSubjects } from "@/lib/privacy/legal-hold-lock";

type PrivacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ErasureMediaRow = Pick<
  MediaAsset,
  | "id"
  | "organizationId"
  | "purpose"
  | "storageDriver"
  | "storageKey"
  | "stagingStorageKey"
> & {
  subjectAttachment: boolean;
  boundToOtherSubject: boolean;
  courseBinding: boolean;
  derivativeStorageKeys: string[];
};

export type MemberErasureMediaPlan = Readonly<{
  purge: ErasureMediaRow[];
  retainShared: ErasureMediaRow[];
}>;

export const MEMBER_ERASURE_RETENTION_EXCEPTIONS = [
  {
    code: "privacy_audit_chain",
    description:
      "Privacy request/event history and security audit evidence remain without direct identity fields.",
  },
  {
    code: "moderation_evidence",
    description:
      "Immutable moderation decisions and appeals remain linked only to the pseudonymous user surrogate.",
  },
  {
    code: "approved_action_evidence",
    description:
      "Immutable AI action approval history remains linked only to the pseudonymous user surrogate.",
  },
  {
    code: "shared_organizational_content",
    description:
      "Published/shared course, agent and configuration content remains; actor attribution and media filenames are anonymized where mutable.",
  },
  {
    code: "verified_media_tombstones",
    description:
      "Storage-free media tombstones remain temporarily for deletion verification and operational retention.",
  },
] as const;

function pseudonymousEmail(subjectReference: string) {
  return `erased-${subjectReference.slice(0, 24)}@privacy.invalid`;
}

function retainedMediaName(assetId: string) {
  return `retained-${assetId.slice(0, 8)}.bin`;
}

export async function buildMemberErasureMediaPlan(input: {
  sql: Sql;
  organizationId: string;
  subjectUserId: string;
  snapshotAt: Date;
}) {
  let snapshotAtIso: string;
  try {
    snapshotAtIso = Date.prototype.toISOString.call(input.snapshotAt);
  } catch {
    throw new TypeError("The erasure media snapshot timestamp is invalid.");
  }
  const rows = await input.sql<ErasureMediaRow[]>`
    select
      m.id,
      m.organization_id as "organizationId",
      m.purpose,
      m.storage_driver as "storageDriver",
      m.storage_key as "storageKey",
      m.staging_storage_key as "stagingStorageKey",
      coalesce(array(
        select d.storage_key
        from media_asset_derivatives d
        where d.organization_id = m.organization_id
          and d.source_asset_id = m.id
        order by d.created_at, d.id
      ), array[]::text[]) as "derivativeStorageKeys",
      (
        exists (
          select 1 from submission_attachments a
          join submissions s on s.id = a.submission_id
                            and s.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and s.user_id = ${input.subjectUserId}
        )
        or exists (
          select 1 from community_post_attachments a
          join posts p on p.id = a.post_id
                      and p.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and p.author_id = ${input.subjectUserId}
        )
        or exists (
          select 1 from community_comment_attachments a
          join comments c on c.id = a.comment_id
                         and c.post_id = a.post_id
                         and c.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and c.author_id = ${input.subjectUserId}
        )
      ) as "subjectAttachment",
      (
        exists (
          select 1 from submission_attachments a
          join submissions s on s.id = a.submission_id
                            and s.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and s.user_id <> ${input.subjectUserId}
        )
        or exists (
          select 1 from community_post_attachments a
          join posts p on p.id = a.post_id
                      and p.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and p.author_id <> ${input.subjectUserId}
        )
        or exists (
          select 1 from community_comment_attachments a
          join comments c on c.id = a.comment_id
                         and c.post_id = a.post_id
                         and c.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and c.author_id <> ${input.subjectUserId}
        )
      ) as "boundToOtherSubject",
      exists (
        select 1 from course_media_assets a
        where a.organization_id = ${input.organizationId}
          and a.media_asset_id = m.id
      ) as "courseBinding"
    from media_assets m
    where m.organization_id = ${input.organizationId}
      and m.created_at <= ${snapshotAtIso}::timestamptz
      and (
        m.owner_user_id = ${input.subjectUserId}
        or m.uploaded_by_id = ${input.subjectUserId}
        or exists (
          select 1 from submission_attachments a
          join submissions s on s.id = a.submission_id
                            and s.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and s.user_id = ${input.subjectUserId}
        )
        or exists (
          select 1 from community_post_attachments a
          join posts p on p.id = a.post_id
                      and p.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and p.author_id = ${input.subjectUserId}
        )
        or exists (
          select 1 from community_comment_attachments a
          join comments c on c.id = a.comment_id
                         and c.post_id = a.post_id
                         and c.organization_id = a.organization_id
          where a.organization_id = ${input.organizationId}
            and a.media_asset_id = m.id
            and c.author_id = ${input.subjectUserId}
        )
      )
    order by m.created_at, m.id
  `;

  const configuredDriver = getMediaStorageConfiguration().driver;
  const retainShared: ErasureMediaRow[] = [];
  const purge: ErasureMediaRow[] = [];
  for (const row of rows) {
    if (row.storageDriver !== configuredDriver) {
      throw new Error(`Media asset ${row.id} uses an unavailable storage driver.`);
    }
    const shared =
      row.purpose === "course_content" ||
      row.purpose === "branding" ||
      row.courseBinding ||
      row.boundToOtherSubject;
    (shared ? retainShared : purge).push(row);
  }
  return { purge, retainShared } satisfies MemberErasureMediaPlan;
}

export async function purgeMemberErasureMedia(plan: MemberErasureMediaPlan) {
  for (const asset of plan.purge) {
    for (const key of asset.derivativeStorageKeys) {
      await deleteStoredMediaObject({
        organizationId: asset.organizationId,
        assetId: asset.id,
        key,
      });
    }
    await deleteStoredMediaObject(mediaAssetIdentity(asset, "staging"));
    await deleteStoredMediaObject(mediaAssetIdentity(asset, "ready"));
  }
}

async function mutationCount(
  tx: PrivacyTransaction,
  query: ReturnType<typeof sql<{ count: number }>>,
) {
  const [row] = await tx.execute(query);
  return Number(row?.count ?? 0);
}

export async function applyMemberErasure(input: {
  tx: PrivacyTransaction;
  organizationId: string;
  subjectUserId: string;
  subjectReference: string;
  mediaPlan: MemberErasureMediaPlan;
  now: Date;
}) {
  const { tx, organizationId, subjectUserId, mediaPlan, now } = input;
  const nowIso = now.toISOString();
  await lockPrivacyLegalHoldSubjects(tx, [
    { organizationId, subjectReference: input.subjectReference },
  ]);
  const counts: Record<string, number> = {};

  counts.credentials = await mutationCount(tx, sql<{ count: number }>`
    with
    reset_tokens as (delete from password_reset_tokens where user_id = ${subjectUserId} returning 1),
    sessions as (delete from user_sessions where user_id = ${subjectUserId} returning 1),
    mfa as (delete from user_mfa_configurations where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    mfa_challenges as (delete from mfa_login_challenges where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    oidc as (delete from oidc_identities where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    push_subscriptions as (delete from web_push_subscriptions where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    native_push_deliveries_deleted as (delete from native_push_deliveries where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    native_push_devices_deleted as (delete from native_push_devices where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    invitations_deleted as (delete from invitations where user_id = ${subjectUserId} and organization_id = ${organizationId} returning 1),
    api_keys_changed as (
      update api_keys set status = 'revoked', revoked_at = coalesce(revoked_at, ${nowIso}), created_by_id = null
      where organization_id = ${organizationId} and created_by_id = ${subjectUserId}
      returning 1
    ),
    webhooks_changed as (
      update webhooks set active = false, created_by_id = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and created_by_id = ${subjectUserId}
      returning 1
    ),
    commerce_connections_changed as (
      update commerce_provider_connections set created_by_id = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and created_by_id = ${subjectUserId}
      returning 1
    ),
    automation_workflows_changed as (
      update automation_workflow_connections set created_by_id = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and created_by_id = ${subjectUserId}
      returning 1
    ),
    custom_domain_claims_changed as (
      update custom_domain_claims set created_by_id = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and created_by_id = ${subjectUserId}
      returning 1
    )
    select (
      (select count(*) from reset_tokens) + (select count(*) from sessions) +
      (select count(*) from mfa) + (select count(*) from mfa_challenges) +
      (select count(*) from oidc) + (select count(*) from push_subscriptions) +
      (select count(*) from native_push_deliveries_deleted) +
      (select count(*) from native_push_devices_deleted) +
      (select count(*) from invitations_deleted) +
      (select count(*) from api_keys_changed) + (select count(*) from webhooks_changed) +
      (select count(*) from commerce_connections_changed) +
      (select count(*) from automation_workflows_changed) +
      (select count(*) from custom_domain_claims_changed)
    )::integer as count
  `);

  counts.orbit = await mutationCount(tx, sql<{ count: number }>`
    with
    subject_accounts as materialized (
      select account_id
      from orbit_account_identities
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
    ),
    identities_deleted as (
      delete from orbit_account_identities
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning account_id
    ),
    orphan_accounts as materialized (
      select account_id
      from subject_accounts subject
      where not exists (
        select 1 from orbit_account_identities identity
        where identity.account_id = subject.account_id
          and not (
            identity.organization_id = ${organizationId}
            and identity.user_id = ${subjectUserId}
          )
      )
    ),
    claims_deleted as (
      delete from orbit_instance_claims claim
      using orphan_accounts orphan
      where claim.created_by_account_id = orphan.account_id
        and claim.consumed_at is null
      returning 1
    ),
    delegations_revoked as (
      update orbit_partner_delegations delegation
      set revoked_at = coalesce(delegation.revoked_at, ${nowIso}),
          updated_at = ${nowIso}
      from orphan_accounts orphan
      where delegation.partner_account_id = orphan.account_id
      returning 1
    ),
    accounts_pseudonymized as (
      update orbit_accounts account
      set email = ${pseudonymousEmail(input.subjectReference)},
          display_name = 'Deleted account', status = 'suspended',
          updated_at = ${nowIso}
      from orphan_accounts orphan
      where account.id = orphan.account_id
      returning 1
    )
    select (
      (select count(*) from identities_deleted) +
      (select count(*) from claims_deleted) +
      (select count(*) from delegations_revoked) +
      (select count(*) from accounts_pseudonymized)
    )::integer as count
  `);

  counts.profile = await mutationCount(tx, sql<{ count: number }>`
    with
    custom_values as (delete from custom_field_values where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    form_submissions as (delete from data_form_submissions where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    profile_values as (delete from data_profile_values where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    profiles as (delete from member_data_profiles where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    acknowledgements as (delete from member_welcome_acknowledgements where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    announcement_interactions_deleted as (
      delete from announcement_interactions
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    announcement_dismissals_deleted as (
      delete from announcement_dismissals dismissal
      using announcements announcement, users account
      where dismissal.announcement_id = announcement.id
        and dismissal.user_id = account.id
        and announcement.organization_id = ${organizationId}
        and account.organization_id = ${organizationId}
        and account.id = ${subjectUserId}
      returning 1
    ),
    notification_preferences_deleted as (
      delete from user_notification_preferences
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    notifications_deleted as (
      delete from notifications notification
      using users account
      where notification.user_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    mail_feedback_deleted as (
      delete from email_delivery_feedback_events feedback
      using email_deliveries delivery
      where feedback.delivery_id = delivery.id
        and feedback.organization_id = ${organizationId}
        and delivery.organization_id = ${organizationId}
        and delivery.user_id = ${subjectUserId}
      returning 1
    ),
    mail_suppressions_deleted as (
      delete from email_suppressions
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    mail_deleted as (delete from email_deliveries where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1)
    select (
      (select count(*) from custom_values) + (select count(*) from form_submissions) +
      (select count(*) from profile_values) + (select count(*) from profiles) +
      (select count(*) from acknowledgements) +
      (select count(*) from announcement_interactions_deleted) +
      (select count(*) from announcement_dismissals_deleted) +
      (select count(*) from notification_preferences_deleted) +
      (select count(*) from notifications_deleted) +
      (select count(*) from mail_feedback_deleted) +
      (select count(*) from mail_suppressions_deleted) +
      (select count(*) from mail_deleted)
    )::integer as count
  `);
  const [aiAcknowledgementTable] = await tx.execute(
    sql<{ name: string | null }>`select to_regclass('public.ai_external_use_acknowledgements')::text as name`,
  );
  if (aiAcknowledgementTable?.name) {
    counts.profile += await mutationCount(tx, sql<{ count: number }>`
      with deleted as (
        delete from ai_external_use_acknowledgements
        where organization_id = ${organizationId} and user_id = ${subjectUserId}
        returning 1
      )
      select count(*)::integer as count from deleted
    `);
  }

  counts.access = await mutationCount(tx, sql<{ count: number }>`
    with
    group_rows as (
      delete from group_members membership
      using users account
      where membership.user_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    bundle_rows as (
      delete from member_bundles membership
      using users account
      where membership.user_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    grants as (delete from course_access_grants where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    collaborators as (delete from course_collaborators where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    authors as (delete from course_authors where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    overrides as (delete from course_module_access_overrides where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    access_requests as (delete from course_module_access_requests where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    hub_grants as (
      delete from hub_access_grants access
      using users account
      where access.subject_type = 'user'
        and access.subject_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    community_rules as (delete from community_space_access_rules where organization_id = ${organizationId} and subject_type = 'user' and subject_user_id = ${subjectUserId} returning 1),
    agent_grants as (delete from ai_agent_version_access_grants where organization_id = ${organizationId} and subject_type = 'user' and subject_user_id = ${subjectUserId} returning 1)
    select (
      (select count(*) from group_rows) + (select count(*) from bundle_rows) +
      (select count(*) from grants) + (select count(*) from collaborators) +
      (select count(*) from authors) + (select count(*) from overrides) +
      (select count(*) from access_requests) + (select count(*) from hub_grants) +
      (select count(*) from community_rules) + (select count(*) from agent_grants)
    )::integer as count
  `);

  counts.learning = await mutationCount(tx, sql<{ count: number }>`
    with
    submissions_deleted as (delete from submissions where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    attempts as (delete from assessment_attempts where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    learning_time as (delete from lesson_learning_time_sessions where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    media_playback as (delete from media_playback_progress where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    processing_jobs as (
      update media_processing_jobs
      set requested_by_id = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and requested_by_id = ${subjectUserId}
      returning 1
    ),
    progress as (
      delete from lesson_progress progress
      using users account
      where progress.user_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    subscriptions as (delete from lesson_availability_subscriptions where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    bookmarks as (delete from lesson_bookmarks where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    enrollments_deleted as (
      delete from enrollments enrollment
      using users account
      where enrollment.user_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    certificates as (delete from course_certificates where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    feedback_deleted as (delete from feedback_entries where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    attendees as (
      delete from event_attendees attendee
      using users account
      where attendee.user_id = account.id
        and account.id = ${subjectUserId}
        and account.organization_id = ${organizationId}
      returning 1
    ),
    audience as (delete from event_audience_grants where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    points as (delete from point_transactions where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    badges as (delete from user_badges where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1)
    select (
      (select count(*) from submissions_deleted) + (select count(*) from attempts) +
      (select count(*) from learning_time) + (select count(*) from media_playback) +
      (select count(*) from processing_jobs) +
      (select count(*) from progress) +
      (select count(*) from subscriptions) + (select count(*) from bookmarks) +
      (select count(*) from enrollments_deleted) + (select count(*) from certificates) +
      (select count(*) from feedback_deleted) + (select count(*) from attendees) +
      (select count(*) from audience) + (select count(*) from points) +
      (select count(*) from badges)
    )::integer as count
  `);

  counts.integrations = await mutationCount(tx, sql<{ count: number }>`
    with
    entitlements_deleted as (
      delete from commerce_entitlements
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    subscriptions_deleted as (
      delete from commerce_subscriptions
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    orders_changed as (
      update commerce_orders
      set user_id = null,
          customer_email = ${pseudonymousEmail(input.subjectReference)},
          updated_at = ${nowIso}
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    inbox_changed as (
      update commerce_inbound_events
      set normalized_payload = normalized_payload - 'customerEmail'
      where organization_id = ${organizationId}
        and normalized_payload ->> 'customerEmail' = (
          select email from users where id = ${subjectUserId} and organization_id = ${organizationId}
        )
      returning 1
    ),
    outbox_changed as (
      update commerce_outbox_events
      set payload = '{"redacted":"member_erasure"}'::jsonb
      where organization_id = ${organizationId}
        and payload ->> 'userId' = ${subjectUserId}
      returning 1
    ),
    webhook_deliveries_changed as (
      update webhook_deliveries
      set payload = '{"redacted":"member_erasure"}'::jsonb,
          response_body = null,
          updated_at = ${nowIso}
      where organization_id = ${organizationId}
        and payload -> 'data' ->> 'userId' = ${subjectUserId}
      returning 1
    )
    select (
      (select count(*) from entitlements_deleted) +
      (select count(*) from subscriptions_deleted) +
      (select count(*) from orders_changed) +
      (select count(*) from inbox_changed) +
      (select count(*) from outbox_changed) +
      (select count(*) from webhook_deliveries_changed)
    )::integer as count
  `);

  counts.community = await mutationCount(tx, sql<{ count: number }>`
    with
    post_likes_deleted as (delete from post_likes where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    votes as (delete from post_votes where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    reactions as (delete from comment_reactions where organization_id = ${organizationId} and user_id = ${subjectUserId} returning 1),
    follows as (delete from community_follows where organization_id = ${organizationId} and (follower_id = ${subjectUserId} or target_author_id = ${subjectUserId}) returning 1),
    mentions as (delete from community_mentions where organization_id = ${organizationId} and (mentioned_user_id = ${subjectUserId} or mentioned_by_id = ${subjectUserId}) returning 1),
    boosts as (delete from community_author_boosts where organization_id = ${organizationId} and author_id = ${subjectUserId} returning 1),
    scores as (delete from community_score_contributions where organization_id = ${organizationId} and (recipient_id = ${subjectUserId} or actor_id = ${subjectUserId}) returning 1),
    own_reports as (delete from community_reports where organization_id = ${organizationId} and reporter_id = ${subjectUserId} returning 1),
    target_reports as (
      update community_reports set target_author_id = null, content_excerpt = '[removed]', details = null, resolution_note = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and target_author_id = ${subjectUserId}
      returning 1
    ),
    comments_changed as (
      update comments set content = '[removed]', content_format = 'plain_text',
                          rich_text = null, content_projection_version = 1,
                          moderation_fingerprint = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and author_id = ${subjectUserId}
      returning 1
    ),
    posts_changed as (
      update posts set title = null, content = '[removed]',
                       content_format = 'plain_text', rich_text = null,
                       content_projection_version = 1, image_url = null,
                       moderation_fingerprint = null, updated_at = ${nowIso}
      where organization_id = ${organizationId} and author_id = ${subjectUserId}
      returning 1
    )
    select (
      (select count(*) from post_likes_deleted) + (select count(*) from votes) +
      (select count(*) from reactions) + (select count(*) from follows) +
      (select count(*) from mentions) + (select count(*) from boosts) +
      (select count(*) from scores) + (select count(*) from own_reports) +
      (select count(*) from target_reports) + (select count(*) from comments_changed) +
      (select count(*) from posts_changed)
    )::integer as count
  `);

  counts.ai = await mutationCount(tx, sql<{ count: number }>`
    with
    messages_deleted as (
      delete from ai_messages message
      using ai_conversations conversation
      where conversation.id = message.conversation_id
        and conversation.organization_id = ${organizationId}
        and conversation.user_id = ${subjectUserId}
      returning 1
    ),
    conversations_deleted as (
      delete from ai_conversations conversation
      where conversation.organization_id = ${organizationId}
        and conversation.user_id = ${subjectUserId}
        and not exists (
          select 1 from ai_agent_action_requests request
          where request.organization_id = ${organizationId}
            and request.conversation_id = conversation.id
        )
      returning 1
    ),
    conversations_redacted as (
      update ai_conversations conversation
      set title = null, metadata = '{}'::jsonb, message_count = 0,
          last_message_at = null, status = 'archived', updated_at = ${nowIso}
      where conversation.organization_id = ${organizationId}
        and conversation.user_id = ${subjectUserId}
      returning 1
    )
    select (
      (select count(*) from messages_deleted) + (select count(*) from conversations_deleted) +
      (select count(*) from conversations_redacted)
    )::integer as count
  `);

  const purgeIds = mediaPlan.purge.map(({ id }) => id);
  if (purgeIds.length) {
    await tx.execute(sql`
      delete from community_post_attachments
      where organization_id = ${organizationId}
        and ${inArray(sql`media_asset_id`, purgeIds)}
    `);
    await tx.execute(sql`
      delete from community_comment_attachments
      where organization_id = ${organizationId}
        and ${inArray(sql`media_asset_id`, purgeIds)}
    `);
    await tx.execute(sql`
      delete from community_asset_bindings
      where organization_id = ${organizationId}
        and ${inArray(sql`media_asset_id`, purgeIds)}
    `);
    await tx
      .update(mediaAssets)
      .set({
        uploadedById: null,
        ownerUserId: null,
        status: "deleted",
        originalFileName: "removed.bin",
        safeFileName: "removed.bin",
        quotaBytes: sql<number>`case
          when ${nowIso}::timestamptz >= ${mediaAssets.uploadExpiresAt} + interval '1 hour'
            then 0
          else ${mediaAssets.declaredSizeBytes}
        end`,
        scanClaimToken: null,
        scanClaimedAt: null,
        scanLeaseExpiresAt: null,
        scanNextRetryAt: null,
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
        scanFailureCode: "privacy_erasure",
        scanFailureDetail: null,
        malwareSignature: null,
        deletedAt: now,
        storageDeletedAt: now,
        stagingDeletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAssets.organizationId, organizationId),
          inArray(mediaAssets.id, purgeIds),
        ),
      );
  }

  const sharedIds = mediaPlan.retainShared.map(({ id }) => id);
  for (const assetId of sharedIds) {
    const name = retainedMediaName(assetId);
    await tx
      .update(mediaAssets)
      .set({
        uploadedById: null,
        ownerUserId: null,
        originalFileName: name,
        safeFileName: name,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAssets.organizationId, organizationId),
          eq(mediaAssets.id, assetId),
        ),
      );
  }

  counts.learning += await mutationCount(tx, sql<{ count: number }>`
    with changed as (
      update video_description_jobs
      set requested_by_id = null,
          requester_subject_reference = case
            when exists (
              select 1 from privacy_legal_holds hold
              where hold.organization_id = ${organizationId}
                and hold.subject_reference = ${input.subjectReference}
                and hold.scope in ('all', 'learning', 'audit')
                and hold.released_at is null
                and hold.starts_at <= ${nowIso}
                and (hold.expires_at is null or hold.expires_at > ${nowIso})
            ) then requester_subject_reference
            else null
          end,
          updated_at = ${nowIso}
      where organization_id = ${organizationId}
        and (
          requested_by_id = ${subjectUserId}
          or requester_subject_reference = ${input.subjectReference}
        )
      returning 1
    )
    select count(*)::integer as count from changed
  `);

  counts.audit = await mutationCount(tx, sql<{ count: number }>`
    with
    activity_changed as (
      update activity_events set user_id = null, entity_id = null,
        metadata = '{"redacted":"member_erasure"}'::jsonb
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    api_audit_changed as (
      update api_audit_logs set actor_user_id = null, ip_address = null,
        user_agent = null, metadata = '{"redacted":"member_erasure"}'::jsonb
      where organization_id = ${organizationId} and actor_user_id = ${subjectUserId}
      returning 1
    )
    select ((select count(*) from activity_changed) + (select count(*) from api_audit_changed))::integer as count
  `);

  await tx.execute(sql`
    update privacy_requests
    set subject_user_id = null,
        requested_by_id = case when requested_by_id = ${subjectUserId} then null else requested_by_id end,
        identity_verified_by_id = case when identity_verified_by_id = ${subjectUserId} then null else identity_verified_by_id end,
        approved_by_id = case when approved_by_id = ${subjectUserId} then null else approved_by_id end,
        updated_at = ${nowIso}
    where organization_id = ${organizationId}
      and subject_user_id = ${subjectUserId}
  `);
  await tx.execute(sql`
    update privacy_legal_holds
    set subject_user_id = null,
        created_by_id = case when created_by_id = ${subjectUserId} then null else created_by_id end,
        released_by_id = case when released_by_id = ${subjectUserId} then null else released_by_id end,
        updated_at = ${nowIso}
    where organization_id = ${organizationId}
      and (subject_user_id = ${subjectUserId} or created_by_id = ${subjectUserId} or released_by_id = ${subjectUserId})
  `);

  counts.authoring = await mutationCount(tx, sql<{ count: number }>`
    with
    presence_deleted as (
      delete from editor_presences
      where organization_id = ${organizationId} and user_id = ${subjectUserId}
      returning 1
    ),
    stock_deleted as (
      delete from stock_image_selections
      where organization_id = ${organizationId} and selected_by_id = ${subjectUserId}
      returning 1
    )
    select ((select count(*) from presence_deleted) + (select count(*) from stock_deleted))::integer as count
  `);

  const invalidPassword = `!erased:${createHash("sha256").update(`${organizationId}\0${subjectUserId}\0${nowIso}`).digest("hex")}`;
  await tx.execute(sql`
    update users
    set email = ${pseudonymousEmail(input.subjectReference)},
        password_hash = ${invalidPassword}, first_name = 'Deleted',
        last_name = 'Member', avatar_url = null, status = 'disabled',
        job_title = null, department = null, phone = null, bio = null,
        preferred_locale = null, points = 0,
        community_points = 0, last_login_at = null
    where id = ${subjectUserId} and organization_id = ${organizationId}
  `);

  return {
    counts,
    purgedMedia: purgeIds.length,
    retainedSharedMedia: sharedIds.length,
    retentionExceptions: MEMBER_ERASURE_RETENTION_EXCEPTIONS.map(({ code }) => code),
  };
}
