import { notFound } from "next/navigation";
import { CertificateDocument } from "@/components/certificates/certificate-document";
import { requireAdmin } from "@/lib/auth";
import { getCertificateForAdmin } from "@/lib/certificates";
import {
  coursePermissionAllows,
  coursePermissionForUser,
} from "@/lib/course-permissions";
import { resolveUserLocale } from "@/lib/i18n/server";

export default async function AdminCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAdmin();
  const [certificate, locale] = await Promise.all([
    getCertificateForAdmin(id, actor.organizationId),
    resolveUserLocale(actor),
  ]);
  if (!certificate) notFound();
  const permission = await coursePermissionForUser(actor, certificate.courseId);
  if (!coursePermissionAllows(permission, "edit")) notFound();
  return (
    <CertificateDocument
      certificate={certificate}
      backHref="/admin/certificates"
      locale={locale}
    />
  );
}
