import type {
  PrivacyExportArtifact,
  PrivacyLegalHold,
  PrivacyRequest,
  PrivacyRequestEvent,
} from "@/db/schema";

type PrivacySubject = {
  id: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
} | null;

type PrivacyRequestDetailSource = {
  request: PrivacyRequest;
  subject: PrivacySubject;
  events: PrivacyRequestEvent[];
  holds: PrivacyLegalHold[];
  artifacts: PrivacyExportArtifact[];
};

const safeEventMetadataKeys = new Set([
  "type",
  "policyVersion",
  "artifactId",
  "scope",
  "sizeBytes",
  "artifactSha256",
  "failureCode",
]);

export function privacyRequestData(request: PrivacyRequest) {
  return {
    id: request.id,
    subjectUserId: request.subjectUserId,
    clientRequestId: request.clientRequestId,
    type: request.type,
    status: request.status,
    dueAt: request.dueAt,
    identityVerifiedAt: request.identityVerifiedAt,
    approvedAt: request.approvedAt,
    processingStartedAt: request.processingStartedAt,
    completedAt: request.completedAt,
    backupExpiresAt: request.backupExpiresAt,
    policyVersion: request.policyVersion,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function privacySubjectData(subject: PrivacySubject) {
  if (
    !subject?.id ||
    !subject.email ||
    subject.firstName === null ||
    subject.lastName === null
  ) {
    return null;
  }
  return {
    id: subject.id,
    email: subject.email,
    firstName: subject.firstName,
    lastName: subject.lastName,
  };
}

export function safePrivacyEventMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key, value]) =>
        safeEventMetadataKeys.has(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null),
    ),
  );
}

export function privacyRequestDetailData(detail: PrivacyRequestDetailSource) {
  return {
    ...privacyRequestData(detail.request),
    subject: privacySubjectData(detail.subject),
    events: detail.events.map((event) => ({
      id: event.id,
      event: event.event,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      metadata: safePrivacyEventMetadata(event.metadata),
      createdAt: event.createdAt,
    })),
    legalHolds: detail.holds.map((hold) => ({
      id: hold.id,
      scope: hold.scope,
      startsAt: hold.startsAt,
      expiresAt: hold.expiresAt,
      releasedAt: hold.releasedAt,
      createdAt: hold.createdAt,
      updatedAt: hold.updatedAt,
    })),
    artifacts: detail.artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      format: artifact.format,
      safeFileName: artifact.safeFileName,
      contentType: artifact.contentType,
      manifestSha256: artifact.manifestSha256,
      artifactSha256: artifact.artifactSha256,
      sizeBytes: artifact.sizeBytes,
      fileCount: artifact.fileCount,
      expiresAt: artifact.expiresAt,
      readyAt: artifact.readyAt,
      deletedAt: artifact.deletedAt,
      failureCode: artifact.failureCode,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    })),
  };
}
