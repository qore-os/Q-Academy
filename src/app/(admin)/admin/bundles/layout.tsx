import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function BundlesAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="members.view">{children}</TeamPermissionBoundary>;
}

