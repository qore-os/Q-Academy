import Link from "next/link";
import { Award, CalendarDays, CheckCircle2, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getMemberCertificates } from "@/lib/certificates";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export default async function MemberCertificatesPage() {
  const user = await requireUser();
  const [certificates, locale] = await Promise.all([
    getMemberCertificates(user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getMainPageDictionary(locale).academy.certificates;
  const activeCount = certificates.filter((certificate) => !certificate.revokedAt).length;

  return (
    <div className="mx-auto max-w-[1250px] space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.eyebrow}</p>
          <h1 className="mt-1 text-2xl font-bold text-[#17212b]">{copy.title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#66727f]">
            {copy.description}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md border border-[#dfe6e8] bg-white px-4 py-3">
          <Award className="size-5 text-[#a57b13]" />
          <div>
            <p className="text-lg font-bold text-[#243444]">{activeCount}</p>
            <p className="text-[10px] text-[#71808b]">{copy.validCount}</p>
          </div>
        </div>
      </header>

      {certificates.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {certificates.map((certificate) => {
            const revoked = Boolean(certificate.revokedAt);
            return (
              <article key={certificate.id} className="panel flex min-h-64 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-11 place-items-center rounded-md bg-[#fff8e7] text-[#a57b13]">
                    <Award className="size-5" />
                  </span>
                  <Badge tone={revoked ? "coral" : "teal"}>
                    {revoked ? copy.revoked : copy.valid}
                  </Badge>
                </div>
                <h2 className="mt-5 text-base font-bold leading-6 text-[#243444]">
                  {certificate.courseTitle}
                </h2>
                <p className="mt-1 text-xs text-[#71808b]">{certificate.organizationName}</p>
                <div className="mt-5 space-y-2 text-[11px] text-[#66727f]">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="size-3.5 text-[#2b9188]" />
                    {copy.completedOn(formatDate(certificate.completedAt, undefined, locale))}
                  </p>
                  <p className="flex min-w-0 items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-[#2b9188]" />
                    <span className="truncate font-mono">{certificate.certificateNumber}</span>
                  </p>
                </div>
                <div className="mt-auto pt-5">
                  <Link
                    href={`/academy/certificates/${certificate.id}`}
                    className={buttonClassName({ variant: revoked ? "secondary" : "navy", size: "sm" })}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {copy.view}
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="panel grid min-h-72 place-items-center p-8 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid size-14 place-items-center rounded-md bg-[#eef3f7] text-[#4f7cac]">
              <Award className="size-6" />
            </span>
            <h2 className="mt-4 text-lg font-bold text-[#243444]">{copy.emptyTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-[#71808b]">
              {copy.emptyDescription}
            </p>
            <Link href="/academy/courses" className={buttonClassName({ className: "mt-5" })}>
              {copy.courses}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
