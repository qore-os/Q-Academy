import type { PrivacyRequest } from "@/db/schema";

export const PRIVACY_POLICY_VERSION = "privacy-dsar-v2";
export const PRIVACY_REQUEST_DUE_DAYS = 30;
export const PRIVACY_EXPORT_RETENTION_DAYS = 7;
export const PRIVACY_BACKUP_ERASURE_DAYS = 30;

export type PrivacyRequestStatus = PrivacyRequest["status"];

const ALLOWED_TRANSITIONS: Readonly<
  Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]>
> = {
  received: ["identity_verified", "rejected", "cancelled"],
  identity_verified: ["approved", "rejected", "cancelled"],
  approved: ["processing", "blocked", "cancelled"],
  processing: ["completed", "blocked", "failed"],
  blocked: ["approved", "processing"],
  failed: ["approved", "processing"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function allowedPrivacyTransitions(status: PrivacyRequestStatus) {
  return ALLOWED_TRANSITIONS[status];
}

export function canTransitionPrivacyRequest(
  from: PrivacyRequestStatus,
  to: PrivacyRequestStatus,
) {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function privacyPolicySnapshot(type: PrivacyRequest["type"]) {
  return {
    policyVersion: PRIVACY_POLICY_VERSION,
    dueDays: PRIVACY_REQUEST_DUE_DAYS,
    exportRetentionDays: PRIVACY_EXPORT_RETENTION_DAYS,
    requestType: type,
    completionCapabilities: {
      structuredJsonExport: true,
      binaryMediaExport: true,
      erasureExecutor: true,
    },
    completionRule:
      type === "access_export"
        ? "Complete only after the structured export and every available bound media object are integrity-checked in the encrypted ZIP artifact."
        : "Complete only after active legal holds are clear, personal media is verifiably purged, credentials and direct subject data are deleted, and documented exceptions are pseudonymized.",
  } as const;
}
