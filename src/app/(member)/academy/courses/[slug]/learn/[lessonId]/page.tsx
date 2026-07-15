import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Clock3,
  FileQuestion,
  LockKeyhole,
  Link2,
  Menu,
  Play,
} from "lucide-react";
import { LessonContent } from "@/components/academy/lesson-content";
import { ExamLesson } from "@/components/academy/exam-lesson";
import {
  ExamGuardedLink,
  ExamNavigationBoundary,
} from "@/components/academy/exam-navigation-guard";
import { LessonFeedback } from "@/components/academy/lesson-feedback";
import { LearningTimeTracker } from "@/components/academy/learning-time-tracker";
import { LessonBookmarkToggle } from "@/components/academy/lesson-bookmark-toggle";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { getLessonReader } from "@/lib/data";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { isLessonBookmarked } from "@/lib/lesson-bookmarks";

export default async function LessonReaderPage({
  params,
  searchParams,
}: PageProps<"/academy/courses/[slug]/learn/[lessonId]">) {
  const [{ slug, lessonId }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const [data, locale] = await Promise.all([
    getLessonReader(slug, lessonId, user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  if (!data) notFound();
  const copy = getMainPageDictionary(locale).academy.lessonReader;
  const currentModule = data.modules.find((module) =>
    module.lessons.some((lesson) => lesson.id === lessonId),
  );
  const bookmarked = currentModule
    ? await isLessonBookmarked({
        organizationId: user.organizationId,
        userId: user.id,
        courseId: data.course.id,
        lessonId,
      })
    : false;
  const flatLessons = data.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: module.title,
      moduleKind: module.kind,
    })),
  );
  const currentIndex = flatLessons.findIndex(
    (lesson) => lesson.id === lessonId,
  );
  const previous = flatLessons
    .slice(0, currentIndex)
    .reverse()
    .find((lesson) => lesson.access.accessible);
  const next = flatLessons
    .slice(currentIndex + 1)
    .find((lesson) => lesson.access.accessible);
  type MobileNavigationItem =
    | {
        kind: "link";
        id: string;
        title: string;
        accessible: boolean;
        href: string | null;
      }
    | ((typeof flatLessons)[number] & {
        kind: "lesson";
        href: string | null;
      });
  const mobileNavigation: MobileNavigationItem[] = [];
  for (const learningModule of data.modules) {
    if (learningModule.kind === "link") {
      mobileNavigation.push({
        kind: "link",
        id: learningModule.id,
        title: learningModule.title,
        accessible: learningModule.access.accessible,
        href:
          learningModule.access.accessible && learningModule.targetCourseSlug
            ? `/academy/courses/${learningModule.targetCourseSlug}`
            : null,
      });
      continue;
    }
    mobileNavigation.push(
      ...learningModule.lessons.map((lesson) => ({
        kind: "lesson" as const,
        ...lesson,
        moduleTitle: learningModule.title,
        moduleKind: learningModule.kind,
        href: lesson.access.accessible
          ? `/academy/courses/${slug}/learn/${lesson.id}`
          : null,
      })),
    );
  }
  return (
    <ExamNavigationBoundary
      initialLock={data.exam?.navigationLock ?? null}
      locale={locale}
    >
    <LearningTimeTracker courseId={data.course.id} lessonId={data.lesson.id} />
    <div className="mx-auto max-w-[1550px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ExamGuardedLink
          href={`/academy/courses/${slug}`}
          className="focus-ring flex items-center gap-2 rounded-md text-xs font-semibold text-[#66727f] hover:text-[#17324d]"
        >
          <ArrowLeft className="size-4" />
          {copy.backToCourse}
        </ExamGuardedLink>
        <div className="flex items-center gap-2">
          {currentModule ? (
            <LessonBookmarkToggle
              courseId={data.course.id}
              moduleId={currentModule.id}
              lessonId={lessonId}
              initialBookmarked={bookmarked}
              locale={locale}
            />
          ) : null}
          <Badge tone="neutral">
            <Clock3 className="mr-1 size-3" />
            {copy.minutes(data.lesson.durationMinutes)}
          </Badge>
          {data.lesson.progressStatus === "completed" ? (
            <Badge tone="teal">
              <Check className="mr-1 size-3" />
              {copy.completed}
            </Badge>
          ) : !data.lesson.access.canInteract ? (
            <Badge tone="blue">
              <LockKeyhole className="mr-1 size-3" />
              {copy.readOnly}
            </Badge>
          ) : (
            <Badge tone={data.lesson.type === "exam" ? "coral" : "blue"}>
              {data.lesson.type === "exam" ? copy.exam : copy.inProgress}
            </Badge>
          )}
        </div>
      </div>
      <div className="panel grid min-h-[760px] overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#e5e8eb] bg-[#fafbfb] xl:block">
          <div className="border-b border-[#e8ebee] p-4">
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {data.course.title}
            </p>
            <p className="mt-1 text-sm font-bold text-[#243444]">
              {copy.courseContent}
            </p>
          </div>
          <div className="max-h-[700px] overflow-y-auto p-3">
            {data.modules.map((module, moduleIndex) => (
              <div
                key={module.id}
                className="mb-4"
                style={{
                  marginInlineStart: `${Math.min(module.indentLevel, 3) * 12}px`,
                }}
              >
                {module.kind === "link" ? (
                  module.access.accessible && module.targetCourseSlug ? (
                    <ExamGuardedLink
                      href={`/academy/courses/${module.targetCourseSlug}`}
                      className="focus-ring flex items-center gap-2 rounded-md bg-[#eef6fb] px-3 py-3 text-[11px] font-semibold text-[#365f8d] hover:bg-[#e5f1f8]"
                    >
                      <Link2 className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 break-words">
                        {module.title}
                      </span>
                      <ArrowUpRight className="size-3.5 shrink-0" />
                    </ExamGuardedLink>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md bg-[#f1f3f5] px-3 py-3 text-[11px] font-semibold text-[#8a949d]">
                      <LockKeyhole className="size-4 shrink-0" />
                      <span className="min-w-0 break-words">
                        {module.title}
                      </span>
                    </div>
                  )
                ) : (
                  <>
                    <p className="mb-1.5 px-2 text-[10px] font-bold uppercase text-[#7d8891]">
                      {module.kind === "exam"
                        ? copy.examModule
                        : `${moduleIndex + 1}.`}{" "}
                      {module.title}
                    </p>
                    {module.lessons.map((lesson) => {
                      const content = (
                        <>
                          <span
                            className={cn(
                              "grid size-6 shrink-0 place-items-center rounded",
                              lesson.id === lessonId
                                ? "bg-white/12"
                                : lesson.progressStatus === "completed"
                                  ? "bg-[#e9f8f6] text-[#167e74]"
                                  : "bg-white",
                            )}
                          >
                            {lesson.progressStatus === "completed" ? (
                              <Check className="size-3.5" />
                            ) : !lesson.access.accessible ? (
                              <LockKeyhole className="size-3.5" />
                            ) : lesson.type === "quiz" ||
                              lesson.type === "exam" ? (
                              <FileQuestion className="size-3.5" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                          </span>
                          <span className="line-clamp-2 text-[11px] font-medium leading-4">
                            {lesson.title}
                          </span>
                        </>
                      );
                      return lesson.access.accessible ? (
                        <ExamGuardedLink
                          href={`/academy/courses/${slug}/learn/${lesson.id}`}
                          key={lesson.id}
                          className={cn(
                            "focus-ring mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2.5",
                            lesson.id === lessonId
                              ? "bg-[#17324d] text-white"
                              : "text-[#596671] hover:bg-[#edf1f3]",
                          )}
                        >
                          {content}
                        </ExamGuardedLink>
                      ) : (
                        <div
                          key={lesson.id}
                          className="mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2.5 text-[#8a949d]"
                        >
                          {content}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
        <section className="min-w-0">
          <div className="flex items-center justify-between border-b border-[#e8ebee] px-4 py-3 xl:hidden">
            <span className="text-xs font-semibold text-[#354555]">
              {data.lesson.title}
            </span>
            <details className="relative">
              <summary
                className="focus-ring grid size-8 cursor-pointer list-none place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                aria-label={copy.courseNavigation}
              >
                <Menu className="size-4" />
              </summary>
              <nav className="absolute right-0 top-10 z-20 max-h-[70vh] w-[min(84vw,320px)] overflow-y-auto rounded-md border border-[#dfe4e8] bg-white p-2 shadow-xl">
                {mobileNavigation.map((item) => {
                  const icon =
                    item.kind === "link" ? (
                      item.accessible ? (
                        <Link2 className="size-3.5 shrink-0" />
                      ) : (
                        <LockKeyhole className="size-3.5 shrink-0" />
                      )
                    ) : item.progressStatus === "completed" ? (
                      <Check className="size-3.5 shrink-0" />
                    ) : !item.access.accessible ? (
                      <LockKeyhole className="size-3.5 shrink-0" />
                    ) : item.type === "quiz" || item.type === "exam" ? (
                      <FileQuestion className="size-3.5 shrink-0" />
                    ) : (
                      <Play className="size-3.5 shrink-0" />
                    );
                  const content = (
                    <>
                      {icon}
                      <span className="min-w-0 flex-1 truncate">
                        {item.title}
                      </span>
                    </>
                  );
                  return item.href ? (
                    <ExamGuardedLink
                      key={`${item.kind}-${item.id}`}
                      href={item.href}
                      className={cn(
                        "focus-ring flex items-center gap-2 rounded-md px-3 py-2.5 text-[11px] font-medium",
                        item.kind === "lesson" && item.id === lessonId
                          ? "bg-[#17324d] text-white"
                          : "text-[#596671] hover:bg-[#edf1f3]",
                      )}
                    >
                      {content}
                    </ExamGuardedLink>
                  ) : (
                    <div
                      key={`${item.kind}-${item.id}`}
                      className="flex items-center gap-2 rounded-md px-3 py-2.5 text-[11px] font-medium text-[#8a949d]"
                    >
                      {content}
                    </div>
                  );
                })}
              </nav>
            </details>
          </div>
          <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
            <p className="mb-5 text-xs text-[#7a8690]">
              {flatLessons[currentIndex]?.moduleKind === "exam"
                ? `${copy.examModule} | `
                : ""}
              {flatLessons[currentIndex]?.moduleTitle}
            </p>
            {data.lesson.type === "exam" && data.exam ? (
              <ExamLesson
                courseId={data.course.id}
                lessonId={data.lesson.id}
                lessonSummary={data.lesson.summary}
                completed={data.lesson.progressStatus === "completed"}
                canInteract={data.lesson.access.canInteract}
                locale={locale}
                summary={data.exam}
                submissions={data.submissions}
              />
            ) : (
              <LessonContent
                blocks={data.blocks}
                pages={data.pages}
                courseId={data.course.id}
                courseSlug={slug}
                lessonId={data.lesson.id}
                lessonType={data.lesson.type}
                initialPageId={
                  typeof query.page === "string" ? query.page : undefined
                }
                completed={data.lesson.progressStatus === "completed"}
                assessment={data.assessment}
                submissions={data.submissions}
                canInteract={data.lesson.access.canInteract}
                locale={locale}
              />
            )}
            {user.role === "member" ? (
              <LessonFeedback
                courseId={data.course.id}
                lessonId={data.lesson.id}
                locale={locale}
              />
            ) : null}
            <nav className="mt-10 grid grid-cols-2 gap-3 border-t border-[#e8ebee] pt-5">
              {previous ? (
                <ExamGuardedLink
                  href={`/academy/courses/${slug}/learn/${previous.id}`}
                  className="focus-ring flex min-h-14 items-center gap-2 rounded-md border border-[#dfe4e8] px-3 text-xs font-semibold text-[#52606d] hover:bg-[#f5f7f8]"
                >
                  <ChevronLeft className="size-4" />
                  <span>
                    <span className="block text-[9px] font-medium text-[#8a949d]">
                      {copy.previous}
                    </span>
                    {previous.title}
                  </span>
                </ExamGuardedLink>
              ) : (
                <span />
              )}
              {next ? (
                <ExamGuardedLink
                  href={`/academy/courses/${slug}/learn/${next.id}`}
                  className="focus-ring flex min-h-14 items-center justify-end gap-2 rounded-md border border-[#dfe4e8] px-3 text-right text-xs font-semibold text-[#52606d] hover:bg-[#f5f7f8]"
                >
                  <span>
                    <span className="block text-[9px] font-medium text-[#8a949d]">
                      {copy.next}
                    </span>
                    {next.title}
                  </span>
                  <ArrowRight className="size-4" />
                </ExamGuardedLink>
              ) : (
                <ExamGuardedLink
                  href={`/academy/courses/${slug}`}
                  className="focus-ring flex min-h-14 items-center justify-end gap-2 rounded-md border border-[#b9e8e3] bg-[#edf9f7] px-3 text-right text-xs font-semibold text-[#176f68]"
                >
                  <span>{copy.courseOverview}</span>
                  <Check className="size-4" />
                </ExamGuardedLink>
              )}
            </nav>
          </div>
        </section>
      </div>
    </div>
    </ExamNavigationBoundary>
  );
}
