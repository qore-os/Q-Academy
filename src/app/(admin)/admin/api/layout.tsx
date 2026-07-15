import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function ApiAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="api.view">{children}</TeamPermissionBoundary>;
}
