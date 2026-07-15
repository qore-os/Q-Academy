import type { Metadata } from "next";
import { MemberTable } from "@/components/admin/member-table";
import { MemberPropertyAnalytics } from "@/components/admin/member-property-analytics";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth";
import { getAdminMembers } from "@/lib/data";
import { getTeamAccessForUser } from "@/lib/team-permissions";
import { teamPermissionAllows } from "@/lib/team-permission-policy";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getMemberPropertyAnalytics } from "@/lib/member-properties";
import { memberPropertyAnalyticsQuerySchema } from "@/lib/member-property-model";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getMainPageDictionary(locale).admin.headers.members.title };
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    property?: string;
    operator?: string;
    value?: string;
  }>;
}) {
  const user = await requireAdmin();
  const [members, teamAccess, locale, query] = await Promise.all([
    getAdminMembers(user.organizationId),
    getTeamAccessForUser(user),
    resolveUserLocale(user),
    searchParams,
  ]);
  const copy = getMainPageDictionary(locale).admin.headers.members;
  const canManageMembers = teamPermissionAllows(
    teamAccess.permissions,
    "members.manage",
  );
  const canViewAnalytics = teamPermissionAllows(
    teamAccess.permissions,
    "analytics.view",
  );
  const [fieldId, profileDefinitionId] = (query.property ?? "").split(":");
  const parsedQuery = memberPropertyAnalyticsQuerySchema.safeParse({
    fieldId: fieldId || undefined,
    profileDefinitionId: profileDefinitionId || undefined,
    operator: query.operator || "is_set",
    value: query.value || undefined,
  });
  const propertyAnalytics = canViewAnalytics
    ? await getMemberPropertyAnalytics({
        organizationId: user.organizationId,
        viewer: user,
        query: parsedQuery.success ? parsedQuery.data : { operator: "is_set" },
        revealMatchedMembers: canManageMembers,
      })
    : null;
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader {...copy} />
      {propertyAnalytics ? (
        <MemberPropertyAnalytics
          analytics={propertyAnalytics}
          canExport={canManageMembers}
          locale={locale}
        />
      ) : null}
      <MemberTable members={members} canManageMembers={canManageMembers} currentUserId={user.id} locale={locale} />
    </div>
  );
}
