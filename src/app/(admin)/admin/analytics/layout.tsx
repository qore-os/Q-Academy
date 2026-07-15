import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function AnalyticsAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="analytics.view">{children}</TeamPermissionBoundary>;
}

