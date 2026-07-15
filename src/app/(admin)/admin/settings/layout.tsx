import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function SettingsAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="settings.view">{children}</TeamPermissionBoundary>;
}

