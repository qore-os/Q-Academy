import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function ModulesAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="courses.view">{children}</TeamPermissionBoundary>;
}

