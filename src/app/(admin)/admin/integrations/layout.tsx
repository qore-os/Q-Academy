import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function IntegrationsAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="integrations.view">{children}</TeamPermissionBoundary>;
}

