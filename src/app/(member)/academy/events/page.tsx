import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { EventList } from "@/components/academy/event-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { getEventsData } from "@/lib/event-data";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { getEventAdminCopy } from "@/lib/i18n/event-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return { title: getEventAdminCopy(locale).page.metadataTitle };
}

export default async function EventsPage() {
  const user = await requireUser();
  const [data, locale] = await Promise.all([
    getEventsData(user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getCoreDictionary(locale).experience.events;
  const { commitments: commitmentLabel, ...eventListCopy } = copy;
  const referenceTime = new Date().toISOString();
  const commitments = data.events.filter(
    (event) => event.status === "scheduled" && event.myStatus === "going",
  ).length;
  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={
          <span className="flex items-center gap-2 rounded-md bg-[#e9f8f6] px-3 py-2 text-xs font-semibold text-[#167e74]">
            <CalendarDays className="size-4" />
            {commitmentLabel(commitments)}
          </span>
        }
      />
      <EventList
        events={data.events}
        calendarTheme={data.calendarTheme}
        copy={eventListCopy}
        referenceTime={referenceTime}
        locale={locale}
      />
    </div>
  );
}
