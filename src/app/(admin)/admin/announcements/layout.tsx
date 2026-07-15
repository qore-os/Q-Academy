import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function AnnouncementsAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="community.view">{children}</TeamPermissionBoundary>;
}

