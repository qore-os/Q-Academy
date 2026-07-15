import type { Metadata } from "next";
import { AdminCreateButton } from "@/components/admin/admin-create-dialog";
import { EventManager } from "@/components/admin/event-manager";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth";
import { getAdminEventManagementData } from "@/lib/event-data";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { getEventAdminCopy } from "@/lib/i18n/event-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getEventAdminCopy(locale).page.metadataTitle };
}

export default async function AdminEventsPage() {
  const user = await requireAdmin();
  const [data, locale] = await Promise.all([
    getAdminEventManagementData(user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getMainPageDictionary(locale).admin.headers.events;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        {...copy}
        actions={<AdminCreateButton resource="event" locale={locale} />}
      />
      <EventManager
        events={data.events}
        members={data.members}
        groups={data.groups}
        bundles={data.bundles}
        calendarTheme={data.calendarTheme}
        locale={locale}
      />
    </div>
  );
}
