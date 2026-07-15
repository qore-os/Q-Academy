import type { Metadata } from "next";

import { OrbitConsole } from "@/components/orbit/orbit-console";
import { OrbitOnboarding } from "@/components/orbit/orbit-onboarding";
import { requireUser } from "@/lib/auth";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getOrbitCopy } from "@/lib/i18n/orbit";
import { getOrbitActor } from "@/lib/orbit/access";
import {
  getOrbitWorkspaceOverview,
  listOrbitWorkspaces,
} from "@/lib/orbit/service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return { title: `Orbit ${getOrbitCopy(locale).common.controlPlane}` };
}

export default async function OrbitPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; instance?: string }>;
}) {
  const user = await requireUser();
  const [actor, locale] = await Promise.all([
    getOrbitActor(user),
    resolveUserLocale(user),
  ]);
  if (!actor) {
    return (
      <OrbitOnboarding
        canBootstrap={user.role === "owner"}
        tenantName={`${user.firstName} ${user.lastName}`.trim()}
        locale={locale}
      />
    );
  }
  const listing = await listOrbitWorkspaces(user);
  if (!listing.workspaces.length) {
    return (
      <OrbitOnboarding
        canBootstrap={user.role === "owner"}
        tenantName={actor.displayName}
        locale={locale}
      />
    );
  }
  const query = await searchParams;
  const selectedWorkspace =
    listing.workspaces.find((workspace) => workspace.id === query.workspace) ??
    listing.workspaces[0]!;
  const overview = await getOrbitWorkspaceOverview(user, selectedWorkspace.id);
  return (
    <OrbitConsole
      workspaces={JSON.parse(JSON.stringify(listing.workspaces))}
      overview={JSON.parse(JSON.stringify(overview))}
      selectedOrganizationId={query.instance ?? null}
      locale={locale}
    />
  );
}
