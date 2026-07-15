import Link from "next/link";
import type { Metadata } from "next";
import { Boxes, Clock3, FileQuestion, Pencil, RefreshCw } from "lucide-react";
import { AdminCreateButton } from "@/components/admin/admin-create-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrganizationAdmin } from "@/lib/auth";
import { getAdminModules } from "@/lib/data";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDate, formatDuration } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getMainPageDictionary(locale).admin.headers.modules.title };
}

export default async function ModulesPage() {
  const user = await requireOrganizationAdmin();
  const [modules, locale] = await Promise.all([
    getAdminModules(user.organizationId),
    resolveUserLocale(user),
  ]);
  const dictionary = getMainPageDictionary(locale).admin;
  const headerCopy = dictionary.headers.modules;
  const copy = dictionary.modules;
  const folders = [...new Set(modules.map((module) => module.folder))];
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        {...headerCopy}
        actions={<AdminCreateButton resource="module" locale={locale} />}
      />
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#e8ebee] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-[#243444]">
              {copy.count(modules.length)}
            </p>
            <p className="mt-0.5 text-[11px] text-[#7a8690]">
              {copy.folders(folders.length)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {folders.map((folder) => (
              <Badge key={folder} tone="neutral">
                {folder}
              </Badge>
            ))}
          </div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <article
              id={`module-${module.id}`}
              key={module.id}
              className="scroll-mt-24 rounded-md border border-[#e1e5e8] p-4 hover:shadow-md"
            >
              <span className={module.kind === "exam" ? "grid size-10 shrink-0 place-items-center rounded-md bg-[#fdf0ee] text-[#b84e42]" : "grid size-10 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]"}>
                {module.kind === "exam" ? <FileQuestion className="size-5" /> : <Boxes className="size-5" />}
              </span>
              <p className="mt-3 text-[10px] font-bold uppercase text-[#7d8891]">
                {module.folder}
              </p>
              <h2 className="mt-1 text-sm font-bold text-[#2b3a48]">
                {module.title}
              </h2>
              <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-[#6c7882]">
                {module.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone={module.kind === "exam" ? "coral" : "blue"}>
                  {module.kind === "exam" ? copy.examModule : copy.learningModule}
                </Badge>
                <Badge tone={module.usageCount > 1 ? "teal" : "neutral"}>
                  <RefreshCw className="mr-1 size-3" />
                  {copy.courseCount(module.usageCount)}
                </Badge>
                <Badge tone="neutral">{module.kind === "exam" ? copy.examCount : copy.lessonCount(module.lessonCount)}</Badge>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#edf0f2] pt-3 text-[10px] text-[#7d8891]">
                <span className="flex items-center gap-1">
                  <Clock3 className="size-3" />
                  {formatDuration(module.estimatedMinutes, locale)}
                </span>
                <span>{copy.edited(formatDate(module.updatedAt, undefined, locale))}</span>
              </div>
              <Link
                href={
                  module.firstCourseId
                    ? `/admin/courses/${module.firstCourseId}`
                    : "/admin/courses"
                }
                className={buttonClassName({
                  variant: "secondary",
                  size: "sm",
                  className: "mt-3 w-full",
                })}
              >
                <Pencil className="size-3.5" />
                {module.firstCourseId
                  ? copy.editInCourse
                  : copy.assignToCourse}
              </Link>
            </article>
          ))}
          {!modules.length ? (
            <EmptyState
              icon={Boxes}
              title={copy.emptyTitle}
              description={copy.emptyDescription}
              action={<AdminCreateButton resource="module" label={copy.createFirst} locale={locale} />}
              className="md:col-span-2 xl:col-span-3"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
