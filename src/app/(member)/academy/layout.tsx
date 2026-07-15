import { NavigationShell } from "@/components/layout/navigation-shell";
import { AiConcierge } from "@/components/academy/ai-concierge";
import { AnnouncementLayer } from "@/components/academy/announcement-layer";
import { MemberWelcomeModal } from "@/components/academy/member-welcome-modal";
import { getActiveAnnouncementsForUser } from "@/lib/announcements";
import { requireUser } from "@/lib/auth";
import { getTenantBranding } from "@/lib/branding";
import { getCurrentUserNotificationData } from "@/lib/notifications";
import { getPendingMemberWelcome } from "@/lib/member-welcome";
import { safeAvatarSource } from "@/lib/avatar-policy";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getSupportLauncherConfiguration } from "@/lib/support";
import { listMemberSidebarLinks } from "@/lib/member-sidebar-links";

export const dynamic = "force-dynamic";

export default async function AcademyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  const [announcements, branding, notificationData, pendingWelcome, support, sidebarLinks] =
    await Promise.all([
      getActiveAnnouncementsForUser(user.id, user.organizationId),
      getTenantBranding(user.organizationId),
      getCurrentUserNotificationData(locale),
      user.role === "member"
        ? getPendingMemberWelcome(user.organizationId, user.id)
        : Promise.resolve(null),
      getSupportLauncherConfiguration(user),
      listMemberSidebarLinks(user.organizationId),
    ]);
  return (
    <>
      <NavigationShell
        mode="member"
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
        memberSidebarLinks={sidebarLinks}
      >
        <AnnouncementLayer announcements={announcements} locale={locale} />
        {children}
      </NavigationShell>
      {pendingWelcome ? (
        <MemberWelcomeModal welcome={pendingWelcome} locale={locale} />
      ) : null}
      <AiConcierge locale={locale} />
    </>
  );
}
