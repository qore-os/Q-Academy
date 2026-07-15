import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { PrivacyRequestDetail } from "@/components/admin/privacy-request-detail";
import { requireOwner } from "@/lib/auth";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";
import { getPrivacyRequestDetail } from "@/lib/privacy/request-service";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getPrivacyAdminCopy } from "@/lib/i18n/privacy-admin";

export async function generateMetadata(): Promise<Metadata> {
  const owner = await requireOwner();
  const locale = await resolveUserLocale(owner);
  return { title: getPrivacyAdminCopy(locale).page.detailMetadataTitle };
}

export default async function PrivacyRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await requireOwner();
  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) notFound();
  const [detail, loginConfiguration, locale] = await Promise.all([
    getPrivacyRequestDetail(owner.organizationId, parsedId.data),
    getPublicOidcLoginConfiguration(owner.organizationId),
    resolveUserLocale(owner),
  ]);
  if (!detail) notFound();

  const { request, subject, events, holds, artifacts } = detail;
  return (
    <PrivacyRequestDetail
      request={{
        id: request.id,
        clientRequestId: request.clientRequestId,
        type: request.type,
        status: request.status,
        statusReason: request.statusReason,
        dueAt: request.dueAt.toISOString(),
        identityVerifiedAt: request.identityVerifiedAt?.toISOString() ?? null,
        approvedAt: request.approvedAt?.toISOString() ?? null,
        processingStartedAt: request.processingStartedAt?.toISOString() ?? null,
        completedAt: request.completedAt?.toISOString() ?? null,
        policyVersion: request.policyVersion,
        policySnapshot: request.policySnapshot,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }}
      subject={
        subject
          ? {
              id: subject.id,
              email: subject.email,
              firstName: subject.firstName,
              lastName: subject.lastName,
            }
          : null
      }
      events={events.map((event) => ({
        id: event.id,
        event: event.event,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
      }))}
      holds={holds.map((hold) => ({
        id: hold.id,
        reference: hold.reference,
        scope: hold.scope,
        reason: hold.reason,
        legalBasis: hold.legalBasis,
        startsAt: hold.startsAt.toISOString(),
        expiresAt: hold.expiresAt?.toISOString() ?? null,
        releasedAt: hold.releasedAt?.toISOString() ?? null,
        releaseReason: hold.releaseReason,
      }))}
      artifacts={artifacts.map((artifact) => ({
        id: artifact.id,
        status: artifact.status,
        format: artifact.format,
        safeFileName: artifact.safeFileName,
        contentType: artifact.contentType,
        artifactSha256: artifact.artifactSha256,
        sizeBytes: artifact.sizeBytes,
        fileCount: artifact.fileCount,
        expiresAt: artifact.expiresAt.toISOString(),
        readyAt: artifact.readyAt?.toISOString() ?? null,
        deletedAt: artifact.deletedAt?.toISOString() ?? null,
        failureCode: artifact.failureCode,
      }))}
      referenceTime={new Date().toISOString()}
      ownerStepUpMode={
        loginConfiguration.passwordLoginEnabled ? "password" : "oidc"
      }
      locale={locale}
    />
  );
}
