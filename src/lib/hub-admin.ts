import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiAgents,
  aiAgentVersions,
  bundles,
  dataForms,
  groups,
  hubAccessGrants,
  hubs,
  users,
  type HubLayout,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { publicHubLayout } from "@/lib/hub-layout";
import { listMemberPropertyVariableCatalog } from "@/lib/member-properties";

export type HubAccessSubjectType = "user" | "group" | "bundle";

export type HubAdminData = {
  hub: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    status: "draft" | "published" | "archived";
    layout: HubLayout;
    createdAt: Date;
  };
  grants: Array<{
    subjectType: HubAccessSubjectType;
    subjectId: string;
    subjectName: string;
    subjectMissing: boolean;
    createdAt: Date;
  }>;
  subjects: {
    users: Array<{ id: string; label: string }>;
    groups: Array<{ id: string; label: string }>;
    bundles: Array<{ id: string; label: string }>;
  };
  forms: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  variables: Array<{ token: string; label: string }>;
};

export async function getHubAdminData(
  hubId: string,
): Promise<HubAdminData | null> {
  const user = await requireTeamPermission("settings.manage");
  const [hub] = await db
    .select({
      id: hubs.id,
      title: hubs.title,
      slug: hubs.slug,
      description: hubs.description,
      status: hubs.status,
      layout: hubs.layout,
      createdAt: hubs.createdAt,
    })
    .from(hubs)
    .where(
      and(eq(hubs.id, hubId), eq(hubs.organizationId, user.organizationId)),
    )
    .limit(1);
  if (!hub) return null;

  const [grantRows, userRows, groupRows, bundleRows, formRows, agentRows, propertyVariables] = await Promise.all([
    db
      .select({
        subjectType: hubAccessGrants.subjectType,
        subjectId: hubAccessGrants.subjectId,
        createdAt: hubAccessGrants.createdAt,
      })
      .from(hubAccessGrants)
      .where(eq(hubAccessGrants.hubId, hub.id))
      .orderBy(asc(hubAccessGrants.createdAt)),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.organizationId, user.organizationId))
      .orderBy(asc(users.firstName), asc(users.lastName)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.organizationId, user.organizationId))
      .orderBy(asc(groups.name)),
    db
      .select({ id: bundles.id, name: bundles.name })
      .from(bundles)
      .where(eq(bundles.organizationId, user.organizationId))
      .orderBy(asc(bundles.name)),
    db
      .select({ id: dataForms.id, name: dataForms.name })
      .from(dataForms)
      .where(
        and(
          eq(dataForms.organizationId, user.organizationId),
          eq(dataForms.active, true),
        ),
      )
      .orderBy(asc(dataForms.name)),
    db
      .select({ id: aiAgents.id, name: aiAgentVersions.name })
      .from(aiAgents)
      .innerJoin(
        aiAgentVersions,
        and(
          eq(aiAgentVersions.id, aiAgents.publishedVersionId),
          eq(aiAgentVersions.agentId, aiAgents.id),
          eq(aiAgentVersions.organizationId, aiAgents.organizationId),
          eq(aiAgentVersions.state, "published"),
        ),
      )
      .where(
        and(
          eq(aiAgents.organizationId, user.organizationId),
          eq(aiAgents.active, true),
        ),
      )
      .orderBy(asc(aiAgentVersions.name), asc(aiAgents.id)),
    listMemberPropertyVariableCatalog(user.organizationId),
  ]);

  const subjects = {
    users: userRows.map((subject) => ({
      id: subject.id,
      label: `${subject.firstName} ${subject.lastName} (${subject.email})`,
    })),
    groups: groupRows.map((subject) => ({
      id: subject.id,
      label: subject.name,
    })),
    bundles: bundleRows.map((subject) => ({
      id: subject.id,
      label: subject.name,
    })),
  };
  const names = {
    user: new Map(subjects.users.map((subject) => [subject.id, subject.label])),
    group: new Map(
      subjects.groups.map((subject) => [subject.id, subject.label]),
    ),
    bundle: new Map(
      subjects.bundles.map((subject) => [subject.id, subject.label]),
    ),
  };

  return {
    hub: { ...hub, layout: publicHubLayout(hub.layout) },
    forms: formRows,
    agents: agentRows,
    variables: [
      { token: "member.firstName", label: "Mitglied: Vorname" },
      { token: "member.lastName", label: "Mitglied: Nachname" },
      { token: "member.fullName", label: "Mitglied: Voller Name" },
      { token: "course.title", label: "Fokuskurs: Titel" },
      { token: "course.progress", label: "Fokuskurs: Fortschritt" },
      ...propertyVariables.map((variable) => ({
        token: variable.token,
        label: variable.label,
      })),
    ],
    grants: grantRows
      .filter(
        (
          grant,
        ): grant is typeof grant & {
          subjectType: HubAccessSubjectType;
        } => ["user", "group", "bundle"].includes(grant.subjectType),
      )
      .map((grant) => {
        const subjectName = names[grant.subjectType].get(grant.subjectId);
        return {
          ...grant,
          subjectName: subjectName ?? "",
          subjectMissing: !subjectName,
        };
      }),
    subjects,
  };
}
