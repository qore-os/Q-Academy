import Link from "next/link";
import { Award, BadgeCheck, Ban, CalendarDays, Hash } from "lucide-react";
import { PrintCertificateButton } from "@/components/certificates/print-certificate-button";
import { buttonClassName } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { AppLocale } from "@/lib/i18n/model";
import { getCertificateCopy } from "@/lib/i18n/certificates";

type CertificateDocumentData = {
  certificateNumber: string;
  recipientName: string;
  courseTitle: string;
  organizationName: string;
  completedAt: Date;
  issuedAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
};

export function CertificateDocument({
  certificate,
  backHref,
  locale,
}: {
  certificate: CertificateDocumentData;
  backHref: string;
  locale: AppLocale;
}) {
  const revoked = Boolean(certificate.revokedAt);
  const copy = getCertificateCopy(locale).document;
  const localizedDate = (date: Date) => formatDate(date, undefined, locale);
  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div className="certificate-no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={backHref}
          className={buttonClassName({ variant: "secondary" })}
        >
          {copy.back}
        </Link>
        <PrintCertificateButton locale={locale} />
      </div>

      <article
        className="certificate-print-page relative isolate overflow-hidden border border-[#cbd4dc] bg-white px-5 py-8 shadow-[0_18px_55px_rgba(15,38,60,0.12)] sm:px-10 sm:py-12 lg:aspect-[1.414/1] lg:px-16 lg:py-14"
        aria-label={copy.ariaLabel(certificate.certificateNumber)}
      >
        <div className="pointer-events-none absolute inset-3 border border-[#d7b95d] sm:inset-5" />
        <div className="pointer-events-none absolute inset-5 border border-[#17324d]/15 sm:inset-7" />
        <div className="relative flex h-full min-h-[560px] flex-col items-center justify-between text-center lg:min-h-0">
          <div>
            <div className="mx-auto grid size-16 place-items-center rounded-full border border-[#d7b95d] bg-[#fffaf0] text-[#a57b13]">
              <Award className="size-8" strokeWidth={1.7} />
            </div>
            <p className="mt-5 text-[11px] font-bold uppercase text-[#2b9188]">
              {certificate.organizationName}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[#17324d] sm:text-4xl">
              {copy.title}
            </h1>
            <p className="mt-2 text-sm text-[#66727f]">
              {copy.subtitle}
            </p>
          </div>

          <div className="my-8 w-full max-w-3xl">
            <p className="text-sm text-[#66727f]">{copy.confirms}</p>
            <p className="mt-3 border-b border-[#d7b95d] pb-3 text-3xl font-bold text-[#17212b] sm:text-4xl">
              {certificate.recipientName}
            </p>
            <p className="mt-5 text-sm leading-6 text-[#66727f]">
              {copy.course}
            </p>
            <h2 className="mt-2 text-xl font-bold text-[#17324d] sm:text-2xl">
              {certificate.courseTitle}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#66727f]">
              {copy.completionStatement}
            </p>
          </div>

          <div className="grid w-full gap-4 border-t border-[#e1e6ea] pt-5 text-left text-[11px] text-[#66727f] sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-[#2b9188]" />
              <span>
                <span className="block font-semibold text-[#243444]">{copy.completed}</span>
                {localizedDate(certificate.completedAt)}
              </span>
            </div>
            <div className="flex items-start gap-2 sm:justify-center">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#2b9188]" />
              <span>
                <span className="block font-semibold text-[#243444]">{copy.issued}</span>
                {localizedDate(certificate.issuedAt)}
              </span>
            </div>
            <div className="flex min-w-0 items-start gap-2 sm:justify-end">
              <Hash className="mt-0.5 size-4 shrink-0 text-[#2b9188]" />
              <span className="min-w-0">
                <span className="block font-semibold text-[#243444]">{copy.number}</span>
                <span className="break-all font-mono">{certificate.certificateNumber}</span>
              </span>
            </div>
          </div>
        </div>

        {revoked ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-white/80 p-8 text-center">
            <div className="max-w-md border-2 border-[#c64f43] bg-white px-6 py-5 text-[#a23d34] shadow-lg">
              <Ban className="mx-auto size-8" />
              <p className="mt-2 text-xl font-bold uppercase">{copy.revoked}</p>
              <p className="mt-2 text-xs leading-5">
                {certificate.revokedAt
                  ? copy.revokedOn(localizedDate(certificate.revokedAt))
                  : copy.noLongerValid}
              </p>
              {certificate.revocationReason ? (
                <p className="mt-1 text-xs leading-5">{certificate.revocationReason}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}
