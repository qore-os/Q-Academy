import type {
  PrivacyDataInventoryEntry,
  PrivacyErasureAction,
  PrivacyErasurePrerequisite,
  PrivacyExportMode,
  PrivacyLegalHoldScope,
  PrivacySubjectRelationKind,
} from "@/lib/privacy/data-inventory";

function entry(input: {
  table: string;
  relation: {
    kind: PrivacySubjectRelationKind;
    columns: string[];
    viaTables?: string[];
    description: string;
  };
  exportPolicy: {
    mode: PrivacyExportMode;
    excludedColumns?: string[];
    reviewColumns?: string[];
    description: string;
  };
  erasure: {
    action: PrivacyErasureAction;
    prerequisites?: PrivacyErasurePrerequisite[];
    description: string;
  };
  legalHold: { scopes: PrivacyLegalHoldScope[]; description: string };
}): PrivacyDataInventoryEntry {
  return {
    table: input.table,
    subjectRelation: {
      ...input.relation,
      viaTables: input.relation.viaTables ?? [],
    },
    exportPolicy: {
      ...input.exportPolicy,
      excludedColumns: input.exportPolicy.excludedColumns ?? [],
      reviewColumns: input.exportPolicy.reviewColumns ?? [],
    },
    erasurePolicy: {
      ...input.erasure,
      prerequisites: input.erasure.prerequisites ?? [],
    },
    legalHold: input.legalHold,
  };
}

const sharedContext = (table: string, description: string) =>
  entry({
    table,
    relation: { kind: "none", columns: [], description },
    exportPolicy: {
      mode: "context_only",
      description: "Include only as shared tenant or control-plane context when needed to explain subject records.",
    },
    erasure: {
      action: "not_applicable",
      description: "An individual request does not delete shared configuration or another tenant's operational state.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Shared configuration can be retained as control-plane and authorization evidence.",
    },
  });

export const PENDING_SCHEMA_PRIVACY_DATA_INVENTORY = {
  custom_domain_claims: entry({
    table: "custom_domain_claims",
    relation: {
      kind: "actor",
      columns: ["created_by_id"],
      viaTables: ["users"],
      description:
        "The optional creator identifies the tenant owner who initiated the shared custom-domain ownership proof.",
    },
    exportPolicy: {
      mode: "sanitized",
      excludedColumns: ["challenge_hash"],
      description:
        "Include hostname and lifecycle timestamps for the creating owner without the challenge hash or DNS response material.",
    },
    erasure: {
      action: "unlink",
      prerequisites: ["retention_decision"],
      description:
        "Unlink creator attribution while preserving an active tenant domain; revoked claims expire under the operational retention policy.",
    },
    legalHold: {
      scopes: ["authentication", "audit"],
      description:
        "Domain ownership and revocation lifecycle can evidence authentication routing and authorized configuration changes.",
    },
  }),
  email_delivery_feedback_events: entry({
    table: "email_delivery_feedback_events",
    relation: {
      kind: "indirect",
      columns: ["delivery_id", "organization_id"],
      viaTables: ["email_deliveries"],
      description:
        "The tenant-bound delivery resolves the recipient; the row contains only a bounded gateway event class, reason code, and lifecycle timestamps.",
    },
    exportPolicy: {
      mode: "metadata_only",
      excludedColumns: ["external_event_id", "payload_hash", "delivery_id"],
      description:
        "Include event type, bounce class, bounded reason code, and timestamps without replay identifiers, hashes, or internal delivery identifiers.",
    },
    erasure: {
      action: "cascade_delete",
      prerequisites: ["legal_hold_clear"],
      description:
        "Delete with the subject's email deliveries unless an active communications hold applies.",
    },
    legalHold: {
      scopes: ["communications"],
      description:
        "Bounce and complaint outcomes may be retained only as communications delivery evidence.",
    },
  }),
  email_suppressions: entry({
    table: "email_suppressions",
    relation: {
      kind: "direct",
      columns: [
        "user_id",
        "organization_id",
        "recipient_hash",
        "released_by_id",
      ],
      viaTables: ["users"],
      description:
        "The tenant-bound user identifies the recipient, the optional release actor records lifecycle attribution, and the normalized address is represented only by a one-way tenant HMAC.",
    },
    exportPolicy: {
      mode: "metadata_only",
      excludedColumns: [
        "recipient_hash",
        "source_delivery_id",
        "released_by_id",
      ],
      description:
        "Include reason, lifecycle, occurrence count, release reason, and timestamps without recipient hashes or internal actor and delivery identifiers.",
    },
    erasure: {
      action: "delete",
      prerequisites: ["legal_hold_clear"],
      description:
        "Delete every subject-linked suppression after communications hold review; active suppressions otherwise remain an anti-abuse delivery control.",
    },
    legalHold: {
      scopes: ["communications"],
      description:
        "Suppression history may be retained only for communications delivery and complaint evidence.",
    },
  }),
  organization_contracts: sharedContext(
    "organization_contracts",
    "Plan, contract status, entitlements, and tenant-wide usage limits are shared service configuration without individual subject ownership.",
  ),
  editor_presences: entry({
    table: "editor_presences",
    relation: {
      kind: "direct",
      columns: ["user_id", "organization_id", "course_id"],
      viaTables: ["users", "courses"],
      description: "The short-lived user reference identifies an active course editor; no draft content is stored.",
    },
    exportPolicy: {
      mode: "metadata_only",
      description: "Include only active scope and expiry metadata if it still exists when the export snapshot is taken.",
    },
    erasure: {
      action: "delete",
      description: "Delete active presence immediately; the normal TTL cleanup also removes expired rows.",
    },
    legalHold: {
      scopes: [],
      description: "Ephemeral editor presence is not retained for legal holds.",
    },
  }),
  stock_image_selections: entry({
    table: "stock_image_selections",
    relation: {
      kind: "actor",
      columns: ["selected_by_id", "organization_id", "course_id"],
      viaTables: ["users", "courses"],
      description: "The optional selecting-user reference identifies the editor choosing a provider image.",
    },
    exportPolicy: {
      mode: "metadata_only",
      excludedColumns: ["image_url", "preview_url"],
      description: "Include provider, attribution, source, selection lifecycle, and course context without duplicating remote CDN URLs.",
    },
    erasure: {
      action: "delete_or_pseudonymize",
      prerequisites: ["shared_resource_review"],
      description: "Delete unused selections or unlink the selecting user after attribution has been frozen into shared course content.",
    },
    legalHold: {
      scopes: ["integrations"],
      description: "Minimal provider attribution and tracking evidence can be retained only for an integration evidence hold.",
    },
  }),
  badge_groups: sharedContext(
    "badge_groups",
    "Badge groups are shared tenant-wide display configuration and do not identify an award recipient.",
  ),
  native_push_devices: entry({
    table: "native_push_devices",
    relation: {
      kind: "direct",
      columns: ["user_id", "organization_id", "session_id"],
      viaTables: ["users", "user_sessions"],
      description: "The user and persisted session identify the owner of the native device capability token.",
    },
    exportPolicy: {
      mode: "metadata_only",
      excludedColumns: ["token_hash", "token_encrypted"],
      description: "Include platform, application identifier, and lifecycle timestamps without token material or stable token hashes.",
    },
    erasure: {
      action: "revoke_and_unlink",
      prerequisites: ["revoke_credentials"],
      description: "Delete every native device registration for the subject before completing credential revocation.",
    },
    legalHold: {
      scopes: [],
      description: "Push capability tokens are credentials and are never retained for a legal hold.",
    },
  }),
  native_push_deliveries: entry({
    table: "native_push_deliveries",
    relation: {
      kind: "direct",
      columns: ["user_id", "organization_id", "device_id", "notification_id"],
      viaTables: ["native_push_devices", "notifications"],
      description: "The user, device, and notification identify the recipient and delivery lifecycle.",
    },
    exportPolicy: {
      mode: "sanitized",
      reviewColumns: ["response_body"],
      description: "Include status and timestamps while sanitizing provider response text before subject disclosure.",
    },
    erasure: {
      action: "cascade_delete",
      prerequisites: ["revoke_credentials"],
      description: "Delete delivery history directly and through device or notification cascade during subject erasure.",
    },
    legalHold: {
      scopes: ["communications"],
      description: "Delivery outcomes may be retained only under a communications evidence hold.",
    },
  }),
  event_calendar_settings: sharedContext(
    "event_calendar_settings",
    "Calendar colors, density, radius, and tenant time-zone presentation are shared organization configuration without individual subject ownership.",
  ),
  orbit_accounts: entry({
    table: "orbit_accounts",
    relation: {
      kind: "direct",
      columns: ["email", "display_name"],
      viaTables: ["orbit_account_identities"],
      description: "The global account email and display name identify the person linked through verified tenant identities.",
    },
    exportPolicy: {
      mode: "include",
      description: "Include the account profile and lifecycle when the requesting tenant user has a verified identity link.",
    },
    erasure: {
      action: "delete_or_pseudonymize",
      prerequisites: ["legal_hold_clear", "shared_resource_review"],
      description: "Unlink the tenant identity and pseudonymize an account only after no other verified identities remain.",
    },
    legalHold: {
      scopes: ["profile", "audit"],
      description: "Minimal pseudonymous account state may support control-plane ownership and audit evidence.",
    },
  }),
  orbit_account_identities: entry({
    table: "orbit_account_identities",
    relation: {
      kind: "direct",
      columns: ["user_id", "organization_id", "account_id"],
      viaTables: ["users", "orbit_accounts"],
      description: "The row is the explicit verified bridge between a tenant user and a global Orbit account.",
    },
    exportPolicy: {
      mode: "include",
      description: "Include identity verification, revocation, tenant, and account linkage metadata.",
    },
    erasure: {
      action: "unlink",
      prerequisites: ["legal_hold_clear"],
      description: "Delete the verified tenant identity bridge without affecting unrelated identities in other tenants.",
    },
    legalHold: {
      scopes: ["authentication", "audit"],
      description: "Identity linkage can be retained only as authentication or cross-tenant access evidence.",
    },
  }),
  orbit_workspaces: sharedContext(
    "orbit_workspaces",
    "Orbit workspaces are shared control-plane organizations; creator attribution is indirect through the global account.",
  ),
  orbit_billing_accounts: sharedContext(
    "orbit_billing_accounts",
    "Orbit pricing, settlement mode, and contract status are shared workspace configuration rather than an individual subject record.",
  ),
  orbit_billing_price_versions: entry({
    table: "orbit_billing_price_versions",
    relation: {
      kind: "actor",
      columns: ["created_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "The optional creator account identifies the Orbit administrator who scheduled the immutable workspace pricing revision.",
    },
    exportPolicy: {
      mode: "metadata_only",
      description: "Include the effective date, currency, price components, and revision when creator attribution is in scope.",
    },
    erasure: {
      action: "pseudonymize",
      prerequisites: ["legal_hold_clear", "retention_decision"],
      description: "Unlink creator attribution after review while retaining immutable historical pricing for statement reproducibility.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Historical pricing can be retained as contract, billing, and authorization evidence.",
    },
  }),
  orbit_billing_statements: entry({
    table: "orbit_billing_statements",
    relation: {
      kind: "actor",
      columns: ["finalized_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "The finalizing Orbit account identifies the administrator closing the shared billing period.",
    },
    exportPolicy: {
      mode: "metadata_only",
      description: "Include period, pricing revision, instance counts, currency, totals, and finalization lifecycle when actor attribution is in scope.",
    },
    erasure: {
      action: "pseudonymize",
      prerequisites: ["legal_hold_clear", "retention_decision"],
      description: "Unlink finalizer attribution after review while retaining the shared financial statement for statutory and contract evidence.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Finalized billing periods can be retained as contract and authorization evidence.",
    },
  }),
  orbit_permission_sets: entry({
    table: "orbit_permission_sets",
    relation: {
      kind: "actor",
      columns: ["created_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "Creator account attribution can resolve to a subject through a verified Orbit identity.",
    },
    exportPolicy: {
      mode: "context_only",
      description: "Include names and effective permissions only when needed to explain the subject's membership.",
    },
    erasure: {
      action: "unlink",
      prerequisites: ["shared_resource_review"],
      description: "Remove creator attribution while retaining shared permission configuration used by other members.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Permission configuration can be retained as authorization and access-review evidence.",
    },
  }),
  orbit_workspace_memberships: entry({
    table: "orbit_workspace_memberships",
    relation: {
      kind: "direct",
      columns: ["account_id", "created_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "Account and creator links identify organization members and the administrator assigning the role.",
    },
    exportPolicy: {
      mode: "include",
      description: "Include organization role, permission-set reference, and membership lifecycle for linked accounts.",
    },
    erasure: {
      action: "delete_or_pseudonymize",
      prerequisites: ["legal_hold_clear", "shared_resource_review"],
      description: "Remove nonessential membership or retain only pseudonymous ownership until control-plane ownership is transferred.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Membership and role assignments can be retained as authorization evidence.",
    },
  }),
  orbit_instances: sharedContext(
    "orbit_instances",
    "Customer instance limits and entitlements describe tenant service configuration rather than an individual subject.",
  ),
  orbit_instance_claims: entry({
    table: "orbit_instance_claims",
    relation: {
      kind: "actor",
      columns: ["created_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "Creator account attribution links the one-time instance claim to an Orbit administrator.",
    },
    exportPolicy: {
      mode: "metadata_only",
      excludedColumns: ["token_hash", "token_prefix"],
      description: "Include issue, expiry, and consumption lifecycle without reusable or correlatable claim-token material.",
    },
    erasure: {
      action: "expire",
      prerequisites: ["revoke_credentials"],
      description: "Delete unconsumed claims for an orphaned account and retain consumed lifecycle only as shared instance evidence.",
    },
    legalHold: {
      scopes: ["authentication", "audit"],
      description: "Consumed claim lifecycle can evidence the authorized tenant-linking event.",
    },
  }),
  orbit_partner_delegations: entry({
    table: "orbit_partner_delegations",
    relation: {
      kind: "direct",
      columns: ["partner_account_id", "created_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "Partner and creator accounts identify the delegated subject and assigning administrator.",
    },
    exportPolicy: {
      mode: "include",
      description: "Include tenant scope, effective permissions, expiry, revocation, and lifecycle timestamps.",
    },
    erasure: {
      action: "revoke_and_unlink",
      prerequisites: ["revoke_credentials", "legal_hold_clear"],
      description: "Revoke partner access immediately and unlink creator attribution after evidence review.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Delegation scope and lifecycle can be retained as cross-tenant authorization evidence.",
    },
  }),
  orbit_transfer_jobs: entry({
    table: "orbit_transfer_jobs",
    relation: {
      kind: "actor",
      columns: ["requested_by_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "The requesting Orbit account identifies the administrator initiating a cross-tenant content copy.",
    },
    exportPolicy: {
      mode: "sanitized",
      excludedColumns: ["idempotency_key", "request_hash"],
      reviewColumns: ["preflight"],
      description: "Include transfer lifecycle and sanitized preflight results without idempotency or request fingerprints.",
    },
    erasure: {
      action: "pseudonymize",
      prerequisites: ["legal_hold_clear", "retention_decision"],
      description: "Unlink requester attribution while retaining minimal transfer integrity and customer audit evidence.",
    },
    legalHold: {
      scopes: ["audit", "integrations"],
      description: "Transfer records can evidence authorized cross-tenant content processing.",
    },
  }),
  orbit_transfer_items: entry({
    table: "orbit_transfer_items",
    relation: {
      kind: "indirect",
      columns: [],
      viaTables: ["orbit_transfer_jobs"],
      description: "Item mappings inherit requester context from their parent transfer job and contain operational identifiers.",
    },
    exportPolicy: {
      mode: "internal_only",
      excludedColumns: ["source_id", "target_id", "checksum"],
      description: "Keep source and target identity mappings internal because they are integrity controls, not subject-facing data.",
    },
    erasure: {
      action: "retain",
      prerequisites: ["retention_decision"],
      description: "Retain immutable item mappings for idempotency and tenant-isolation evidence while the parent job is retained.",
    },
    legalHold: {
      scopes: ["audit", "integrations"],
      description: "Mappings and checksums can prove that a copy created new isolated identities.",
    },
  }),
  orbit_audit_events: entry({
    table: "orbit_audit_events",
    relation: {
      kind: "actor",
      columns: ["actor_account_id"],
      viaTables: ["orbit_account_identities"],
      description: "Actor account attribution identifies the subject performing or being denied a control-plane action.",
    },
    exportPolicy: {
      mode: "sanitized",
      reviewColumns: ["metadata"],
      description: "Include subject-attributed events with sanitized metadata and without unrelated account or tenant details.",
    },
    erasure: {
      action: "pseudonymize",
      prerequisites: ["legal_hold_clear", "retention_decision"],
      description: "Pseudonymize the linked account while retaining append-only authorization and security outcomes.",
    },
    legalHold: {
      scopes: ["audit"],
      description: "Control-plane audit outcomes are core authorization and tenant-isolation evidence.",
    },
  }),
} satisfies Record<string, PrivacyDataInventoryEntry>;
