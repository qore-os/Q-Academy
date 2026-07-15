import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function EmailAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="settings.view">{children}</TeamPermissionBoundary>;
}

