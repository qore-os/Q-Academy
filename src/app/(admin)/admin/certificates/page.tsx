import Link from "next/link";
import type { Metadata } from "next";
import {
  Award,
  Ban,
  CheckCircle2,
  Eye,
  Search,
  Users,
} from "lucide-react";
import { CertificateAdminActions } from "@/components/admin/certificate-admin-actions";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { getAdminCertificates } from "@/lib/certificates";
import {
  coursePermissionAllows,
  coursePermissionMapForUser,
} from "@/lib/course-permissions";
import { formatDate } from "@/lib/utils";
import { intlLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getCertificateCopy } from "@/lib/i18n/certificates";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireAdmin();
  const locale = await resolveUserLocale(actor);
  return { title: getCertificateCopy(locale).admin.metadataTitle };
}

export default async function AdminCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const actor = await requireAdmin();
  const [{ q = "", status = "all" }, allCertificates, locale] = await Promise.all([
    searchParams,
    getAdminCertificates(actor.organizationId),
    resolveUserLocale(actor),
  ]);
  const copy = getCertificateCopy(locale).admin;
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));
  const permissions = await coursePermissionMapForUser(
    actor,
    allCertificates.map((certificate) => certificate.courseId),
  );
  const certificates = allCertificates.filter((certificate) =>
    coursePermissionAllows(
      permissions.get(certificate.courseId) ?? null,
      "edit",
    ),
  );
  const query = q.trim().toLocaleLowerCase(intlLocale(locale));
  const filtered = certificates.filter((certificate) => {
    const revoked = Boolean(certificate.revokedAt);
    if (status === "active" && revoked) return false;
    if (status === "revoked" && !revoked) return false;
    if (!query) return true;
    return [
      certificate.recipientName,
      certificate.currentEmail,
      certificate.courseTitle,
      certificate.certificateNumber,
    ].some((value) => value.toLocaleLowerCase(intlLocale(locale)).includes(query));
  });
  const activeCount = certificates.filter((certificate) => !certificate.revokedAt).length;
  const revokedCount = certificates.length - activeCount;
  const canManage = actor.role === "owner" || actor.role === "admin";

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header>
        <p className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold text-[#17212b]">{copy.title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#66727f]">
          {copy.description}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: copy.total, value: certificates.length, icon: Award, tone: "text-[#4f7cac] bg-[#eef3f9]" },
          { label: copy.valid, value: activeCount, icon: CheckCircle2, tone: "text-[#167e74] bg-[#e9f8f6]" },
          { label: copy.revoked, value: revokedCount, icon: Ban, tone: "text-[#b8493e] bg-[#fff0ee]" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="panel flex items-center gap-3 p-4">
              <span className={`grid size-10 place-items-center rounded-md ${item.tone}`}>
                <Icon className="size-4" />
              </span>
              <div>
                <p className="text-xl font-bold text-[#243444]">{numberFormat.format(item.value)}</p>
                <p className="text-[10px] text-[#71808b]">{item.label}</p>
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel overflow-hidden">
        <form className="flex flex-col gap-3 border-b border-[#e6eaed] p-4 md:flex-row md:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.search}</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#87919a]" />
              <input
                name="q"
                defaultValue={q}
                placeholder={copy.searchPlaceholder}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] pl-9 pr-3 text-sm"
              />
            </span>
          </label>
          <label className="md:w-48">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.status}</span>
            <select
              name="status"
              defaultValue={status}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
            >
              <option value="all">{copy.all}</option>
              <option value="active">{copy.valid}</option>
              <option value="revoked">{copy.revoked}</option>
            </select>
          </label>
          <button className={buttonClassName()} type="submit">{copy.filter}</button>
        </form>

        {filtered.length ? (
          <div className="divide-y divide-[#edf0f2]">
            {filtered.map((certificate) => {
              const revoked = Boolean(certificate.revokedAt);
              return (
                <article key={certificate.id} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] md:items-center lg:p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/members/${certificate.userId}`}
                        className="focus-ring truncate text-sm font-bold text-[#243444] hover:text-[#2b9188]"
                      >
                        {certificate.recipientName}
                      </Link>
                      <Badge tone={revoked ? "coral" : "teal"}>{revoked ? copy.revoked : copy.valid}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#71808b]">{certificate.currentEmail}</p>
                    <p className="mt-2 flex items-center gap-2 text-[10px] text-[#71808b]">
                      <Users className="size-3.5" /> {copy.completed(formatDate(certificate.completedAt, undefined, locale))}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/admin/courses/${certificate.courseId}`}
                      className="focus-ring block truncate text-xs font-semibold text-[#365f8d] hover:text-[#2b9188]"
                    >
                      {certificate.courseTitle}
                    </Link>
                    <p className="mt-1 truncate font-mono text-[10px] text-[#7a8690]">{certificate.certificateNumber}</p>
                    <p className="mt-1 text-[10px] text-[#7a8690]">{copy.issued(formatDate(certificate.issuedAt, undefined, locale))}</p>
                    {certificate.revocationReason ? (
                      <p className="mt-2 text-[10px] leading-4 text-[#a44a41]">{certificate.revocationReason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start gap-2 md:justify-end">
                    <Link
                      href={`/admin/certificates/${certificate.id}`}
                      className={buttonClassName({ variant: "secondary", size: "sm" })}
                    >
                      <Eye className="size-3.5" />
                       {copy.view}
                    </Link>
                    {canManage ? (
                       <CertificateAdminActions certificateId={certificate.id} revoked={revoked} locale={locale} />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <Award className="mx-auto size-8 text-[#9aa4ad]" />
              <h2 className="mt-3 text-sm font-bold text-[#243444]">{copy.emptyTitle}</h2>
              <p className="mt-1 text-xs text-[#71808b]">{copy.emptyDescription}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
