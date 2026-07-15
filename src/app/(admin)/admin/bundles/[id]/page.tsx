import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { BundleDetailManager } from "@/components/admin/bundle-detail-manager";
import { Badge } from "@/components/ui/badge";
import { requireOrganizationAdmin } from "@/lib/auth";
import { getAdminBundleDetail } from "@/lib/data";
import {
  formatAdminEntityNumber,
  getAdminEntityCopy,
} from "@/lib/i18n/admin-entities";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export default async function AdminBundleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireOrganizationAdmin();
  const [data, locale] = await Promise.all([
    getAdminBundleDetail(id, actor.organizationId),
    resolveUserLocale(actor),
  ]);
  if (!data) notFound();
  const copy = getAdminEntityCopy(locale);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            href="/admin/bundles"
            className="focus-ring mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-[#dfe4e8] bg-white text-[#66727f] hover:bg-[#f1f3f5]"
            aria-label={copy("bundle.back")}
            title={copy("common.back")}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span
            className="grid size-10 shrink-0 place-items-center rounded-md bg-[#f2f4f5]"
            style={{ color: data.bundle.color }}
          >
            <PackageOpen className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy("bundle.detailEyebrow")}
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-bold text-[#17212b]">
              {data.bundle.name}
            </h1>
            <p className="mt-1 text-xs text-[#7a8690]">
              {copy("common.createdAt", {
                date: formatDate(data.bundle.createdAt, undefined, locale),
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={data.bundle.active ? "teal" : "neutral"}>
            {data.bundle.active
              ? copy("common.active")
              : copy("common.paused")}
          </Badge>
          <Badge tone="blue">
            {copy("common.courseCount", {
              count: formatAdminEntityNumber(data.bundle.courseCount, locale),
            })}
          </Badge>
        </div>
      </header>
      <BundleDetailManager data={data} locale={locale} />
    </div>
  );
}
