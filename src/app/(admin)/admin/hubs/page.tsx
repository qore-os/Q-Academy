import Link from "next/link";
import { ArrowUpRight, Compass, Users } from "lucide-react";
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
  return { title: getAdminEntityCopy(locale)("hub.pageTitle") };
}

export default async function HubsPage() {
  const user = await requireAdmin();
  const [{ hubs }, locale] = await Promise.all([
    getOrganizationExperienceData(user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getAdminEntityCopy(locale);
  const canManage = user.role === "owner" || user.role === "admin";
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy("hub.pageEyebrow")}
        title={copy("hub.pageTitle")}
        description={copy("hub.pageDescription")}
        actions={
          canManage ? (
            <AdminCreateButton resource="hub" locale={locale} />
          ) : undefined
        }
      />
      <div className="panel overflow-hidden">
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          {hubs.map((hub, index) => {
            const content = (
              <>
                <span
                  className={`grid size-11 place-items-center rounded-md ${index % 2 ? "bg-[#eef3f9] text-[#365f8d]" : "bg-[#e9f8f6] text-[#167e74]"}`}
                >
                  <Compass className="size-5" />
                </span>
                <div className="mt-4 flex items-center gap-2">
                  <h2 className="text-base font-bold text-[#243444]">
                    {hub.title}
                  </h2>
                  <Badge tone={hub.status === "published" ? "teal" : "amber"}>
                    {hub.status === "published"
                      ? copy("common.live")
                      : copy("common.draft")}
                  </Badge>
                </div>
                <p className="mt-2 min-h-12 text-xs leading-5 text-[#6c7882]">
                  {hub.description}
                </p>
                <div className="mt-4 flex items-center border-t border-[#edf0f2] pt-4">
                  <span className="flex items-center gap-1.5 text-[10px] text-[#7a8690]">
                    <Users className="size-3.5" />
                    {hub.accessRuleCount
                      ? copy("common.ruleCount", {
                          count: formatAdminEntityNumber(
                            hub.accessRuleCount,
                            locale,
                          ),
                        })
                      : copy("hub.forAll")}
                  </span>
                  {canManage ? (
                    <ArrowUpRight className="ml-auto size-4 text-[#84909a] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  ) : null}
                </div>
              </>
            );
            return canManage ? (
              <Link
                id={`hub-${hub.id}`}
                key={hub.id}
                href={`/admin/hubs/${hub.id}`}
                className="focus-ring group scroll-mt-24 rounded-md border border-[#e1e5e8] bg-white p-5 hover:border-[#b8deda] hover:shadow-md"
                aria-label={copy("hub.editNamed", { name: hub.title })}
              >
                {content}
              </Link>
            ) : (
              <article
                id={`hub-${hub.id}`}
                key={hub.id}
                className="scroll-mt-24 rounded-md border border-[#e1e5e8] bg-white p-5"
              >
                {content}
              </article>
            );
          })}
          {!hubs.length ? (
            <EmptyState
              icon={Compass}
              title={copy("hub.empty")}
              description={
                canManage
                  ? copy("hub.emptyManage")
                  : copy("hub.emptyRead")
              }
              action={
                canManage ? (
                  <AdminCreateButton
                    resource="hub"
                    label={copy("hub.createFirst")}
                    locale={locale}
                  />
                ) : undefined
              }
              className="md:col-span-2 xl:col-span-3"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
