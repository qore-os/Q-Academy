import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckSquare,
  Circle,
  ClipboardList,
  Clock3,
  FileQuestion,
  Info,
  MessageSquareText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VideoTranscriptPlayer } from "@/components/academy/video-transcript-player";
import { EmbeddedAiAgent } from "@/components/academy/embedded-ai-agent";
import { RichTextContent } from "@/components/content/rich-text-content";
import {
  GalleryContent,
  LinkButtonContent,
  StructuredBlockContent,
} from "@/components/content/interactive-block-content";
import { requireCoursePermission } from "@/lib/course-permissions";
import { getCourseBuilderData } from "@/lib/data";
import { resolveUserLocale } from "@/lib/i18n/server";
import type { AppLocale } from "@/lib/i18n/model";
import { intlLocale } from "@/lib/i18n/model";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { cn, formatDuration } from "@/lib/utils";

export async function generateMetadata(
  props: PageProps<"/admin/courses/[id]/preview">,
): Promise<Metadata> {
  const { id } = await props.params;
  const { user } = await requireCoursePermission(id, "view");
  const locale = await resolveUserLocale(user);
  return { title: getCourseSupportCopy(locale).preview.eyebrow };
}

type PreviewBlock =
  Awaited<ReturnType<typeof getCourseBuilderData>> extends infer Result
    ? NonNullable<Result> extends { modules: Array<infer CourseModule> }
      ? CourseModule extends { lessons: Array<infer CourseLesson> }
        ? CourseLesson extends { blocks: Array<infer Block> }
          ? Block
          : never
        : never
      : never
    : never;

function PreviewBlock({
  locale,
  block,
  dataForms,
}: {
  locale: AppLocale;
  block: PreviewBlock;
  dataForms: Array<{ id: string; name: string }>;
}) {
  const copy = getCourseSupportCopy(locale);
  const data = block.data;
  if (block.type === "ai_agent" && typeof data.agentId === "string") {
    return (
      <EmbeddedAiAgent locale={locale} agentId={data.agentId} canInteract />
    );
  }
  if (block.type === "eyebrow") {
    return (
      <p className="text-[10px] font-bold uppercase text-[#2b9188]">
        {data.text || copy.preview.fallbacks.eyebrow}
      </p>
    );
  }
  if (block.type === "heading") {
    return (
      <h2 className="text-2xl font-bold leading-tight text-[#17212b] md:text-3xl">
        {data.text || copy.preview.fallbacks.heading}
      </h2>
    );
  }
  if (block.type === "text") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-7 text-[#52606d]">
        {data.text || copy.preview.fallbacks.text}
      </p>
    );
  }
  if (block.type === "rich_text") {
    return <RichTextContent document={data.richText} />;
  }
  if (block.type === "button") {
    return <LinkButtonContent document={data.button} />;
  }
  if (block.type === "gallery") {
    return <GalleryContent document={data.gallery} locale={locale} />;
  }
  if (
    block.type === "callout" ||
    block.type === "quote" ||
    block.type === "divider" ||
    block.type === "accordion" ||
    block.type === "tabs" ||
    block.type === "columns" ||
    block.type === "download" ||
    block.type === "code" ||
    block.type === "table"
  ) {
    return (
      <StructuredBlockContent
        type={block.type}
        document={data[block.type]}
        locale={locale}
      />
    );
  }
  if (block.type === "data_form") {
    const form = dataForms.find((candidate) => candidate.id === data.formId);
    return (
      <div className="flex items-center gap-3 rounded-md border border-[#cbd7e2] bg-[#f7f9fb] p-4">
        <ClipboardList className="size-5 text-[#365f8d]" />
        <div>
          <p className="text-sm font-bold text-[#294f79]">
            {block.title ?? copy.preview.fallbacks.form}
          </p>
          <p className="mt-0.5 text-xs text-[#71808b]">
            {form?.name ?? copy.preview.fallbacks.formUnavailable}
          </p>
        </div>
      </div>
    );
  }
  if (block.type === "video" && data.videoUrl) {
    return (
      <VideoTranscriptPlayer
        src={data.videoUrl}
        title={block.title}
        caption={data.caption}
        transcript={data.transcript}
        endCard={data.videoEndCard}
        playbackPolicy={data.videoPlayback}
        mediaAssetId={data.mediaAssetId}
        locale={locale}
      />
    );
  }
  if (block.type === "info") {
    return (
      <div className="flex items-start gap-3 rounded-md border-l-4 border-[#d6a536] bg-[#fbf6e7] p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-[#8d6a12]" />
        <div>
          <p className="text-xs font-bold text-[#6f5617]">
            {block.title || copy.preview.fallbacks.info}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#6d603c]">
            {data.text}
          </p>
        </div>
      </div>
    );
  }
  if (block.type === "checklist") {
    return (
      <div>
        <p className="mb-3 text-sm font-bold text-[#243444]">
          {block.title || copy.preview.fallbacks.checklist}
        </p>
        <div className="space-y-2">
          {(data.items ?? []).map((item, index) => (
            <div
              key={`${index}-${item}`}
              className="flex items-center gap-3 rounded-md border border-[#e3e7ea] p-3 text-sm text-[#52606d]"
            >
              <CheckSquare className="size-4 shrink-0 text-[#9aa4ac]" />
              {item}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "multiple_choice" || block.type === "true_false") {
    return (
      <div className="rounded-md border border-[#dfe4e8] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-[#243444]">
            {data.prompt || block.title}
          </p>
          {block.required ? (
            <Badge tone="amber">{copy.common.required}</Badge>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {(data.options ?? []).map((option, index) => (
            <div
              key={`${index}-${option}`}
              className="flex items-center gap-3 rounded-md bg-[#f5f7f8] px-3 py-2.5 text-sm text-[#52606d]"
            >
              <Circle className="size-4 shrink-0 text-[#9aa4ac]" />
              {option}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "submission") {
    return (
      <div className="rounded-md border border-dashed border-[#ee9f96] bg-[#fdf5f3] p-5 text-center">
        <MessageSquareText className="mx-auto size-5 text-[#c95b4f]" />
        <p className="mt-2 text-sm font-bold text-[#6f332e]">
          {block.title || copy.preview.fallbacks.submission}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#8b5b55]">{data.prompt}</p>
      </div>
    );
  }
  return (
    <p className="text-xs text-[#7d8891]">
      {copy.preview.fallbacks.contentElement(block.type)}
    </p>
  );
}

export default async function AdminCoursePreviewPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  const { user, permission } = await requireCoursePermission(id, "view");
  const [data, locale] = await Promise.all([
    getCourseBuilderData(id, user.organizationId, user),
    resolveUserLocale(user),
  ]);
  if (!data) notFound();
  const copy = getCourseSupportCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));

  const lessons = data.modules.flatMap((courseModule) =>
    courseModule.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: courseModule.title,
    })),
  );
  const requestedLessonId =
    typeof query.lesson === "string" ? query.lesson : null;
  const lesson =
    lessons.find((item) => item.id === requestedLessonId) ?? lessons[0];
  const requestedPageId = typeof query.page === "string" ? query.page : null;
  const selectedPage =
    lesson?.pages.find((page) => page.id === requestedPageId) ?? null;
  const blocks = selectedPage?.blocks ?? lesson?.blocks ?? [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={
              permission === "view"
                ? "/admin/courses"
                : `/admin/courses/${data.course.id}`
            }
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md border border-[#dfe4e8] bg-white text-[#66727f] hover:bg-[#f1f3f5]"
            aria-label={
              permission === "view"
                ? copy.preview.backToList
                : copy.preview.backToEditor
            }
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase text-[#2b9188]">
              {copy.preview.eyebrow}
            </p>
            <h1 className="truncate text-lg font-bold text-[#1d2b38]">
              {data.course.title}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#66727f]">
          <Badge tone={data.course.status === "published" ? "teal" : "amber"}>
            {data.course.status === "published"
              ? copy.common.live
              : copy.common.draft}
          </Badge>
          <span className="flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {formatDuration(data.course.estimatedMinutes, locale)}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="size-3.5" />
            {copy.preview.lessonCount(numberFormatter.format(lessons.length))}
          </span>
        </div>
      </header>

      <div className="panel grid min-h-[760px] overflow-hidden lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="border-b border-[#e5e8eb] bg-[#fafbfb] lg:border-b-0 lg:border-r">
          <div className="border-b border-[#e8ebee] p-4">
            <p className="text-xs font-bold text-[#243444]">
              {copy.preview.content}
            </p>
            <p className="mt-1 text-[10px] text-[#7d8891]">
              {copy.preview.noProgress}
            </p>
          </div>
          <nav
            className="max-h-[700px] overflow-y-auto p-3"
            aria-label={copy.preview.structure}
          >
            {data.modules.map((courseModule, moduleIndex) => (
              <div key={courseModule.id} className="mb-4">
                <p className="mb-1.5 px-2 text-[9px] font-bold uppercase text-[#7d8891]">
                  {moduleIndex + 1}. {courseModule.title}
                </p>
                {courseModule.lessons.map((item) => (
                  <Link
                    key={item.id}
                    href={`/admin/courses/${data.course.id}/preview?lesson=${item.id}`}
                    className={cn(
                      "focus-ring mb-0.5 flex items-center gap-2 rounded-md px-2.5 py-2.5 text-[11px] font-medium",
                      lesson?.id === item.id
                        ? "bg-[#17324d] text-white"
                        : "text-[#596671] hover:bg-[#edf1f3]",
                    )}
                  >
                    {item.type === "quiz" || item.type === "exam" ? (
                      <FileQuestion className="size-3.5 shrink-0" />
                    ) : (
                      <BookOpen className="size-3.5 shrink-0" />
                    )}
                    <span className="line-clamp-2">{item.title}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 bg-white">
          {lesson ? (
            <div className="mx-auto max-w-3xl px-5 py-7 sm:px-8 md:py-10">
              <p className="text-[10px] font-bold uppercase text-[#2b9188]">
                {lesson.moduleTitle}
              </p>
              <h2 className="mt-1 text-2xl font-bold text-[#1d2b38]">
                {lesson.title}
              </h2>
              {lesson.pages.length ? (
                <nav
                  className="mt-5 flex items-center gap-1 overflow-x-auto border-y border-[#e8ebee] py-2"
                  aria-label={copy.preview.lessonPages}
                >
                  <Link
                    href={`/admin/courses/${data.course.id}/preview?lesson=${lesson.id}`}
                    className={cn(
                      "focus-ring h-8 shrink-0 rounded px-3 text-[10px] font-semibold leading-8",
                      !selectedPage
                        ? "bg-[#17324d] text-white"
                        : "text-[#66727f] hover:bg-[#edf1f3]",
                    )}
                  >
                    {copy.preview.mainContent}
                  </Link>
                  {lesson.pages.map((page, index) => (
                    <Link
                      key={page.id}
                      href={`/admin/courses/${data.course.id}/preview?lesson=${lesson.id}&page=${page.id}`}
                      className={cn(
                        "focus-ring h-8 shrink-0 rounded px-3 text-[10px] font-semibold leading-8",
                        selectedPage?.id === page.id
                          ? "bg-[#17324d] text-white"
                          : "text-[#66727f] hover:bg-[#edf1f3]",
                      )}
                    >
                      {index + 1}. {page.title}
                    </Link>
                  ))}
                </nav>
              ) : null}
              <div className="mt-7 space-y-7">
                {blocks.map((block) => (
                  <PreviewBlock
                    key={block.id}
                    locale={locale}
                    block={block}
                    dataForms={data.dataForms}
                  />
                ))}
                {!blocks.length ? (
                  <div className="grid min-h-72 place-items-center border-y border-[#edf0f2] text-center">
                    <div>
                      <BookOpen className="mx-auto size-7 text-[#a2abb3]" />
                      <p className="mt-2 text-sm font-semibold text-[#52606d]">
                        {copy.preview.emptyArea}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="grid min-h-[640px] place-items-center text-center">
              <div>
                <BookOpen className="mx-auto size-8 text-[#a2abb3]" />
                <h2 className="mt-3 text-base font-bold text-[#243444]">
                  {copy.preview.noLessonsTitle}
                </h2>
                <p className="mt-1 text-xs text-[#7d8891]">
                  {copy.preview.noLessonsDescription}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
