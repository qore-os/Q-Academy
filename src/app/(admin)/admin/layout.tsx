import { NavigationShell } from "@/components/layout/navigation-shell";
import { requireAdmin } from "@/lib/auth";
import { getTenantBranding } from "@/lib/branding";
import { getCurrentUserNotificationData } from "@/lib/notifications";
import { safeAvatarSource } from "@/lib/avatar-policy";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getSupportLauncherConfiguration } from "@/lib/support";
import { getTeamAccessForUser } from "@/lib/team-permissions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  const [branding, notificationData, support, teamAccess] = await Promise.all([
    getTenantBranding(user.organizationId),
    getCurrentUserNotificationData(locale),
    getSupportLauncherConfiguration(user),
    getTeamAccessForUser(user),
  ]);
  return (
    <NavigationShell
      mode="admin"
      locale={locale}
      user={{
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: safeAvatarSource(user.avatarUrl),
        role: user.role,
      }}
      branding={branding}
      notificationData={notificationData}
      support={support}
      teamPermissions={teamAccess.permissions}
    >
      {children}
    </NavigationShell>
  );
}
