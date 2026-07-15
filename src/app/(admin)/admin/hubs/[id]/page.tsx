import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Compass } from "lucide-react";
import { HubEditor } from "@/components/admin/hub-editor";
import { Badge } from "@/components/ui/badge";
import { requireTeamPermission } from "@/lib/auth";
import { getHubAdminData } from "@/lib/hub-admin";
import { getAdminEntityCopy } from "@/lib/i18n/admin-entities";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export default async function HubDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireTeamPermission("settings.manage");
  const [data, locale] = await Promise.all([
    getHubAdminData(id),
    resolveUserLocale(actor),
  ]);
  if (!data) notFound();
  const copy = getAdminEntityCopy(locale);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            href="/admin/hubs"
            className="focus-ring mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-[#dfe4e8] bg-white text-[#66727f] hover:bg-[#f1f3f5]"
            aria-label={copy("hub.back")}
            title={copy("common.back")}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
            <Compass className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-[#1d2b38]">
                {data.hub.title}
              </h1>
              <Badge
                tone={
                  data.hub.status === "published"
                    ? "teal"
                    : data.hub.status === "archived"
                      ? "neutral"
                      : "amber"
                }
              >
                {data.hub.status === "published"
                  ? copy("common.published")
                  : data.hub.status === "archived"
                    ? copy("common.archived")
                    : copy("common.draft")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#74818c]">
              {copy("hub.created", {
                slug: data.hub.slug,
                date: formatDate(data.hub.createdAt, undefined, locale),
              })}
            </p>
          </div>
        </div>
      </header>
      <HubEditor data={data} locale={locale} />
    </div>
  );
}
