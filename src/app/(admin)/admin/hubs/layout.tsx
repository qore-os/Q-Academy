import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function HubsAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="settings.view">{children}</TeamPermissionBoundary>;
}

