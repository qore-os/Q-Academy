import type { ReactNode } from "react";
import { requireTeamPermission } from "@/lib/auth";
import type { TeamPermissionKey } from "@/lib/team-permission-policy";

export async function TeamPermissionBoundary({
  permission,
  children,
}: {
  permission: TeamPermissionKey;
  children: ReactNode;
}) {
  await requireTeamPermission(permission);
  return children;
}

