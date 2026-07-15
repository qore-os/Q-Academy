import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function CertificatesAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="members.view">{children}</TeamPermissionBoundary>;
}

