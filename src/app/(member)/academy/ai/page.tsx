import { AiWorkspace } from "@/components/academy/ai-workspace";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";

export const metadata = { title: "Q-Coach" };

export default async function AiCoachPage() {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  const copy = getMainPageDictionary(locale).academy.coach;
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        eyebrow={copy.eyebrow}
        title="Q-Coach"
        actions={
          <Badge tone="teal">
            <span className="status-live-dot mr-1.5 size-1.5 rounded-full bg-[#2bb7a9]" />
            {copy.available}
          </Badge>
        }
      />
      <AiWorkspace locale={locale} />
    </div>
  );
}
