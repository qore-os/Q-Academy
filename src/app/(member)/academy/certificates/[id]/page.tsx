import { notFound } from "next/navigation";
import { CertificateDocument } from "@/components/certificates/certificate-document";
import { requireUser } from "@/lib/auth";
import { getCertificateForMember } from "@/lib/certificates";
import { resolveUserLocale } from "@/lib/i18n/server";

export default async function MemberCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const [certificate, locale] = await Promise.all([
    getCertificateForMember(id, user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  if (!certificate) notFound();
  return (
    <CertificateDocument
      certificate={certificate}
      backHref="/academy/certificates"
      locale={locale}
    />
  );
}
