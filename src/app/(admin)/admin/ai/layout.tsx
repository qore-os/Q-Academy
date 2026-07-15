import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function AiAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="ai.view">{children}</TeamPermissionBoundary>;
}

