import type { Metadata } from "next";
import { TeamRoleManager } from "@/components/admin/team-role-manager";
import { PageHeader } from "@/components/ui/page-header";
import { requireOwner } from "@/lib/auth";
import { getTeamRoleAdminData } from "@/lib/team-permissions";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getTeamRoleCopy } from "@/lib/i18n/team-roles";

export async function generateMetadata(): Promise<Metadata> {
  const owner = await requireOwner();
  const locale = await resolveUserLocale(owner);
  return { title: getTeamRoleCopy(locale).page.metadataTitle };
}

export default async function TeamRolesPage() {
  const owner = await requireOwner();
  const [data, locale] = await Promise.all([
    getTeamRoleAdminData(owner.organizationId),
    resolveUserLocale(owner),
  ]);
  const copy = getTeamRoleCopy(locale).page;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <TeamRoleManager
        roles={data.roles}
        assignments={data.assignments}
        staff={data.staff as Array<{
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          role: "admin" | "trainer";
        }>}
        locale={locale}
      />
    </div>
  );
}
