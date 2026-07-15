import Link from "next/link";
import { Settings2, UsersRound } from "lucide-react";
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
import { formatDate } from "@/lib/utils";

export async function generateMetadata() {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getAdminEntityCopy(locale)("group.pageTitle") };
}

export default async function GroupsPage() {
  const user = await requireAdmin();
  const [{ groups }, locale] = await Promise.all([
    getOrganizationExperienceData(user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getAdminEntityCopy(locale);
  const canManageAccess = user.role === "owner" || user.role === "admin";
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy("group.pageEyebrow")}
        title={copy("group.pageTitle")}
        description={copy("group.pageDescription")}
        actions={
          canManageAccess ? (
            <AdminCreateButton resource="group" locale={locale} />
          ) : undefined
        }
      />
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[#e8ebee] px-5 py-4">
          <div>
            <p className="text-sm font-bold text-[#243444]">
              {copy("group.inventory")}
            </p>
            <p className="mt-0.5 text-[11px] text-[#7a8690]">
              {copy("group.inventoryHint")}
            </p>
          </div>
          <Badge tone="neutral">
            {copy("common.groupCount", {
              count: formatAdminEntityNumber(groups.length, locale),
            })}
          </Badge>
        </div>
        {groups.length ? (
          <div className="table-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                <th className="px-5 py-3">{copy("common.group")}</th>
                <th className="px-5 py-3">{copy("common.members")}</th>
                <th className="px-5 py-3">{copy("group.tableAccess")}</th>
                <th className="px-5 py-3">{copy("group.tableCreated")}</th>
                <th className="px-5 py-3 text-right">
                  {copy("group.tableAction")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {groups.map((group) => (
                <tr key={group.id} className="hover:bg-[#fafbfb]">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid size-10 place-items-center rounded-md text-white"
                        style={{ backgroundColor: group.color }}
                      >
                        <UsersRound className="size-5" />
                      </span>
                      <div>
                        {canManageAccess ? (
                          <Link
                            href={`/admin/groups/${group.id}`}
                            className="focus-ring rounded text-sm font-semibold text-[#2b3a48] hover:text-[#176f68]"
                          >
                            {group.name}
                          </Link>
                        ) : (
                          <p className="text-sm font-semibold text-[#2b3a48]">
                            {group.name}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-[#7a8690]">
                          {group.description}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm font-semibold text-[#354555]">
                    {formatAdminEntityNumber(group.memberCount, locale)}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="blue">
                        {copy("common.courseCount", {
                          count: formatAdminEntityNumber(group.courseCount, locale),
                        })}
                      </Badge>
                      <Badge tone="neutral">
                        {copy("common.bundleCount", {
                          count: formatAdminEntityNumber(group.bundleCount, locale),
                        })}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs text-[#66727f]">
                    {formatDate(group.createdAt, undefined, locale)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {canManageAccess ? (
                      <Link
                        href={`/admin/groups/${group.id}`}
                        className="focus-ring inline-flex size-9 items-center justify-center rounded-md text-[#66727f] hover:bg-[#edf1f3] hover:text-[#17324d]"
                        aria-label={copy("group.manageNamed", {
                          name: group.name,
                        })}
                        title={copy("group.manage")}
                      >
                        <Settings2 className="size-4" />
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={UsersRound}
            title={copy("group.empty")}
            description={
              canManageAccess
                ? copy("group.emptyManage")
                : copy("group.emptyRead")
            }
            action={
              canManageAccess ? (
                <AdminCreateButton
                  resource="group"
                  label={copy("group.createFirst")}
                  locale={locale}
                />
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
