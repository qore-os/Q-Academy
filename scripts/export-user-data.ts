import { open, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres, { type Sql } from "postgres";
import { sanitizeRichTextDocument } from "../src/lib/rich-text/document";

const HELP = `Q-Academy DSAR-Datenexport

Erforderlich:
  --organization-slug <slug>  Eindeutiger Organisations-Slug
  --user-email <email>        E-Mail des Benutzers im Tenant
  --output <path.json>        Neu anzulegende JSON-Ausgabedatei

DATABASE_URL muss explizit in der Umgebung gesetzt sein. Die Ausgabedatei
wird nicht ueberschrieben und auf Dateirechte 0600 gesetzt.`;

const valueFlags = new Set(["organization-slug", "user-email", "output"]);

class CliError extends Error {}

function parseArguments(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      if (Object.hasOwn(parsed, "help")) {
        throw new CliError("--help darf nur einmal angegeben werden.");
      }
      parsed.help = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new CliError("Unerwartetes CLI-Argument.");
    }
    const key = argument.slice(2);
    if (!valueFlags.has(key)) {
      throw new CliError("Unbekannte CLI-Option.");
    }
    if (Object.hasOwn(parsed, key)) {
      throw new CliError(`Option darf nur einmal angegeben werden: --${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliError(`Wert fuer --${key} fehlt.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requiredString(
  parsed: Record<string, string | boolean>,
  key: string,
) {
  const value = parsed[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new CliError(`--${key} ist erforderlich.`);
  }
  return value.trim();
}

function validateInput(parsed: Record<string, string | boolean>) {
  const organizationSlug = requiredString(parsed, "organization-slug")
    .toLowerCase();
  if (
    organizationSlug.length > 100 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(organizationSlug)
  ) {
    throw new CliError("Der Organisations-Slug ist ungueltig.");
  }

  const userEmail = requiredString(parsed, "user-email").toLowerCase();
  if (
    userEmail.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)
  ) {
    throw new CliError("Die Benutzer-E-Mail ist ungueltig.");
  }

  const outputPath = path.resolve(requiredString(parsed, "output"));
  if (path.extname(outputPath).toLowerCase() !== ".json") {
    throw new CliError("Der Output-Pfad muss auf .json enden.");
  }
  return { organizationSlug, userEmail, outputPath };
}

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new CliError("DATABASE_URL muss explizit gesetzt sein.");
  }
  try {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new CliError("DATABASE_URL ist ungueltig.");
  }
  return value;
}

function sensitiveMetadataKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    [
      "accesstoken",
      "apikey",
      "authorization",
      "bearer",
      "ciphertext",
      "clientsecret",
      "connectionstring",
      "cookie",
      "cronsecret",
      "csrftoken",
      "dataencryptionkey",
      "databaseurl",
      "dsn",
      "encryptionkey",
      "failurecode",
      "failuredetail",
      "idtoken",
      "jtihash",
      "keyhash",
      "password",
      "passwordhash",
      "privatekey",
      "refreshtoken",
      "requesthash",
      "securitytoken",
      "sessionsecret",
      "sessiontoken",
      "signature",
      "signingkey",
      "signingsecret",
      "signingsecretencrypted",
      "token",
      "tokenhash",
      "webhooksecret",
    ].includes(normalized) ||
    normalized.includes("credential") ||
    normalized.includes("failure") ||
    normalized.includes("signature") ||
    normalized.includes("secret") ||
    normalized.startsWith("claim") ||
    normalized.startsWith("storage") ||
    normalized.endsWith("authorization") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("ciphertext") ||
    normalized.endsWith("cookie") ||
    normalized.endsWith("cookies") ||
    normalized.endsWith("encryptionkey") ||
    normalized.endsWith("keyhash") ||
    normalized.endsWith("password") ||
    normalized.endsWith("passwordhash") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("securitytoken") ||
    normalized.endsWith("signingkey") ||
    normalized.endsWith("token") ||
    normalized.endsWith("tokenencrypted") ||
    normalized.endsWith("tokenhash")
  );
}

function sensitiveQueryParameter(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    sensitiveMetadataKey(key) ||
    ["auth", "code", "key", "sig"].includes(normalized) ||
    normalized.startsWith("xamz") ||
    normalized.startsWith("xgoog")
  );
}

function redactCredentialLikeString(value: string) {
  if (
    /^\s*(?:basic|bearer|digest)\s+\S+/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(value) ||
    /\bqak_[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/.test(
      value,
    )
  ) {
    return "[redacted]";
  }
  return value;
}

export function sanitizeExportUrl(value: string) {
  const credentialSafeValue = redactCredentialLikeString(value);
  if (credentialSafeValue !== value) return credentialSafeValue;

  const trimmed = value.trim();
  const isAbsoluteUrl = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const isRelativeUrl = /^(?:\.{0,2}\/|\?)/.test(trimmed);
  if (!isAbsoluteUrl && !isRelativeUrl) return value;

  try {
    const parsed = new URL(
      trimmed,
      isAbsoluteUrl ? undefined : "https://dsar.invalid",
    );
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (sensitiveQueryParameter(key)) parsed.searchParams.delete(key);
    }
    // OAuth and signed-download credentials are also commonly placed here.
    parsed.hash = "";
    if (isAbsoluteUrl) return parsed.toString();
    const sanitized = `${parsed.pathname}${parsed.search}`;
    return trimmed.startsWith("?") ? sanitized.replace(/^\//, "") : sanitized;
  } catch {
    return value;
  }
}

export function sanitizeExportMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExportMetadata);
  if (typeof value === "string") return sanitizeExportUrl(value);
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveMetadataKey(key))
      .map(([key, nested]) => [key, sanitizeExportMetadata(nested)]),
  );
}

export function sanitizeAiMessageCitations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const citation = entry as Record<string, unknown>;
    const hasInternalAgentSourceId = [
      citation.courseId,
      citation.lessonId,
      citation.pageId,
      citation.sourceId,
    ].some(
      (identifier) =>
        typeof identifier === "string" &&
        identifier.startsWith("agent-source:"),
    );
    const title =
      typeof citation.title === "string"
        ? redactCredentialLikeString(citation.title).slice(0, 220)
        : undefined;
    const href =
      typeof citation.href === "string"
        ? sanitizeExportUrl(citation.href)
        : undefined;
    const excerpt =
      !hasInternalAgentSourceId && typeof citation.excerpt === "string"
        ? redactCredentialLikeString(citation.excerpt).slice(0, 320)
        : undefined;
    const safeCitation = Object.fromEntries(
      Object.entries({ title, href, excerpt }).filter(
        ([, nested]) => typeof nested === "string" && nested.length > 0,
      ),
    );
    return Object.keys(safeCitation).length > 0 ? [safeCitation] : [];
  });
}

export function sanitizeAssessmentSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAssessmentSnapshot);
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
        return ![
          "acceptedanswers",
          "correctoption",
          "correctoptions",
          "correctorder",
          "feedback",
          "presentationorder",
        ].includes(normalized);
      })
      .map(([key, nested]) => [key, sanitizeAssessmentSnapshot(nested)]),
  );
}

const PRIVACY_EVENT_METADATA_KEYS = new Set([
  "artifactId",
  "artifactSha256",
  "attempt",
  "holdId",
  "policyVersion",
  "reasonCode",
  "requestType",
  "scope",
  "sizeBytes",
  "type",
]);

export function sanitizePrivacyEventMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => PRIVACY_EVENT_METADATA_KEYS.has(key))
      .map(([key, nested]) => [key, sanitizeExportMetadata(nested)]),
  );
}

const EXPORT_EXCLUDED_FIELDS = [
  {
    path: "data.notifications.nativePushDevices[].tokenHash|tokenEncrypted",
    reason: "native_push_capability_credential_material",
  },
  {
    path: "data.orbit.transfers[].idempotencyKey|requestHash|data.orbit.audit[].metadata.credentials",
    reason: "control_plane_replay_and_credential_material",
  },
  {
    path: "data.authenticationActivity.emailDeliveryHistory[].payload|responseBody|claimedAt",
    reason: "encrypted_delivery_and_operational_payload",
  },
  {
    path: "data.authenticationActivity.oidcConfigurationContext.issuer|clientId|clientSecretEncrypted",
    reason: "provider_endpoint_and_credential_material",
  },
  {
    path: "data.authenticationActivity.mfaConfiguration.secretEncrypted|recoveryCodeHashes|lastTotpCounter",
    reason: "second_factor_credential_material",
  },
  {
    path: "data.authenticationActivity.mfaChallenges[].jtiHash|oidcIdentityId",
    reason: "challenge_bearer_hash_and_internal_identity",
  },
  {
    path: "data.authenticationActivity.customDomainClaims[].challengeHash",
    reason: "custom_domain_challenge_hash",
  },
  {
    path: "data.integrations.apiCredentials[].prefix|keyHash",
    reason: "credential_material",
  },
  {
    path: "data.integrations.webhookConfigurations[].url|signingSecretEncrypted",
    reason: "credential_bearing_configuration",
  },
  {
    path: "data.integrations.webhookDeliveryHistory[].payload|responseBody|claimedAt",
    reason: "third_party_and_operational_payload",
  },
  {
    path: "data.integrations.apiIdempotency[].key|requestHash|claimToken|responseBody",
    reason: "credential_and_replay_material",
  },
  {
    path: "data.ai.conversations[].agentId|metadata|mutableAgentConfiguration|data.ai.authoredAgentVersions[].agentId|description|systemPrompt|draftRevision|color|icon|knowledgeMode|accessMode|createdById",
    reason: "mutable_or_protected_agent_configuration",
  },
  {
    path: "data.ai.agentAccessGrants[].grantId|subjectRole|subjectUserId|subjectGroupId|subjectBundleId|data.ai.agentVersionSources",
    reason: "foreign_grant_targets_and_internal_source_configuration",
  },
  {
    path: "data.ai.actionRequests[].agentId|agentVersionId|actionConfigurationId|conversationId|requestedById|targetCourseId|payloadDigest|decidedById|data.ai.actionEvents[].actorReference|payloadDigest|metadata",
    reason: "internal_action_binding_digest_and_pseudonymous_actor",
  },
  {
    path: "data.ai.messages[].toolCalls|metadata|citations[].courseId|lessonId|pageId|sourceId|internalAgentSourceExcerpt",
    reason: "internal_tool_grounding_and_source_identity",
  },
  {
    path: "data.privacy.requests[].subjectReference|policySnapshot|statusReason|processingClaim*",
    reason: "pseudonymous_internal_and_worker_metadata",
  },
  {
    path: "data.privacy.events[].actorReference|metadata.unapprovedFields",
    reason: "pseudonymous_actor_and_unreviewed_event_metadata",
  },
  {
    path: "data.community.reportsMade[].caseId|reporterId|targetAuthorId|handledById|resolutionNote|data.community.reportsAbout[].caseId|reporterId|targetAuthorId|handledById|details|resolutionNote",
    reason: "confidential_reporter_moderator_and_third_party_metadata",
  },
  {
    path: "data.community.posts[].moderationVersion|moderationFingerprint|moderatedById|data.community.comments[].moderationVersion|moderationFingerprint|moderatedById",
    reason: "internal_moderation_and_moderator_identity",
  },
  {
    path: "data.community.moderationCases[].targetAuthorId|contentVersion|claimedById|claimedAt|resolvedById|priority|policyVersion|decisionVersion|data.community.moderationAppeals[].appellantId|decisionVersion|resolvedById|resolutionNote",
    reason: "confidential_moderation_workflow_and_actor_identity",
  },
  {
    path: "data.community.moderationEvents|moderationAssessments",
    reason: "internal_notes_actor_identity_fingerprints_and_assessment_signals",
  },
  {
    path: "data.privacy.legalHolds[].subjectReference|reference|reason|legalBasis|releaseReason|actorIds",
    reason: "confidential_legal_and_third_party_metadata",
  },
  {
    path: "data.privacy.exportArtifacts[].storage*|failure*",
    reason: "storage_identity_and_internal_failure_metadata",
  },
] as const;

export async function buildUserDataExport(
  sql: Sql,
  organizationSlug: string,
  userEmail: string,
) {
  return sql.begin(
    "isolation level repeatable read read only",
    async (tx) => {
      const subjects = await tx`
        select
          o.id as "organizationId",
          o.name as "organizationName",
          o.slug as "organizationSlug",
          o.default_locale as "organizationDefaultLocale",
          u.id,
          u.email,
          u.first_name as "firstName",
          u.last_name as "lastName",
          u.avatar_url as "avatarUrl",
          u.role,
          u.status,
          u.job_title as "jobTitle",
          u.department,
          u.phone,
          u.bio,
          u.preferred_locale as "preferredLocale",
          u.points,
          u.community_points as "communityPoints",
          u.last_login_at as "lastLoginAt",
          u.created_at as "createdAt"
        from organizations o
        join users u on u.organization_id = o.id
        where lower(o.slug) = ${organizationSlug}
          and lower(u.email) = ${userEmail}
        order by o.id, u.id
        limit 2
      `;
      if (subjects.length !== 1) {
        throw new CliError(
          "Benutzer im angegebenen Tenant konnte nicht eindeutig aufgeloest werden.",
        );
      }
      const subject = subjects[0]!;

      const organizationId = subject.organizationId as string;
      const userId = subject.id as string;

      const customFields = await tx`
        select
          d.id as "fieldId",
          d.key,
          d.label,
          d.description,
          d.type,
          d.category,
          v.value,
          v.updated_at as "updatedAt"
        from custom_field_values v
        join custom_field_definitions d
          on d.id = v.field_id
         and d.organization_id = ${organizationId}
        where v.organization_id = ${organizationId}
          and v.user_id = ${userId}
        order by d.category, d.sort_order, d.label
      `;
      const dataProfiles = await tx`
        select
          p.id,
          p.name,
          p.is_default as "isDefault",
          p.active,
          p.created_at as "createdAt",
          p.updated_at as "updatedAt",
          d.id as "definitionId",
          d.key as "definitionKey",
          d.name as "definitionName"
        from member_data_profiles p
        join data_profile_definitions d
          on d.id = p.definition_id
         and d.organization_id = ${organizationId}
        where p.organization_id = ${organizationId}
          and p.user_id = ${userId}
        order by p.created_at, p.id
      `;
      const dataProfileValues = await tx`
        select
          v.id,
          v.profile_id as "profileId",
          p.name as "profileName",
          d.id as "fieldId",
          d.key,
          d.label,
          d.description,
          d.type,
          d.category,
          d.visibility,
          v.value,
          v.updated_at as "updatedAt"
        from data_profile_values v
        join member_data_profiles p
          on p.id = v.profile_id
         and p.user_id = ${userId}
         and p.organization_id = ${organizationId}
        join custom_field_definitions d
          on d.id = v.field_id
         and d.organization_id = ${organizationId}
        where v.organization_id = ${organizationId}
          and v.user_id = ${userId}
        order by p.created_at, d.category, d.label
      `;
      const dataFormSubmissions = await tx`
        select
          s.id,
          s.form_id as "formId",
          f.name as "formName",
          s.profile_id as "profileId",
          p.name as "profileName",
          s.source_type as "sourceType",
          s.source_id as "sourceId",
          s.response_snapshot as "responseSnapshot",
          s.submitted_at as "submittedAt",
          case when s.user_id = ${userId} then 'subject' else 'actor' end
            as relationship
        from data_form_submissions s
        join data_forms f
          on f.id = s.form_id
         and f.organization_id = ${organizationId}
        join member_data_profiles p
          on p.id = s.profile_id
         and p.organization_id = ${organizationId}
        where s.organization_id = ${organizationId}
          and (s.user_id = ${userId} or s.submitted_by_id = ${userId})
        order by s.submitted_at, s.id
      `;
      const sessions = await tx`
        select id, ip_address as "ipAddress", user_agent as "userAgent",
               auth_method as "authMethod",
               oidc_configuration_version as "oidcConfigurationVersion",
               authenticated_at as "authenticatedAt",
               oidc_auth_time as "oidcAuthTime",
               mfa_verified_at as "mfaVerifiedAt",
               mfa_method as "mfaMethod",
               expires_at as "expiresAt", last_seen_at as "lastSeenAt",
               revoked_at as "revokedAt", created_at as "createdAt"
        from user_sessions
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at
      `;
      const mfaConfigurations = await tx`
        select status, enabled_at as "enabledAt", created_at as "createdAt",
               updated_at as "updatedAt",
               cardinality(recovery_code_hashes)::int as "recoveryCodesRemaining"
        from user_mfa_configurations
        where organization_id = ${organizationId} and user_id = ${userId}
      `;
      const mfaChallenges = await tx`
        select mode, auth_method as "authMethod",
               expires_at as "expiresAt", consumed_at as "consumedAt",
               created_at as "createdAt"
        from mfa_login_challenges
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, id
      `;
      const mfaPolicy = await tx`
        select require_for_privileged as "requiredForPrivileged",
               revision, updated_at as "updatedAt"
        from organization_mfa_policies
        where organization_id = ${organizationId}
      `;
      const welcomeAcknowledgements = await tx`
        select configuration_version as "configurationVersion",
               acknowledged_at as "acknowledgedAt"
        from member_welcome_acknowledgements
        where organization_id = ${organizationId} and user_id = ${userId}
      `;
      const invitations = await tx`
        select id, email, expires_at as "expiresAt",
               accepted_at as "acceptedAt", created_at as "createdAt"
        from invitations
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at
      `;
      const passwordResetHistory = await tx`
        select id, expires_at as "expiresAt", used_at as "usedAt",
               created_at as "createdAt"
        from password_reset_tokens
        where user_id = ${userId}
        order by created_at
      `;
      const emailDeliveryHistory = await tx`
        select id, event, recipient_email as "recipientEmail", status, attempt,
               response_status as "responseStatus",
               next_retry_at as "nextRetryAt",
               delivered_at as "deliveredAt", created_at as "createdAt",
               updated_at as "updatedAt"
        from email_deliveries
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at
      `;
      const emailDeliveryFeedback = await tx`
        select feedback.event_type as "eventType",
               feedback.bounce_kind as "bounceKind",
               feedback.reason_code as "reasonCode",
               feedback.occurred_at as "occurredAt",
               feedback.processed_at as "processedAt",
               feedback.created_at as "createdAt"
        from email_delivery_feedback_events feedback
        join email_deliveries delivery
          on delivery.id = feedback.delivery_id
         and delivery.organization_id = feedback.organization_id
        where delivery.organization_id = ${organizationId}
          and delivery.user_id = ${userId}
        order by feedback.occurred_at, feedback.id
      `;
      const emailSuppressions = await tx`
        select reason, occurrence_count as "occurrenceCount",
               first_occurred_at as "firstOccurredAt",
               last_occurred_at as "lastOccurredAt",
               expires_at as "expiresAt", released_at as "releasedAt",
               release_reason as "releaseReason",
               created_at as "createdAt", updated_at as "updatedAt"
        from email_suppressions
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, id
      `;
      const oidcIdentities = await tx`
        select issuer, subject, email_at_link as "emailAtLink",
               last_configuration_version as "lastConfigurationVersion",
               last_login_at as "lastLoginAt", created_at as "createdAt"
        from oidc_identities
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, issuer, subject
      `;
      const oidcConfigurationContextRows = await tx`
        select enabled, display_name as "displayName",
               auto_provision_members as "autoProvisionMembers",
               allowed_email_domains as "allowedEmailDomains",
               password_login_enabled as "passwordLoginEnabled", version,
               created_at as "createdAt", updated_at as "updatedAt"
        from oidc_configurations
        where organization_id = ${organizationId}
        limit 1
      `;
      const customDomainClaims = await tx`
        select hostname, status, revision,
               challenge_expires_at as "challengeExpiresAt",
               last_checked_at as "lastCheckedAt",
               last_check_code as "lastCheckCode",
               verified_at as "verifiedAt", revoked_at as "revokedAt",
               created_at as "createdAt", updated_at as "updatedAt"
        from custom_domain_claims
        where organization_id = ${organizationId}
          and created_by_id = ${userId}
        order by created_at, id
      `;
      const groups = await tx`
        select g.id, g.name, g.description, g.color,
               gm.joined_at as "joinedAt"
        from group_members gm
        join groups g
          on g.id = gm.group_id
         and g.organization_id = ${organizationId}
        where gm.user_id = ${userId}
        order by g.name
      `;
      const directBundles = await tx`
        select b.id, b.name, b.description, b.active,
               mb.assigned_at as "assignedAt"
        from member_bundles mb
        join bundles b
          on b.id = mb.bundle_id
         and b.organization_id = ${organizationId}
        where mb.user_id = ${userId}
        order by mb.assigned_at
      `;
      const groupCourseAssignments = await tx`
        select g.id as "groupId", g.name as "groupName",
               c.id as "courseId", c.title as "courseTitle",
               c.slug as "courseSlug", gc.assigned_at as "assignedAt"
        from group_members gm
        join groups g
          on g.id = gm.group_id
         and g.organization_id = ${organizationId}
        join group_courses gc on gc.group_id = g.id
        join courses c
          on c.id = gc.course_id
         and c.organization_id = ${organizationId}
        where gm.user_id = ${userId}
        order by gc.assigned_at, g.id, c.id
      `;
      const groupBundleAssignments = await tx`
        select g.id as "groupId", g.name as "groupName",
               b.id as "bundleId", b.name as "bundleName",
               b.description as "bundleDescription", b.active,
               gb.assigned_at as "assignedAt"
        from group_members gm
        join groups g
          on g.id = gm.group_id
         and g.organization_id = ${organizationId}
        join group_bundles gb on gb.group_id = g.id
        join bundles b
          on b.id = gb.bundle_id
         and b.organization_id = ${organizationId}
        where gm.user_id = ${userId}
        order by gb.assigned_at, g.id, b.id
      `;
      const bundleCourseAssignments = await tx`
        select b.id as "bundleId", b.name as "bundleName",
               c.id as "courseId", c.title as "courseTitle",
               c.slug as "courseSlug", 'direct'::text as relationship,
               null::uuid as "groupId", null::varchar as "groupName",
               bc.available_from as "availableFrom",
               bc.available_until as "availableUntil",
               bc.delay_days as "delayDays", bc.visible,
               mb.assigned_at as "assignedAt"
        from member_bundles mb
        join bundles b
          on b.id = mb.bundle_id
         and b.organization_id = ${organizationId}
        join bundle_courses bc on bc.bundle_id = b.id
        join courses c
          on c.id = bc.course_id
         and c.organization_id = ${organizationId}
        where mb.user_id = ${userId}
        union all
        select b.id as "bundleId", b.name as "bundleName",
               c.id as "courseId", c.title as "courseTitle",
               c.slug as "courseSlug", 'group'::text as relationship,
               g.id as "groupId", g.name as "groupName",
               bc.available_from as "availableFrom",
               bc.available_until as "availableUntil",
               bc.delay_days as "delayDays", bc.visible,
               gb.assigned_at as "assignedAt"
        from group_members gm
        join groups g
          on g.id = gm.group_id
         and g.organization_id = ${organizationId}
        join group_bundles gb on gb.group_id = g.id
        join bundles b
          on b.id = gb.bundle_id
         and b.organization_id = ${organizationId}
        join bundle_courses bc on bc.bundle_id = b.id
        join courses c
          on c.id = bc.course_id
         and c.organization_id = ${organizationId}
        where gm.user_id = ${userId}
        order by "assignedAt", "bundleId", "courseId", "groupId" nulls first
      `;
      const courseAccessGrants = await tx`
        select g.id, g.course_id as "courseId", c.title as "courseTitle",
               c.slug as "courseSlug", g.source,
               g.created_at as "createdAt"
        from course_access_grants g
        join courses c
          on c.id = g.course_id
         and c.organization_id = ${organizationId}
        where g.organization_id = ${organizationId}
          and g.user_id = ${userId}
        order by g.created_at
      `;
      const courseCollaboratorPermissions = await tx`
        select cc.course_id as "courseId", c.title as "courseTitle",
               c.slug as "courseSlug", cc.permission,
               case
                 when cc.user_id = ${userId} and cc.granted_by_id = ${userId}
                   then 'assigned_trainer_and_grantor'
                 when cc.user_id = ${userId} then 'assigned_trainer'
                 else 'grantor'
               end as relationship,
               cc.granted_by_id as "grantedById",
               concat(granter.first_name, ' ', granter.last_name) as "grantedByName",
               cc.created_at as "createdAt", cc.updated_at as "updatedAt"
        from course_collaborators cc
        join courses c
          on c.id = cc.course_id
         and c.organization_id = cc.organization_id
        left join users granter
          on granter.id = cc.granted_by_id
         and granter.organization_id = cc.organization_id
        where cc.organization_id = ${organizationId}
          and (cc.user_id = ${userId} or cc.granted_by_id = ${userId})
        order by cc.created_at, cc.course_id
      `;
      const courseModuleAccessOverrides = await tx`
        select o.id, o.course_id as "courseId", c.title as "courseTitle",
               o.module_id as "moduleId", m.title as "moduleTitle",
               o.state, o.reason, o.expires_at as "expiresAt",
               o.created_by_id as "createdById",
               o.created_at as "createdAt", o.updated_at as "updatedAt"
        from course_module_access_overrides o
        join courses c
          on c.id = o.course_id
         and c.organization_id = ${organizationId}
        join modules m
          on m.id = o.module_id
         and m.organization_id = ${organizationId}
        where o.organization_id = ${organizationId}
          and o.user_id = ${userId}
        order by o.created_at, o.id
      `;
      const courseModuleAccessRequests = await tx`
        select r.id, r.course_id as "courseId", c.title as "courseTitle",
               r.module_id as "moduleId", m.title as "moduleTitle",
               r.status, r.message, r.decision_note as "decisionNote",
               r.decided_by_id as "decidedById",
               r.requested_at as "requestedAt", r.decided_at as "decidedAt"
        from course_module_access_requests r
        join courses c
          on c.id = r.course_id
         and c.organization_id = ${organizationId}
        join modules m
          on m.id = r.module_id
         and m.organization_id = ${organizationId}
        where r.organization_id = ${organizationId}
          and r.user_id = ${userId}
        order by r.requested_at, r.id
      `;
      const directHubAccess = await tx`
        select h.id as "hubId", h.title as "hubTitle", h.slug as "hubSlug",
               g.created_at as "createdAt"
        from hub_access_grants g
        join hubs h
          on h.id = g.hub_id
         and h.organization_id = ${organizationId}
        where g.subject_type = 'user' and g.subject_id = ${userId}
        order by g.created_at
      `;
      const enrollments = await tx`
        select e.id, e.course_id as "courseId", c.title as "courseTitle",
               c.slug as "courseSlug", e.status, e.access_active as "accessActive",
               e.progress, e.enrolled_at as "enrolledAt",
               e.last_accessed_at as "lastAccessedAt",
               e.completed_at as "completedAt"
        from enrollments e
        join courses c
          on c.id = e.course_id
         and c.organization_id = ${organizationId}
        where e.user_id = ${userId}
        order by e.enrolled_at
      `;
      const lessonProgress = await tx`
        select p.id, p.lesson_id as "lessonId", l.title as "lessonTitle",
               l.slug as "lessonSlug", m.id as "moduleId",
               m.title as "moduleTitle", p.status, p.percent,
               p.started_at as "startedAt", p.completed_at as "completedAt"
        from lesson_progress p
        join lessons l on l.id = p.lesson_id
        join modules m
          on m.id = l.module_id
         and m.organization_id = ${organizationId}
        where p.user_id = ${userId}
        order by p.started_at nulls first, p.id
      `;
      const lessonBookmarks = await tx`
        select b.course_id as "courseId", c.title as "courseTitle",
               b.module_id as "moduleId", m.title as "moduleTitle",
               b.lesson_id as "lessonId", l.title as "lessonTitle",
               b.created_at as "createdAt"
        from lesson_bookmarks b
        join courses c
          on c.id = b.course_id
         and c.organization_id = b.organization_id
        join modules m
          on m.id = b.module_id
         and m.organization_id = b.organization_id
        join lessons l
          on l.id = b.lesson_id
         and l.module_id = b.module_id
         and l.organization_id = b.organization_id
        where b.organization_id = ${organizationId}
          and b.user_id = ${userId}
        order by b.created_at, b.lesson_id
      `;
      const lessonLearningTime = await tx`
        select s.course_id as "courseId", c.title as "courseTitle",
               s.course_version_id as "courseVersionId",
               cv.version as "courseVersion",
               s.lesson_id as "lessonId", s.lesson_title as "lessonTitle",
               s.active_seconds as "activeSeconds",
               s.started_at as "startedAt",
               s.last_heartbeat_at as "lastHeartbeatAt"
        from lesson_learning_time_sessions s
        join courses c
          on c.id = s.course_id
         and c.organization_id = s.organization_id
        join course_versions cv
          on cv.id = s.course_version_id
         and cv.course_id = s.course_id
         and cv.organization_id = s.organization_id
        where s.organization_id = ${organizationId}
          and s.user_id = ${userId}
        order by s.started_at, s.id
      `;
      const mediaPlaybackProgress = await tx`
        select p.course_id as "courseId", c.title as "courseTitle",
               p.lesson_id as "lessonId", l.title as "lessonTitle",
               p.block_id as "blockId", p.media_asset_id as "mediaAssetId",
               p.watched_milliseconds as "watchedMilliseconds",
               p.furthest_milliseconds as "furthestMilliseconds",
               p.required_milliseconds as "requiredMilliseconds",
               p.completed_at as "completedAt", p.updated_at as "updatedAt"
        from media_playback_progress p
        join courses c
          on c.id = p.course_id and c.organization_id = p.organization_id
        join lessons l on l.id = p.lesson_id
        where p.organization_id = ${organizationId} and p.user_id = ${userId}
        order by p.updated_at, p.block_id
      `;
      const lessonAvailabilitySubscriptions = await tx`
        select s.id, s.course_id as "courseId", c.title as "courseTitle",
               s.lesson_id as "lessonId", l.title as "lessonTitle",
               s.subscribed_version_id as "subscribedVersionId",
               s.fulfilled_version_id as "fulfilledVersionId",
               case
                 when s.fulfilled_at is not null then 'fulfilled'
                 when s.cancelled_at is not null then 'cancelled'
                 else 'active'
               end as status,
               s.subscribed_at as "subscribedAt",
               s.cancelled_at as "cancelledAt",
               s.fulfilled_at as "fulfilledAt"
        from lesson_availability_subscriptions s
        join courses c
          on c.id = s.course_id
         and c.organization_id = s.organization_id
        join lessons l
          on l.id = s.lesson_id
         and l.organization_id = s.organization_id
        where s.organization_id = ${organizationId} and s.user_id = ${userId}
        order by s.subscribed_at, s.id
      `;
      const assessmentAttempts = await tx`
        select a.id, a.course_id as "courseId", c.title as "courseTitle",
               a.lesson_id as "lessonId", l.title as "lessonTitle",
               a.attempt_number as "attemptNumber", a.status, a.score,
               a.passed, a.question_count as "questionCount",
               a.correct_count as "correctCount", a.started_at as "startedAt",
               a.submitted_at as "submittedAt", a.graded_at as "gradedAt",
               a.course_version_id as "courseVersionId",
               a.question_order as "questionOrder",
               a.question_pools as "questionPools",
               a.question_presentation as "questionPresentation",
               a.draft_answers as "draftAnswers",
               a.draft_revision as "draftRevision",
               a.last_saved_at as "lastSavedAt",
               a.deadline_at as "deadlineAt",
               a.finalization_reason as "finalizationReason",
               a.result_release_mode as "resultReleaseMode",
               a.review_release_mode as "reviewReleaseMode",
               a.content_access_mode as "contentAccessMode",
               a.result_released_at as "resultReleasedAt",
               a.review_released_at as "reviewReleasedAt",
               a.assessment_snapshot as "assessmentSnapshot",
               a.created_at as "createdAt"
        from assessment_attempts a
        join courses c
          on c.id = a.course_id
         and c.organization_id = ${organizationId}
        join lessons l on l.id = a.lesson_id
        join modules m
          on m.id = l.module_id
         and m.organization_id = ${organizationId}
        where a.organization_id = ${organizationId} and a.user_id = ${userId}
        order by a.created_at
      `;
      const assessmentAnswers = await tx`
        select ans.id, ans.attempt_id as "attemptId",
               ans.block_id as "blockId",
               ans.question_snapshot - array[
                 'acceptedAnswers', 'correctOption', 'correctOptions',
                 'correctOrder', 'feedback', 'presentationOrder'
               ] as "questionSnapshot",
               ans.selected_option as "selectedOption",
               ans.answer_snapshot as "answerSnapshot",
               ans.correct, ans.answered_at as "answeredAt"
        from assessment_answers ans
        join assessment_attempts a
          on a.id = ans.attempt_id
         and a.organization_id = ${organizationId}
         and a.user_id = ${userId}
        join courses c
          on c.id = a.course_id
         and c.organization_id = ${organizationId}
        join lessons l on l.id = a.lesson_id
        join modules m
          on m.id = l.module_id
         and m.organization_id = ${organizationId}
        where ans.organization_id = ${organizationId}
        order by ans.answered_at
      `;
      const submissions = await tx`
        select s.id, s.course_id as "courseId", c.title as "courseTitle",
               case when lm.id is not null then s.lesson_id end as "lessonId",
               s.block_id as "blockId",
               s.attempt_number as "attemptNumber",
               s.supersedes_id as "supersedesId",
               s.title, s.type, s.content,
               s.content_format as "contentFormat",
               s.rich_text as "richText",
               s.content_projection_version as "contentProjectionVersion",
               s.file_name as "fileName", s.status, s.feedback, s.score,
               s.submitted_at as "submittedAt",
               s.reviewed_at as "reviewedAt"
        from submissions s
        join courses c
          on c.id = s.course_id
         and c.organization_id = ${organizationId}
        left join lessons l on l.id = s.lesson_id
        left join modules lm
          on lm.id = l.module_id
         and lm.organization_id = ${organizationId}
        where s.organization_id = ${organizationId} and s.user_id = ${userId}
        order by s.submitted_at
      `;
      const submissionReviews = await tx`
        select r.id, r.submission_id as "submissionId", r.decision,
               r.feedback, r.score, r.reviewed_at as "reviewedAt",
               case when r.reviewer_id = ${userId} then 'subject'
                    when r.reviewer_id is null then null
                    else 'staff' end as "reviewerRelationship"
        from submission_reviews r
        join submissions s
          on s.id = r.submission_id
         and s.organization_id = ${organizationId}
         and s.user_id = ${userId}
        where r.organization_id = ${organizationId}
        order by r.reviewed_at
      `;
      const submissionReviewAnnotations = await tx`
        select a.id, a.review_id as "reviewId",
               a.submission_id as "submissionId", a.type, a.body,
               a.start_offset as "startOffset", a.end_offset as "endOffset",
               a.media_asset_id as "mediaAssetId",
               a.timestamp_milliseconds as "timestampMilliseconds",
               a.sort_order as "sortOrder", a.created_at as "createdAt"
        from submission_review_annotations a
        join submission_reviews r
          on r.id = a.review_id
         and r.submission_id = a.submission_id
         and r.organization_id = ${organizationId}
        join submissions s
          on s.id = r.submission_id
         and s.organization_id = ${organizationId}
         and s.user_id = ${userId}
        where a.organization_id = ${organizationId}
        order by r.reviewed_at, a.sort_order, a.id
      `;
      const mediaAssets = await tx`
        select m.id, m.purpose, m.kind, m.status,
               m.original_file_name as "originalFileName",
               m.safe_file_name as "safeFileName",
               m.declared_mime_type as "declaredMimeType",
               m.detected_mime_type as "detectedMimeType",
               m.declared_size_bytes as "declaredSizeBytes",
               m.actual_size_bytes as "actualSizeBytes",
               (m.owner_user_id = ${userId}) as "ownedBySubject",
               (m.uploaded_by_id = ${userId}) as "uploadedBySubject",
               m.uploaded_at as "uploadedAt",
               m.scan_completed_at as "scanCompletedAt",
               m.scan_failure_code as "scanFailureCode",
               m.deleted_at as "deletedAt",
               m.created_at as "createdAt", m.updated_at as "updatedAt"
        from media_assets m
        where m.organization_id = ${organizationId}
          and (m.owner_user_id = ${userId} or m.uploaded_by_id = ${userId})
        order by m.created_at
      `;
      const mediaProcessingJobs = await tx`
        select j.id, j.source_asset_id as "sourceAssetId", j.type,
               j.provider, j.status, j.attempt,
               j.failure_code as "failureCode",
               j.created_at as "createdAt", j.updated_at as "updatedAt",
               j.completed_at as "completedAt",
               case when j.requested_by_id = ${userId}
                    then 'requestedBySubject'
                    else 'subjectMedia' end as relationship
        from media_processing_jobs j
        join media_assets m
          on m.id = j.source_asset_id
         and m.organization_id = j.organization_id
        where j.organization_id = ${organizationId}
          and (
            j.requested_by_id = ${userId}
            or m.owner_user_id = ${userId}
            or m.uploaded_by_id = ${userId}
          )
        order by j.created_at, j.id
      `;
      const submissionAttachments = await tx`
        select a.id, a.submission_id as "submissionId",
               a.media_asset_id as "mediaAssetId", a.sort_order as "sortOrder",
               m.original_file_name as "originalFileName",
               m.declared_mime_type as "declaredMimeType",
               m.declared_size_bytes as "declaredSizeBytes",
               a.created_at as "createdAt"
        from submission_attachments a
        join submissions s
          on s.id = a.submission_id
         and s.organization_id = ${organizationId}
         and s.user_id = ${userId}
        join media_assets m
          on m.id = a.media_asset_id
         and m.organization_id = a.organization_id
        where a.organization_id = ${organizationId}
        order by s.submitted_at, a.sort_order, a.id
      `;
      const courseMediaBindings = await tx`
        select b.course_id as "courseId", c.title as "courseTitle",
               b.media_asset_id as "mediaAssetId",
               m.original_file_name as "originalFileName",
               m.declared_mime_type as "declaredMimeType",
               m.declared_size_bytes as "declaredSizeBytes",
               (b.attached_by_id = ${userId}) as "attachedBySubject",
               (m.owner_user_id = ${userId}) as "ownedBySubject",
               (m.uploaded_by_id = ${userId}) as "uploadedBySubject",
               b.created_at as "attachedAt"
        from course_media_assets b
        join courses c
          on c.id = b.course_id
         and c.organization_id = b.organization_id
        join media_assets m
          on m.id = b.media_asset_id
         and m.organization_id = b.organization_id
        where b.organization_id = ${organizationId}
          and (
            b.attached_by_id = ${userId}
            or m.owner_user_id = ${userId}
            or m.uploaded_by_id = ${userId}
          )
        order by b.created_at, b.media_asset_id
      `;
      const certificates = await tx`
        select c.id, c.course_id as "courseId",
               c.certificate_number as "certificateNumber",
               c.recipient_name as "recipientName",
               c.course_title as "courseTitle",
               c.organization_name as "organizationName",
               c.completed_at as "completedAt", c.issued_at as "issuedAt",
               c.revoked_at as "revokedAt",
               c.revocation_reason as "revocationReason"
        from course_certificates c
        join courses course
          on course.id = c.course_id
         and course.organization_id = ${organizationId}
        where c.organization_id = ${organizationId} and c.user_id = ${userId}
        order by c.issued_at
      `;
      const feedback = await tx`
        select f.id,
               case when c.id is not null then f.course_id end as "courseId",
               case when lm.id is not null then f.lesson_id end as "lessonId",
               f.type, f.rating, f.content,
               f.testimonial_consent as "testimonialConsent", f.status,
               f.reviewed_at as "reviewedAt", f.created_at as "createdAt"
        from feedback_entries f
        left join courses c
          on c.id = f.course_id
         and c.organization_id = ${organizationId}
        left join lessons l on l.id = f.lesson_id
        left join modules lm
          on lm.id = l.module_id
         and lm.organization_id = ${organizationId}
        where f.organization_id = ${organizationId} and f.user_id = ${userId}
        order by f.created_at
      `;
      const posts = await tx`
        select p.id, p.space_id as "spaceId", s.title as "spaceTitle",
               s.type as "spaceType", a.id as "areaId",
               a.title as "areaTitle", p.title, p.content,
               p.content_format as "contentFormat",
               p.rich_text as "richText",
               p.content_projection_version as "contentProjectionVersion",
               p.linked_course_id as "courseId",
               p.image_url as "imageUrl", p.pinned, p.locked,
               p.moderation_state as "moderationState",
               p.published_at as "publishedAt",
               p.moderated_at as "moderatedAt",
               p.created_at as "createdAt",
               p.updated_at as "updatedAt"
        from posts p
        join community_spaces s
          on s.id = p.space_id
         and s.organization_id = ${organizationId}
        join community_areas a
          on a.id = s.area_id
         and a.organization_id = s.organization_id
        where p.organization_id = ${organizationId} and p.author_id = ${userId}
        order by p.created_at
      `;
      const comments = await tx`
        select c.id, c.post_id as "postId", c.parent_id as "parentId",
               c.content, c.content_format as "contentFormat",
               c.rich_text as "richText",
               c.content_projection_version as "contentProjectionVersion",
               c.moderation_state as "moderationState",
               c.published_at as "publishedAt",
               c.moderated_at as "moderatedAt",
               c.created_at as "createdAt",
               c.updated_at as "updatedAt"
        from comments c
        join posts p
          on p.id = c.post_id
         and p.organization_id = ${organizationId}
        where c.organization_id = ${organizationId}
          and c.author_id = ${userId}
        order by c.created_at
      `;
      const communityPostAttachments = await tx`
        select a.id, a.post_id as "postId",
               a.media_asset_id as "mediaAssetId", a.sort_order as "sortOrder",
               m.original_file_name as "originalFileName",
               coalesce(m.detected_mime_type, m.declared_mime_type) as "mimeType",
               coalesce(m.actual_size_bytes, m.declared_size_bytes) as "sizeBytes",
               a.created_at as "createdAt"
        from community_post_attachments a
        join posts p
          on p.id = a.post_id
         and p.organization_id = a.organization_id
         and p.author_id = ${userId}
        join media_assets m
          on m.id = a.media_asset_id
         and m.organization_id = a.organization_id
        where a.organization_id = ${organizationId}
        order by p.created_at, a.sort_order, a.id
      `;
      const communityCommentAttachments = await tx`
        select a.id, a.comment_id as "commentId", a.post_id as "postId",
               a.media_asset_id as "mediaAssetId", a.sort_order as "sortOrder",
               m.original_file_name as "originalFileName",
               coalesce(m.detected_mime_type, m.declared_mime_type) as "mimeType",
               coalesce(m.actual_size_bytes, m.declared_size_bytes) as "sizeBytes",
               a.created_at as "createdAt"
        from community_comment_attachments a
        join comments c
          on c.id = a.comment_id
         and c.post_id = a.post_id
         and c.organization_id = a.organization_id
         and c.author_id = ${userId}
        join media_assets m
          on m.id = a.media_asset_id
         and m.organization_id = a.organization_id
        where a.organization_id = ${organizationId}
        order by c.created_at, a.sort_order, a.id
      `;
      const communityAccessRules = await tx`
        select r.id, r.space_id as "spaceId", s.title as "spaceTitle",
               r.can_view as "canView", r.can_post as "canPost",
               r.can_comment as "canComment", r.created_at as "createdAt",
               r.updated_at as "updatedAt"
        from community_space_access_rules r
        join community_spaces s
          on s.id = r.space_id
         and s.organization_id = r.organization_id
        where r.organization_id = ${organizationId}
          and r.subject_type = 'user'
          and r.subject_user_id = ${userId}
        order by s.title, r.created_at
      `;
      const communityEffectiveSpaceAccess = await tx`
        select s.id as "spaceId", s.title as "spaceTitle",
               s.type as "spaceType", s.access_mode as "accessMode",
               case
                 when u.status <> 'active' then false
                 when u.role in ('owner', 'admin') then true
                 when s.access_mode = 'open' then true
                 else coalesce(bool_or(r.can_view), false)
               end as "canView",
               case
                 when u.status <> 'active' then false
                 when s.type = 'announcement' then u.role in ('owner', 'admin')
                 when u.role in ('owner', 'admin') then true
                 when s.access_mode = 'open' then true
                 else coalesce(bool_or(r.can_view), false)
                   and coalesce(bool_or(r.can_post), false)
               end as "canPost",
               case
                 when u.status <> 'active' then false
                 when s.type = 'announcement' then false
                 when u.role in ('owner', 'admin') then true
                 when s.access_mode = 'open' then true
                 else coalesce(bool_or(r.can_view), false)
                   and coalesce(bool_or(r.can_comment), false)
               end as "canComment",
               coalesce(
                 array_agg(distinct r.subject_type::text)
                   filter (where r.id is not null),
                 array[]::text[]
               ) as "matchedSourceTypes"
        from community_spaces s
        join users u
          on u.id = ${userId}
         and u.organization_id = ${organizationId}
        left join community_space_access_rules r
          on r.space_id = s.id
         and r.organization_id = s.organization_id
         and (
           (r.subject_type = 'role' and r.subject_role = u.role)
           or (r.subject_type = 'user' and r.subject_user_id = u.id)
           or (
             r.subject_type = 'group'
             and exists (
               select 1
               from group_members gm
               join groups g
                 on g.id = gm.group_id
                and g.organization_id = s.organization_id
               where gm.user_id = u.id
                 and gm.group_id = r.subject_group_id
             )
           )
           or (
             r.subject_type = 'bundle'
             and (
               exists (
                 select 1
                 from member_bundles mb
                 join bundles b
                   on b.id = mb.bundle_id
                  and b.organization_id = s.organization_id
                  and b.active = true
                 where mb.user_id = u.id
                   and mb.bundle_id = r.subject_bundle_id
               )
               or exists (
                 select 1
                 from group_members gm
                 join groups g
                   on g.id = gm.group_id
                  and g.organization_id = s.organization_id
                 join group_bundles gb on gb.group_id = g.id
                 join bundles b
                   on b.id = gb.bundle_id
                  and b.organization_id = s.organization_id
                  and b.active = true
                 where gm.user_id = u.id
                   and gb.bundle_id = r.subject_bundle_id
               )
             )
           )
         )
        where s.organization_id = ${organizationId}
        group by s.id, s.title, s.type, s.access_mode, u.role, u.status
        having s.access_mode = 'open'
          or count(r.id) > 0
          or (u.status = 'active' and u.role in ('owner', 'admin'))
        order by s.title, s.id
      `;
      const likes = await tx`
        select l.post_id as "postId", l.reaction,
               l.created_at as "createdAt"
        from post_likes l
        join posts p
          on p.id = l.post_id
         and p.organization_id = ${organizationId}
        where l.organization_id = ${organizationId}
          and l.user_id = ${userId}
        order by l.created_at
      `;
      const commentReactionsMade = await tx`
        select r.comment_id as "commentId", r.post_id as "postId",
               r.reaction, r.created_at as "createdAt"
        from comment_reactions r
        join comments c
          on c.id = r.comment_id
         and c.post_id = r.post_id
         and c.organization_id = r.organization_id
        where r.organization_id = ${organizationId}
          and r.user_id = ${userId}
        order by r.created_at, r.comment_id
      `;
      const commentReactionsReceived = await tx`
        select r.reaction, count(*)::int as count
        from comment_reactions r
        join comments c
          on c.id = r.comment_id
         and c.post_id = r.post_id
         and c.organization_id = r.organization_id
        where r.organization_id = ${organizationId}
          and c.author_id = ${userId}
        group by r.reaction
        order by r.reaction
      `;
      const communityScoreContributions = await tx`
        select contribution.id, contribution.kind, contribution.points,
               case
                 when contribution.recipient_id = ${userId} then 'received'
                 else 'generated'
               end as relationship,
               case
                 when contribution.post_id is not null then 'post_reaction'
                 when contribution.comment_id is not null then 'comment'
                 else 'comment_reaction'
               end as "sourceType",
               coalesce(
                 contribution.post_id,
                 contribution.comment_id,
                 contribution.reaction_comment_id
               ) as "sourceId",
               contribution.created_at as "createdAt"
        from community_score_contributions contribution
        where contribution.organization_id = ${organizationId}
          and (
            contribution.recipient_id = ${userId}
            or contribution.actor_id = ${userId}
          )
        order by contribution.created_at, contribution.id
      `;
      const votes = await tx`
        select v.post_id as "postId", v.value,
               v.created_at as "createdAt", v.updated_at as "updatedAt"
        from post_votes v
        join posts p
          on p.id = v.post_id
         and p.organization_id = ${organizationId}
        where v.organization_id = ${organizationId}
          and v.user_id = ${userId}
        order by v.created_at
      `;
      const communityFollows = await tx`
        select target_type as "targetType",
               target_author_id as "targetAuthorId",
               target_space_id as "targetSpaceId",
               notify, created_at as "createdAt", updated_at as "updatedAt"
        from community_follows
        where organization_id = ${organizationId}
          and follower_id = ${userId}
        order by created_at, id
      `;
      const [communityFollowerSummary] = await tx`
        select count(*)::int as "authorFollowerCount"
        from community_follows
        where organization_id = ${organizationId}
          and target_type = 'author'
          and target_author_id = ${userId}
      `;
      const communityAuthorBoosts = await tx`
        select id, author_id as "authorId", strength,
               starts_at as "startsAt", ends_at as "endsAt", reason,
               (created_by_id = ${userId}) as "administeredBySubject",
               created_at as "createdAt", updated_at as "updatedAt"
        from community_author_boosts
        where organization_id = ${organizationId}
          and (author_id = ${userId} or created_by_id = ${userId})
        order by created_at, id
      `;
      const mentionsMade = await tx`
        select m.id, m.post_id as "postId", m.comment_id as "commentId",
               m.handle, m.created_at as "createdAt"
        from community_mentions m
        where m.organization_id = ${organizationId}
          and m.mentioned_by_id = ${userId}
        order by m.created_at
      `;
      const mentionsReceived = await tx`
        select m.id, m.post_id as "postId", m.comment_id as "commentId",
               m.handle, m.created_at as "createdAt"
        from community_mentions m
        where m.organization_id = ${organizationId}
          and m.mentioned_user_id = ${userId}
        order by m.created_at
      `;
      const communityReportsMade = await tx`
        select id, target_type as "targetType", target_id as "targetId",
               content_excerpt as "contentExcerpt", reason, details, status,
               outcome, resolved_at as "resolvedAt", created_at as "createdAt",
               updated_at as "updatedAt"
        from community_reports
        where organization_id = ${organizationId}
          and reporter_id = ${userId}
        order by created_at
      `;
      const communityReportsAbout = await tx`
        select id, target_type as "targetType", target_id as "targetId",
               content_excerpt as "contentExcerpt", reason, status, outcome,
               resolved_at as "resolvedAt", created_at as "createdAt",
               updated_at as "updatedAt"
        from community_reports
        where organization_id = ${organizationId}
          and target_author_id = ${userId}
          and reporter_id is distinct from ${userId}
        order by created_at
      `;
      const communityModerationCases = await tx`
        select mc.id, mc.target_type as "targetType",
               mc.target_id as "targetId",
               case
                 when mc.target_type = 'post' then target_post.moderation_state
                 when mc.target_type = 'comment' then target_comment.moderation_state
               end as "contentState",
               mc.reason as "reasonCode", mc.status,
               case
                 when mc.target_type = 'post' then target_post.published_at
                 when mc.target_type = 'comment' then target_comment.published_at
               end as "contentPublishedAt",
               case
                 when mc.target_type = 'post' then target_post.moderated_at
                 when mc.target_type = 'comment' then target_comment.moderated_at
               end as "contentModeratedAt",
               mc.created_at as "openedAt",
               mc.resolved_at as "resolvedAt",
               mc.updated_at as "updatedAt"
        from community_moderation_cases mc
        left join posts target_post
          on mc.target_type = 'post'
         and target_post.id = mc.target_id
         and target_post.organization_id = mc.organization_id
        left join comments target_comment
          on mc.target_type = 'comment'
         and target_comment.id = mc.target_id
         and target_comment.organization_id = mc.organization_id
        where mc.organization_id = ${organizationId}
          and (
            mc.target_author_id = ${userId}
            or target_post.author_id = ${userId}
            or target_comment.author_id = ${userId}
          )
        order by mc.created_at, mc.id
      `;
      const communityModerationAppeals = await tx`
        select appeal.id, appeal.case_id as "caseId", appeal.statement,
               appeal.resolution_action as "result",
               appeal.resolved_at as "resolvedAt",
               appeal.created_at as "createdAt",
               appeal.updated_at as "updatedAt"
        from community_moderation_appeals appeal
        join community_moderation_cases mc
          on mc.id = appeal.case_id
         and mc.organization_id = appeal.organization_id
        where appeal.organization_id = ${organizationId}
          and appeal.appellant_id = ${userId}
        order by appeal.created_at, appeal.id
      `;
      const eventAttendance = await tx`
        select e.id as "eventId", e.title as "eventTitle", e.type,
               e.starts_at as "startsAt", e.ends_at as "endsAt", e.location,
               a.status, a.responded_at as "respondedAt"
        from event_attendees a
        join events e
          on e.id = a.event_id
         and e.organization_id = ${organizationId}
        where a.user_id = ${userId}
        order by e.starts_at
      `;
      const directEventAudience = await tx`
        select g.id as "grantId", e.id as "eventId",
               e.title as "eventTitle", e.type, e.starts_at as "startsAt",
               e.ends_at as "endsAt", g.created_at as "createdAt"
        from event_audience_grants g
        join events e
          on e.id = g.event_id
         and e.organization_id = ${organizationId}
        where g.organization_id = ${organizationId} and g.user_id = ${userId}
        order by e.starts_at
      `;
      const createdEvents = await tx`
        select id, title, description, type, starts_at as "startsAt",
               ends_at as "endsAt", location, capacity,
               audience_mode as "audienceMode", created_at as "createdAt"
        from events
        where organization_id = ${organizationId} and created_by_id = ${userId}
        order by created_at
      `;
      const pointTransactions = await tx`
        select id, amount, reason, entity_type as "entityType",
               entity_id as "entityId", created_at as "createdAt"
        from point_transactions
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at
      `;
      const badges = await tx`
        select ub.id, b.id as "badgeId", b.name, b.slug, b.description,
               b.icon, b.color, ub.source, ub.awarded_at as "awardedAt"
        from user_badges ub
        join badge_definitions b
          on b.id = ub.badge_id
         and b.organization_id = ${organizationId}
        where ub.organization_id = ${organizationId} and ub.user_id = ${userId}
        order by ub.awarded_at
      `;
      const notifications = await tx`
        select id, title, body, type, category, href, read,
               created_at as "createdAt"
        from notifications
        where user_id = ${userId}
        order by created_at
      `;
      const notificationPreferences = await tx`
        select category, email_enabled as "emailEnabled",
               push_enabled as "pushEnabled", updated_at as "updatedAt"
        from user_notification_preferences
        where organization_id = ${organizationId} and user_id = ${userId}
        order by category
      `;
      const webPushSubscriptions = await tx`
        select id, expires_at as "expiresAt", created_at as "createdAt",
               updated_at as "updatedAt"
        from web_push_subscriptions
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, id
      `;
      const nativePushDevices = await tx`
        select id, platform, app_id as "appId",
               created_at as "createdAt", updated_at as "updatedAt"
        from native_push_devices
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, id
      `;
      const nativePushDeliveryHistory = await tx`
        select id, notification_id as "notificationId",
               device_id as "deviceId", status, attempt,
               response_status as "responseStatus",
               next_retry_at as "nextRetryAt", delivered_at as "deliveredAt",
               created_at as "createdAt", updated_at as "updatedAt"
        from native_push_deliveries
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, id
      `;
      const pushDeliveryHistory = await tx`
        select id, notification_id as "notificationId", status, attempt,
               response_status as "responseStatus",
               next_retry_at as "nextRetryAt",
               delivered_at as "deliveredAt", created_at as "createdAt",
               updated_at as "updatedAt"
        from push_notification_deliveries
        where organization_id = ${organizationId} and user_id = ${userId}
        order by created_at, id
      `;
      const announcementDismissals = await tx`
        select a.id as "announcementId", a.title as "announcementTitle",
               d.dismissed_at as "dismissedAt"
        from announcement_dismissals d
        join announcements a
          on a.id = d.announcement_id
         and a.organization_id = ${organizationId}
        where d.user_id = ${userId}
        order by d.dismissed_at
      `;
      const announcementInteractions = await tx`
        select i.announcement_id as "announcementId",
               a.title as "announcementTitle", i.kind,
               i.occurred_at as "occurredAt"
        from announcement_interactions i
        join announcements a
          on a.id = i.announcement_id
         and a.organization_id = i.organization_id
        where i.organization_id = ${organizationId}
          and i.user_id = ${userId}
        order by i.occurred_at, i.announcement_id, i.kind
      `;
      const directAnnouncements = await tx`
        select id, title, body, tone, placement, href,
               action_label as "actionLabel", starts_at as "startsAt",
               ends_at as "endsAt", active, created_at as "createdAt",
               updated_at as "updatedAt"
        from announcements
        where organization_id = ${organizationId}
          and audience = 'user'
          and audience_id = ${userId}
        order by starts_at, id
      `;
      const [externalAiUseTable] = await tx`
        select to_regclass('public.ai_external_use_acknowledgements')::text as name
      `;
      const externalAiUseAcknowledgements = externalAiUseTable?.name
        ? await tx`
            select notice_version as "noticeVersion",
                   notice_digest as "noticeDigest",
                   privacy_policy_url as "privacyPolicyUrl",
                   transparency_policy_url as "transparencyPolicyUrl",
                   acknowledged_at as "acknowledgedAt"
            from ai_external_use_acknowledgements
            where organization_id = ${organizationId} and user_id = ${userId}
            order by acknowledged_at, id
          `
        : [];
      const conversations = await tx`
        select c.id, c.agent_version_id as "agentVersionId", c.title,
               c.status, c.message_count as "messageCount",
               c.last_message_at as "lastMessageAt",
               v.name as "agentVersionName", v.type as "agentVersionType",
               v.version as "agentVersionNumber",
               v.published_at as "agentVersionPublishedAt",
               c.created_at as "createdAt", c.updated_at as "updatedAt"
        from ai_conversations c
        join ai_agent_versions v
          on v.id = c.agent_version_id
         and v.agent_id = c.agent_id
         and v.organization_id = ${organizationId}
        where c.organization_id = ${organizationId} and c.user_id = ${userId}
        order by c.created_at
      `;
      const messages = await tx`
        select m.id, m.conversation_id as "conversationId", m.role, m.content,
               m.input_tokens as "inputTokens",
               m.output_tokens as "outputTokens", m.latency_ms as "latencyMs",
               m.provider, m.model, m.citations,
               m.created_at as "createdAt"
        from ai_messages m
        join ai_conversations c
          on c.id = m.conversation_id
         and c.organization_id = ${organizationId}
         and c.user_id = ${userId}
        where m.organization_id = ${organizationId}
          and m.role in ('user', 'assistant')
        order by m.created_at
      `;
      const authoredAgentVersions = await tx`
        select v.id as "agentVersionId", v.name, v.type, v.version,
               v.published_at as "publishedAt"
        from ai_agent_versions v
        where v.organization_id = ${organizationId}
          and v.created_by_id = ${userId}
        order by v.created_at, v.id
      `;
      const agentAccessGrants = await tx`
        select v.id as "agentVersionId", v.name, v.type, v.version,
               v.published_at as "publishedAt",
               case g.subject_type
                 when 'user' then 'direct_user'
                 when 'role' then 'role'
                 when 'group' then 'group'
                 when 'bundle' then 'bundle'
               end as relationship
        from ai_agent_version_access_grants g
        join ai_agent_versions v
          on v.id = g.agent_version_id
         and v.organization_id = g.organization_id
         and v.state = 'published'
        where g.organization_id = ${organizationId}
          and (
            (g.subject_type = 'user' and g.subject_user_id = ${userId})
            or (g.subject_type = 'role' and g.subject_role = ${subject.role})
            or (
              g.subject_type = 'group'
              and exists (
                select 1
                from group_members gm
                join groups subject_group
                  on subject_group.id = gm.group_id
                 and subject_group.organization_id = ${organizationId}
                where gm.user_id = ${userId}
                  and gm.group_id = g.subject_group_id
              )
            )
            or (
              g.subject_type = 'bundle'
              and (
                exists (
                  select 1
                  from member_bundles mb
                  join bundles subject_bundle
                    on subject_bundle.id = mb.bundle_id
                   and subject_bundle.organization_id = ${organizationId}
                  where mb.user_id = ${userId}
                    and mb.bundle_id = g.subject_bundle_id
                )
                or exists (
                  select 1
                  from group_members gm
                  join groups subject_group
                    on subject_group.id = gm.group_id
                   and subject_group.organization_id = ${organizationId}
                  join group_bundles gb on gb.group_id = subject_group.id
                  join bundles subject_bundle
                    on subject_bundle.id = gb.bundle_id
                   and subject_bundle.organization_id = ${organizationId}
                  where gm.user_id = ${userId}
                    and gb.bundle_id = g.subject_bundle_id
                )
              )
            )
          )
        order by v.published_at, v.id, relationship
      `;
      const agentActionRequests = await tx`
        select request.id, request.action_type as "actionType",
               request.label_snapshot as label, request.status,
               request.revision, request.decision_note as "decisionNote",
               request.requested_at as "requestedAt",
               request.expires_at as "expiresAt",
               request.decided_at as "decidedAt",
               request.executed_at as "executedAt",
               request.updated_at as "updatedAt",
               version.name as "agentName",
               version.type as "agentType",
               version.version as "agentVersion",
               request.target_type as "targetType",
               coalesce(course.title, subject_group.name, bundle.name) as "targetLabel"
        from ai_agent_action_requests request
        join ai_agent_versions version
          on version.id = request.agent_version_id
         and version.organization_id = request.organization_id
        left join courses course
          on course.id = request.target_course_id
         and course.organization_id = request.organization_id
        left join groups subject_group
          on subject_group.id = request.target_group_id
         and subject_group.organization_id = request.organization_id
        left join bundles bundle
          on bundle.id = request.target_bundle_id
         and bundle.organization_id = request.organization_id
        where request.organization_id = ${organizationId}
          and request.requested_by_id = ${userId}
        order by request.requested_at, request.id
      `;
      const agentActionEvents = await tx`
        select event.id, event.request_id as "requestId", event.event,
               event.from_status as "fromStatus",
               event.to_status as "toStatus", event.revision,
               event.created_at as "createdAt"
        from ai_agent_action_events event
        join ai_agent_action_requests request
          on request.id = event.request_id
         and request.organization_id = event.organization_id
        where event.organization_id = ${organizationId}
          and request.requested_by_id = ${userId}
        order by event.created_at, event.id
      `;
      const agentMembershipProvenance = await tx`
        select provenance.target_type as "targetType",
               coalesce(subject_group.name, bundle.name) as "targetLabel",
               provenance.granted_at as "grantedAt",
               provenance.revoked_at as "revokedAt",
               provenance.revocation_reason as "revocationReason"
        from ai_agent_membership_provenance provenance
        left join groups subject_group
          on subject_group.id = provenance.target_group_id
         and subject_group.organization_id = provenance.organization_id
        left join bundles bundle
          on bundle.id = provenance.target_bundle_id
         and bundle.organization_id = provenance.organization_id
        where provenance.organization_id = ${organizationId}
          and provenance.member_id = ${userId}
        order by provenance.granted_at, provenance.id
      `;
      const apiCredentials = await tx`
        select id, name, scopes, status, last_used_at as "lastUsedAt",
               expires_at as "expiresAt", revoked_at as "revokedAt",
               created_at as "createdAt"
        from api_keys
        where organization_id = ${organizationId} and created_by_id = ${userId}
        order by created_at
      `;
      const webhookConfigurations = await tx`
        select id, name, events, active,
               last_delivery_at as "lastDeliveryAt",
               created_at as "createdAt", updated_at as "updatedAt"
        from webhooks
        where organization_id = ${organizationId} and created_by_id = ${userId}
        order by created_at
      `;
      const webhookDeliveryHistory = await tx`
        select d.id, d.webhook_id as "webhookId", d.event,
               d.status, d.attempt, d.response_status as "responseStatus",
               d.duration_ms as "durationMs",
               d.next_retry_at as "nextRetryAt",
               d.delivered_at as "deliveredAt",
               d.created_at as "createdAt", d.updated_at as "updatedAt",
               coalesce((
                 select jsonb_agg(
                   jsonb_build_object(
                     'id', attempt.id,
                     'replayGeneration', attempt.replay_generation,
                     'attempt', attempt.attempt,
                     'outcome', attempt.outcome,
                     'responseStatus', attempt.response_status,
                     'responseBodyRedacted', attempt.response_body_redacted,
                     'failureKind', attempt.failure_kind,
                     'durationMs', attempt.duration_ms,
                     'startedAt', attempt.started_at,
                     'completedAt', attempt.completed_at
                   ) order by attempt.completed_at, attempt.id
                 )
                 from webhook_delivery_attempts attempt
                 where attempt.organization_id = d.organization_id
                   and attempt.delivery_id = d.id
               ), '[]'::jsonb) as attempts
        from webhook_deliveries d
        join webhooks w
          on w.id = d.webhook_id
         and w.organization_id = ${organizationId}
        where d.organization_id = ${organizationId}
          and jsonb_path_exists(
            d.payload,
            '$.** ? (@ == $subjectId)',
            jsonb_build_object('subjectId', to_jsonb(${userId}::text))
          )
        order by d.created_at
      `;
      const apiIdempotency = await tx`
        select i.id, i.api_key_id as "apiCredentialId", i.method, i.path,
               i.status, i.response_status as "responseStatus",
               i.expires_at as "expiresAt", i.created_at as "createdAt"
        from api_idempotency_keys i
        join api_keys k
          on k.id = i.api_key_id
         and k.organization_id = ${organizationId}
         and k.created_by_id = ${userId}
        where i.organization_id = ${organizationId}
        order by i.created_at
      `;
      const privacyCases = await tx`
        select r.id, r.client_request_id as "clientRequestId", r.type,
               r.status, r.due_at as "dueAt",
               r.identity_verified_at as "identityVerifiedAt",
               r.approved_at as "approvedAt",
               r.processing_started_at as "processingStartedAt",
               r.completed_at as "completedAt",
               r.backup_expires_at as "backupExpiresAt",
               r.policy_version as "policyVersion",
               r.created_at as "createdAt", r.updated_at as "updatedAt"
        from privacy_requests r
        where r.organization_id = ${organizationId}
          and r.subject_user_id = ${userId}
        order by r.created_at, r.id
      `;
      const privacyEvents = await tx`
        select e.id, e.request_id as "requestId", e.event,
               e.from_status as "fromStatus", e.to_status as "toStatus",
               e.metadata, e.created_at as "createdAt"
        from privacy_request_events e
        join privacy_requests r
          on r.id = e.request_id
         and r.organization_id = e.organization_id
         and r.subject_user_id = ${userId}
        where e.organization_id = ${organizationId}
        order by e.created_at, e.id
      `;
      const privacyLegalHolds = await tx`
        select h.id, h.request_id as "requestId", h.scope,
               h.starts_at as "startsAt", h.expires_at as "expiresAt",
               h.released_at as "releasedAt",
               h.created_at as "createdAt", h.updated_at as "updatedAt"
        from privacy_legal_holds h
        left join privacy_requests r
          on r.id = h.request_id
         and r.organization_id = h.organization_id
        where h.organization_id = ${organizationId}
          and (
            h.subject_user_id = ${userId}
            or r.subject_user_id = ${userId}
          )
        order by h.created_at, h.id
      `;
      const privacyExportArtifacts = await tx`
        select a.id, a.request_id as "requestId", a.status, a.format,
               a.safe_file_name as "safeFileName",
               a.content_type as "contentType",
               a.manifest_sha256 as "manifestSha256",
               a.artifact_sha256 as "artifactSha256",
               a.size_bytes as "sizeBytes", a.file_count as "fileCount",
               a.expires_at as "expiresAt", a.ready_at as "readyAt",
               a.deleted_at as "deletedAt",
               a.created_at as "createdAt", a.updated_at as "updatedAt"
        from privacy_export_artifacts a
        join privacy_requests r
          on r.id = a.request_id
         and r.organization_id = a.organization_id
         and r.subject_user_id = ${userId}
        where a.organization_id = ${organizationId}
        order by a.created_at, a.id
      `;
      const activityRows = await tx`
        select id, type, entity_type as "entityType",
               entity_id as "entityId", metadata,
               case when user_id = ${userId} then 'actor'
                    else 'subject' end as relationship,
               created_at as "createdAt"
        from activity_events
        where organization_id = ${organizationId}
          and (
            user_id = ${userId}
            or (entity_type = 'user' and entity_id = ${userId})
          )
        order by created_at
      `;
      const auditLog = await tx`
        select id, request_id as "requestId", method, path, action,
               resource_type as "resourceType", resource_id as "resourceId",
               response_status as "responseStatus",
               duration_ms as "durationMs", ip_address as "ipAddress",
               user_agent as "userAgent", metadata,
               created_at as "createdAt",
                case when actor_user_id = ${userId}
                  then 'actor'
                  when resource_type = 'user' and resource_id = ${userId}
                  then 'subject'
                  else 'apiCredential' end as relationship
        from api_audit_logs
        where organization_id = ${organizationId}
          and (
            actor_user_id = ${userId}
            or (resource_type = 'user' and resource_id = ${userId})
            or api_key_id in (
              select id from api_keys
              where organization_id = ${organizationId}
                and created_by_id = ${userId}
            )
          )
        order by created_at
      `;

      const orbitIdentities = await tx`
        select i.id as "identityId", i.account_id as "accountId",
               a.email, a.display_name as "displayName", a.status,
               i.verified_at as "verifiedAt", i.revoked_at as "revokedAt",
               i.created_at as "createdAt"
        from orbit_account_identities i
        join orbit_accounts a on a.id = i.account_id
        where i.organization_id = ${organizationId} and i.user_id = ${userId}
        order by i.created_at, i.id
      `;
      const orbitMemberships = await tx`
        select m.id, m.workspace_id as "workspaceId", w.name as "workspaceName",
               w.slug as "workspaceSlug", m.role,
               p.name as "permissionSetName", p.permissions,
               m.created_at as "createdAt", m.updated_at as "updatedAt"
        from orbit_workspace_memberships m
        join orbit_workspaces w on w.id = m.workspace_id
        left join orbit_permission_sets p
          on p.id = m.permission_set_id and p.workspace_id = m.workspace_id
        where m.account_id in (
          select account_id from orbit_account_identities
          where organization_id = ${organizationId} and user_id = ${userId}
        )
        order by m.created_at, m.id
      `;
      const orbitDelegations = await tx`
        select d.id, d.workspace_id as "workspaceId",
               d.organization_id as "organizationId", d.permissions,
               d.expires_at as "expiresAt", d.revoked_at as "revokedAt",
               d.created_at as "createdAt", d.updated_at as "updatedAt"
        from orbit_partner_delegations d
        where d.partner_account_id in (
          select account_id from orbit_account_identities
          where organization_id = ${organizationId} and user_id = ${userId}
        )
        order by d.created_at, d.id
      `;
      const orbitTransfers = await tx`
        select id, workspace_id as "workspaceId",
               source_organization_id as "sourceOrganizationId",
               target_organization_id as "targetOrganizationId",
               source_course_ids as "sourceCourseIds",
               target_course_ids as "targetCourseIds", status, preflight,
               failure_code as "failureCode", started_at as "startedAt",
               completed_at as "completedAt", created_at as "createdAt",
               updated_at as "updatedAt"
        from orbit_transfer_jobs
        where requested_by_account_id in (
          select account_id from orbit_account_identities
          where organization_id = ${organizationId} and user_id = ${userId}
        )
        order by created_at, id
      `;
      const orbitAudit = await tx`
        select id, workspace_id as "workspaceId", action,
               resource_type as "resourceType", resource_id as "resourceId",
               source_organization_id as "sourceOrganizationId",
               target_organization_id as "targetOrganizationId",
               outcome, metadata, created_at as "createdAt"
        from orbit_audit_events
        where actor_account_id in (
          select account_id from orbit_account_identities
          where organization_id = ${organizationId} and user_id = ${userId}
        )
        order by created_at, id
      `;
      const editorPresence = await tx`
        select course_id as "courseId", lesson_id as "lessonId",
               page_id as "pageId", last_seen_at as "lastSeenAt",
               expires_at as "expiresAt"
        from editor_presences
        where organization_id = ${organizationId}
          and user_id = ${userId}
          and expires_at > now()
        order by expires_at, id
      `;
      const stockImageSelections = await tx`
        select course_id as "courseId", provider,
               external_id as "externalId", author,
               author_url as "authorUrl", source_url as "sourceUrl",
               attribution, download_tracked_at as "downloadTrackedAt",
               used_at as "usedAt", expires_at as "expiresAt",
               created_at as "createdAt"
        from stock_image_selections
        where organization_id = ${organizationId}
          and selected_by_id = ${userId}
        order by created_at, id
      `;

      const profile = {
        id: subject.id,
        email: subject.email,
        firstName: subject.firstName,
        lastName: subject.lastName,
        avatarUrl:
          typeof subject.avatarUrl === "string"
            ? sanitizeExportUrl(subject.avatarUrl)
            : subject.avatarUrl,
        role: subject.role,
        status: subject.status,
        jobTitle: subject.jobTitle,
        department: subject.department,
        phone: subject.phone,
        bio: subject.bio,
        preferredLocale: subject.preferredLocale,
        locale: subject.preferredLocale ?? subject.organizationDefaultLocale,
        points: subject.points,
        communityPoints: subject.communityPoints,
        lastLoginAt: subject.lastLoginAt,
        createdAt: subject.createdAt,
      };
      return {
        format: "q-academy-dsar",
        schemaVersion: 23,
        exportedAt: new Date().toISOString(),
        exportManifest: {
          snapshotIsolation: "repeatable_read",
          binaryMediaIncluded: false,
          binaryMediaStatus: "separate_export_required",
          excludedFields: EXPORT_EXCLUDED_FIELDS,
        },
        organization: {
          id: organizationId,
          name: subject.organizationName,
          slug: subject.organizationSlug,
          defaultLocale: subject.organizationDefaultLocale,
        },
        subject: profile,
        data: {
          customFields,
          dataProfiles: {
            profiles: dataProfiles,
            values: dataProfileValues,
            formSubmissions: dataFormSubmissions,
          },
          authenticationActivity: {
            sessions,
            mfaConfiguration: mfaConfigurations[0] ?? null,
            mfaChallenges,
            mfaPolicyContext: mfaPolicy[0] ?? null,
            welcomeAcknowledgements,
            invitations,
            passwordResetHistory,
            emailDeliveryHistory,
            emailDeliveryFeedback,
            emailSuppressions,
            oidcIdentities,
            oidcConfigurationContext: oidcConfigurationContextRows[0] ?? null,
            customDomainClaims,
          },
          groups,
          access: {
            directBundles,
            groupCourseAssignments,
            groupBundleAssignments,
            bundleCourseAssignments,
            courseAccessGrants,
            courseCollaboratorPermissions,
            courseModuleAccessOverrides,
            courseModuleAccessRequests,
            directHubAccess,
          },
          learning: {
            enrollments,
            lessonProgress,
            lessonBookmarks,
            lessonLearningTime,
            mediaPlaybackProgress,
            lessonAvailabilitySubscriptions,
            assessmentAttempts: assessmentAttempts.map((row) => ({
              ...row,
              assessmentSnapshot: sanitizeAssessmentSnapshot(
                row.assessmentSnapshot,
              ),
              questionPresentation: sanitizeAssessmentSnapshot(
                row.questionPresentation,
              ),
            })),
            assessmentAnswers: assessmentAnswers.map((row) => ({
              ...row,
              questionSnapshot: sanitizeAssessmentSnapshot(
                row.questionSnapshot,
              ),
              answerSnapshot: sanitizeAssessmentSnapshot(row.answerSnapshot),
            })),
            submissions: submissions.map((row) => ({
              ...row,
              richText:
                row.contentFormat === "rich_text"
                  ? sanitizeRichTextDocument(row.richText)
                  : null,
            })),
            submissionReviews,
            submissionReviewAnnotations,
            submissionAttachments,
            mediaAssets,
            mediaProcessingJobs,
            courseMediaBindings,
            certificates,
          },
          feedback,
          community: {
            posts: posts.map((row) => ({
              ...row,
              richText:
                row.contentFormat === "rich_text"
                  ? sanitizeRichTextDocument(row.richText)
                  : null,
              imageUrl:
                typeof row.imageUrl === "string"
                  ? sanitizeExportUrl(row.imageUrl)
                  : row.imageUrl,
            })),
            comments: comments.map((row) => ({
              ...row,
              richText:
                row.contentFormat === "rich_text"
                  ? sanitizeRichTextDocument(row.richText)
                  : null,
            })),
            postAttachments: communityPostAttachments,
            commentAttachments: communityCommentAttachments,
            directAccessRules: communityAccessRules,
            effectiveSpaceAccess: communityEffectiveSpaceAccess,
            likes,
            commentReactions: {
              made: commentReactionsMade,
              receivedSummary: commentReactionsReceived,
            },
            scoreContributions: communityScoreContributions,
            votes,
            follows: communityFollows,
            followerSummary: communityFollowerSummary ?? { authorFollowerCount: 0 },
            authorBoosts: communityAuthorBoosts.map((row) => ({
              ...row,
              reason:
                typeof row.reason === "string"
                  ? redactCredentialLikeString(row.reason)
                  : row.reason,
            })),
            mentionsMade,
            mentionsReceived,
            reportsMade: communityReportsMade.map((row) => ({
              ...row,
              contentExcerpt:
                typeof row.contentExcerpt === "string"
                  ? redactCredentialLikeString(row.contentExcerpt)
                  : row.contentExcerpt,
              details:
                typeof row.details === "string"
                  ? redactCredentialLikeString(row.details)
                  : row.details,
            })),
            reportsAbout: communityReportsAbout.map((row) => ({
              ...row,
              contentExcerpt:
                typeof row.contentExcerpt === "string"
                  ? redactCredentialLikeString(row.contentExcerpt)
                  : row.contentExcerpt,
            })),
            moderationCases: communityModerationCases,
            moderationAppeals: communityModerationAppeals.map((row) => ({
              ...row,
              statement:
                typeof row.statement === "string"
                  ? redactCredentialLikeString(row.statement)
                  : row.statement,
            })),
          },
          events: { eventAttendance, directEventAudience, createdEvents },
          gamification: { pointTransactions, badges },
          notifications: {
            preferences: notificationPreferences,
            notifications: notifications.map((row) => ({
              ...row,
              href:
                typeof row.href === "string"
                  ? sanitizeExportUrl(row.href)
                  : row.href,
            })),
            webPushSubscriptions,
            pushDeliveryHistory,
            nativePushDevices,
            nativePushDeliveryHistory,
            directAnnouncements: directAnnouncements.map((row) => ({
              ...row,
              href:
                typeof row.href === "string"
                  ? sanitizeExportUrl(row.href)
                  : row.href,
            })),
            announcementDismissals,
            announcementInteractions,
          },
          orbit: {
            identities: orbitIdentities,
            memberships: orbitMemberships,
            delegations: orbitDelegations,
            transfers: orbitTransfers.map((row) => ({
              ...row,
              preflight: sanitizeExportMetadata(row.preflight),
            })),
            audit: orbitAudit.map((row) => ({
              ...row,
              metadata: sanitizeExportMetadata(row.metadata),
            })),
          },
          authoring: {
            activeEditorPresence: editorPresence,
            stockImageSelections,
          },
          ai: {
            externalUseAcknowledgements: externalAiUseAcknowledgements,
            conversations: conversations.map((row) => {
              const {
                agentVersionName,
                agentVersionType,
                agentVersionNumber,
                agentVersionPublishedAt,
                ...conversation
              } = row;
              return {
                ...conversation,
                agentVersion: {
                  name: agentVersionName,
                  type: agentVersionType,
                  version: agentVersionNumber,
                  publishedAt: agentVersionPublishedAt,
                },
              };
            }),
            messages: messages.map((row) => ({
              ...row,
              citations: sanitizeAiMessageCitations(row.citations),
            })),
            authoredAgentVersions,
            agentAccessGrants,
            actionRequests: agentActionRequests.map((row) => ({
              ...row,
              decisionNote:
                typeof row.decisionNote === "string"
                  ? redactCredentialLikeString(row.decisionNote)
                  : row.decisionNote,
            })),
            actionEvents: agentActionEvents,
            membershipProvenance: agentMembershipProvenance,
          },
          integrations: {
            apiCredentials,
            webhookConfigurations,
            webhookDeliveryHistory,
            apiIdempotency: apiIdempotency.map((row) => ({
              ...row,
              path:
                typeof row.path === "string"
                  ? sanitizeExportUrl(row.path)
                  : row.path,
            })),
          },
          privacy: {
            requests: privacyCases,
            events: privacyEvents.map((row) => ({
              ...row,
              metadata: sanitizePrivacyEventMetadata(row.metadata),
            })),
            legalHolds: privacyLegalHolds,
            exportArtifacts: privacyExportArtifacts,
          },
          audit: {
            activityEvents: activityRows.map((row) => ({
              ...row,
              metadata: sanitizeExportMetadata(row.metadata),
            })),
            apiAuditLog: auditLog.map((row) => ({
              ...row,
              path:
                typeof row.path === "string"
                  ? sanitizeExportUrl(row.path)
                  : row.path,
              metadata: sanitizeExportMetadata(row.metadata),
            })),
          },
        },
      };
    },
  );
}

async function writeRestrictedJson(outputPath: string, value: unknown) {
  let outputFile: FileHandle | null = null;
  try {
    outputFile = await open(outputPath, "wx", 0o600);
    await outputFile.chmod(0o600);
    await outputFile.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await outputFile.sync();
    await outputFile.close();
    outputFile = null;
  } catch {
    if (outputFile) {
      await outputFile.close().catch(() => undefined);
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
    throw new CliError(
      "Exportdatei konnte nicht sicher und exklusiv geschrieben werden.",
    );
  }
}

async function main() {
  const raw = parseArguments(process.argv.slice(2));
  if (raw.help) {
    process.stderr.write(`${HELP}\n`);
    return;
  }
  const input = validateInput(raw);
  const sql = postgres(databaseUrl(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  try {
    const payload = await buildUserDataExport(
      sql,
      input.organizationSlug,
      input.userEmail,
    );
    await writeRestrictedJson(input.outputPath, payload);
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.stderr.write("DSAR export completed.\n");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof CliError ? error.message : "DSAR export failed."}\n`,
    );
    process.exitCode = 1;
  });
}
