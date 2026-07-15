import Link from "next/link";
import { Bookmark, BookOpen, Clock3, PlayCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { resolveUserLocale } from "@/lib/i18n/server";
import { listAccessibleLessonBookmarks } from "@/lib/lesson-bookmarks";

export async function generateMetadata() {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return { title: getMemberExperienceCopy(locale).bookmarks.metadataTitle };
}

export default async function BookmarksPage() {
  const user = await requireUser();
  const [groups, locale] = await Promise.all([
    listAccessibleLessonBookmarks({
      organizationId: user.organizationId,
      userId: user.id,
    }),
    resolveUserLocale(user),
  ]);
  const copy = getMemberExperienceCopy(locale).bookmarks;
  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="border-b border-[#dfe4e8] pb-5">
        <p className="text-[10px] font-bold uppercase text-[#2b9188]">
          {copy.eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#243444]">{copy.title}</h1>
        <p className="mt-1 text-sm text-[#71808b]">
          {copy.description}
        </p>
      </header>

      {groups.length ? (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.course.id} aria-labelledby={`course-${group.course.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id={`course-${group.course.id}`} className="flex items-center gap-2 text-lg font-bold text-[#243444]">
                  <BookOpen className="size-5 text-[#4f7cac]" />
                  {group.course.title}
                </h2>
                <Link href={`/academy/courses/${group.course.slug}`} className="focus-ring rounded-md text-xs font-semibold text-[#365f8d] hover:text-[#17324d]">
                  {copy.openCourse}
                </Link>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {group.modules.map((module) => (
                  <div key={module.id} className="panel overflow-hidden">
                    <h3 className="border-b border-[#e8ebee] bg-[#f7f9fa] px-4 py-3 text-sm font-bold text-[#354555]">
                      {module.title}
                    </h3>
                    <div className="divide-y divide-[#edf0f2]">
                      {module.lessons.map((lesson) => (
                        <Link key={lesson.id} href={lesson.href} className="focus-ring flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-[#f7f9fa]">
                          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
                            <PlayCircle className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#354555]">{lesson.title}</span>
                            <span className="mt-1 flex items-center gap-1 text-[10px] text-[#7a8690]">
                              <Clock3 className="size-3" /> {copy.minutes(lesson.durationMinutes)}
                            </span>
                          </span>
                          <Bookmark className="size-4 shrink-0 text-[#2b9188]" />
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="py-16 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-md bg-[#eef3f9] text-[#4f7cac]">
            <Bookmark className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-bold text-[#354555]">{copy.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#71808b]">
            {copy.emptyDescription}
          </p>
          <Link href="/academy/courses" className="focus-ring mt-5 inline-flex h-9 items-center rounded-md bg-[#17324d] px-4 text-xs font-semibold text-white hover:bg-[#244660]">
            {copy.courses}
          </Link>
        </section>
      )}
    </div>
  );
}
