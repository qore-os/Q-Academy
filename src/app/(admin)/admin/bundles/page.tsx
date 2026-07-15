import Link from "next/link";
import {
  ArrowRight,
  BookCopy,
  CheckCircle2,
  PackageOpen,
  Settings2,
  Users,
} from "lucide-react";
import { AdminCreateButton } from "@/components/admin/admin-create-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth";
import { getOrganizationExperienceData } from "@/lib/data";
import {
  formatAdminEntityNumber,
  getAdminEntityCopy,
} from "@/lib/i18n/admin-entities";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata() {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getAdminEntityCopy(locale)("bundle.pageTitle") };
}

export default async function BundlesPage() {
  const user = await requireAdmin();
  const [{ bundles }, locale] = await Promise.all([
    getOrganizationExperienceData(user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getAdminEntityCopy(locale);
  const canManageAccess = user.role === "owner" || user.role === "admin";
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy("bundle.pageEyebrow")}
        title={copy("bundle.pageTitle")}
        description={copy("bundle.pageDescription")}
        actions={
          canManageAccess ? (
            <AdminCreateButton resource="bundle" locale={locale} />
          ) : undefined
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bundles.map((bundle) => (
          <article key={bundle.id} className="panel overflow-hidden">
            <div className="h-1.5" style={{ backgroundColor: bundle.color }} />
            <div className="p-5">
              <span
                className="grid size-11 place-items-center rounded-md bg-[#f2f4f5]"
                style={{ color: bundle.color }}
              >
                <PackageOpen className="size-5" />
              </span>
              <div className="mt-4 flex items-center gap-2">
                {canManageAccess ? (
                  <Link
                    href={`/admin/bundles/${bundle.id}`}
                    className="focus-ring rounded text-base font-bold text-[#243444] hover:text-[#176f68]"
                  >
                    {bundle.name}
                  </Link>
                ) : (
                  <h2 className="text-base font-bold text-[#243444]">
                    {bundle.name}
                  </h2>
                )}
                <Badge tone={bundle.active ? "teal" : "neutral"}>
                  {bundle.active
                    ? copy("common.active")
                    : copy("common.paused")}
                </Badge>
              </div>
              <p className="mt-2 min-h-12 text-xs leading-5 text-[#6c7882]">
                {bundle.description}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2 border-y border-[#edf0f2] py-4">
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] text-[#7a8690]">
                    <BookCopy className="size-3.5" />
                    {copy("common.courses")}
                  </p>
                  <p className="mt-1 text-lg font-bold text-[#354555]">
                    {formatAdminEntityNumber(bundle.courseCount, locale)}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] text-[#7a8690]">
                    <Users className="size-3.5" />
                    {copy("common.accessRules")}
                  </p>
                  <p className="mt-1 text-lg font-bold text-[#354555]">
                    {formatAdminEntityNumber(bundle.assignmentCount, locale)}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[10px] text-[#2b9188]">
                <CheckCircle2 className="size-3.5" />
                {copy("bundle.sync")}
              </div>
              {canManageAccess ? (
                <Link
                  href={`/admin/bundles/${bundle.id}`}
                  className="focus-ring mt-4 flex h-9 items-center justify-between rounded-md border border-[#dfe4e8] px-3 text-xs font-semibold text-[#52606d] hover:bg-[#f4f6f7] hover:text-[#17324d]"
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="size-3.5" />
                    {copy("bundle.manage")}
                  </span>
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </article>
        ))}
        {!bundles.length ? (
          <EmptyState
            icon={PackageOpen}
            title={copy("bundle.empty")}
            description={
              canManageAccess
                ? copy("bundle.emptyManage")
                : copy("bundle.emptyRead")
            }
            action={
              canManageAccess ? (
                <AdminCreateButton
                  resource="bundle"
                  label={copy("bundle.createFirst")}
                  locale={locale}
                />
              ) : undefined
            }
            className="panel md:col-span-2 xl:col-span-3"
          />
        ) : null}
      </div>
    </div>
  );
}
