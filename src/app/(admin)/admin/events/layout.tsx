import { TeamPermissionBoundary } from "@/components/admin/team-permission-boundary";

export default function EventsAdminLayout({ children }: { children: React.ReactNode }) {
  return <TeamPermissionBoundary permission="events.view">{children}</TeamPermissionBoundary>;
}

