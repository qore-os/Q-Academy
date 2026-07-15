import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Award,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileQuestion,
  LockKeyhole,
  Link2,
  Play,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CourseFeedback } from "@/components/academy/course-feedback";
import { LessonAvailabilitySubscription } from "@/components/academy/lesson-availability-subscription";
import { CourseModuleAccessRequest } from "@/components/academy/course-module-access-request";
import { CourseOverviewWidgets } from "@/components/academy/course-overview-widgets";
import { CourseInformationDetails } from "@/components/academy/course-information-details";
import { buttonClassName } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireUser } from "@/lib/auth";
import { courseCoverImageProps } from "@/lib/course-cover";
import { getMemberCourse } from "@/lib/data";
import { listCourseModuleAccessRequests } from "@/lib/course-module-access-service";
import { listLessonAvailabilitySubscriptions } from "@/lib/lesson-availability-service";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDuration } from "@/lib/utils";

type CourseDetailCopy = ReturnType<
  typeof getMainPageDictionary
>["academy"]["courseDetail"];

function availabilityLabel(
  access: {
    availableAt: string | null;
    state: string;
    reasons: string[];
  },
  locale: AppLocale,
  copy: CourseDetailCopy,
) {
  if (access.availableAt) {
    return copy.availableAt(
      new Intl.DateTimeFormat(intlLocale(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(access.availableAt)),
    );
  }
  if (access.state === "coming_soon") return copy.comingSoon;
  if (access.reasons.includes("previous_module")) {
    return copy.previousModule;
  }
  if (access.reasons.includes("previous_lesson")) {
    return copy.previousLesson;
  }
  if (access.reasons.includes("manually_locked")) return copy.accessLocked;
  return copy.notReleased;
}

export default async function MemberCoursePage({
  params,
}: PageProps<"/academy/courses/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const [data, locale] = await Promise.all([
    getMemberCourse(slug, user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  if (!data) notFound();
  const copy = getMainPageDictionary(locale).academy.courseDetail;
  const [pendingAccessRequests, availabilitySubscriptions] =
    user.role === "member"
      ? await Promise.all([
          listCourseModuleAccessRequests({
            organizationId: user.organizationId,
            userId: user.id,
            courseId: data.course.id,
            status: "pending",
          }),
          listLessonAvailabilitySubscriptions({
            organizationId: user.organizationId,
            userId: user.id,
            courseId: data.course.id,
            status: "active",
          }),
        ])
      : [[], []];
  const pendingAccessRequestByModule = new Map(
    pendingAccessRequests.map((request) => [request.moduleId, request]),
  );
  const subscribedLessonIds = new Set(
    availabilitySubscriptions.map((subscription) => subscription.lessonId),
  );
  const allLessons = data.modules.flatMap((module) => module.lessons);
  const requiredLessons = allLessons.filter((lesson) => lesson.required);
  const nextLesson =
    allLessons.find(
      (lesson) =>
        lesson.access.accessible && lesson.progressStatus !== "completed",
    ) ?? allLessons.find((lesson) => lesson.access.accessible);
  const completedLessons = requiredLessons.filter(
    (lesson) => lesson.progressStatus === "completed",
  ).length;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <section className="overflow-hidden rounded-md bg-[#17324d] text-white">
        <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="flex flex-col justify-center p-6 md:p-9">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="teal">
                {data.course.categoryName ?? copy.learningPath}
              </Badge>
              <span className="text-[10px] font-semibold text-white/60">
                {data.course.difficulty}
              </span>
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-tight md:text-4xl">
              {data.course.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/72">
              {data.course.description}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-5 text-xs text-white/70">
              <span className="flex items-center gap-2">
                <Clock3 className="size-4 text-[#63d5ca]" />
                {formatDuration(data.course.estimatedMinutes, locale)}
              </span>
              <span className="flex items-center gap-2">
                <BookOpen className="size-4 text-[#63d5ca]" />
                {copy.modules(data.modules.length)}
              </span>
              {data.course.certificateEnabled ? (
                <span className="flex items-center gap-2">
                  <Award className="size-4 text-[#e7c968]" />
                  {copy.certificate}
                </span>
              ) : null}
            </div>
            {nextLesson ? (
              <Link
                href={`/academy/courses/${data.course.slug}/learn/${nextLesson.id}`}
                className={buttonClassName({
                  variant: "primary",
                  size: "lg",
                  className: "mt-7 w-fit",
                })}
              >
                <Play className="size-4 fill-current" />
                {data.course.progress ? copy.continueCourse : copy.startCourse}
              </Link>
            ) : null}
          </div>
          <div className="relative min-h-72 lg:min-h-[430px]">
            <Image
              {...courseCoverImageProps(data.course.coverImage)}
              alt=""
              fill
              loading="eager"
              sizes="(max-width:1024px) 100vw, 40vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[#17324d]/15" />
          </div>
        </div>
      </section>
      <CourseInformationDetails
        learningGoals={data.publishedContent.snapshot.learningGoals ?? []}
        authors={data.publishedContent.snapshot.authors ?? []}
        locale={locale}
      />
      <CourseOverviewWidgets widgets={data.widgets} locale={locale} />
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase text-[#2b9188]">
                {copy.courseContent}
              </p>
              <h2 className="mt-1 text-xl font-bold text-[#243444]">
                {copy.modulesAndLessons}
              </h2>
            </div>
            <span className="text-xs text-[#71808b]">
              {copy.requiredLessons(completedLessons, requiredLessons.length)}
            </span>
          </div>
          <div className="space-y-3">
            {data.modules.map((module, moduleIndex) => {
              const moduleCompleted = module.lessons.filter(
                (lesson) => lesson.progressStatus === "completed",
              ).length;
              if (module.kind === "link") {
                const linkContent = (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#eef6fb] text-[#365f8d]">
                      {module.access.accessible ? (
                        <Link2 className="size-5" />
                      ) : (
                        <LockKeyhole className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-bold text-[#2b3a48]">
                        {module.title}
                      </span>
                      <span className="mt-1 block text-[10px] text-[#7a8690]">
                        {module.access.accessible
                          ? copy.linkedCourse
                          : availabilityLabel(module.access, locale, copy)}
                      </span>
                    </span>
                    {module.access.accessible ? (
                      <>
                        <Badge tone="blue">{copy.openCourse}</Badge>
                        <ArrowUpRight className="size-4 text-[#365f8d]" />
                      </>
                    ) : (
                      <Badge tone="neutral">{copy.locked}</Badge>
                    )}
                  </>
                );
                const className =
                  "panel focus-ring flex min-h-20 items-center gap-4 p-4 md:p-5";
                const style = {
                  marginInlineStart: `${Math.min(module.indentLevel, 3) * 16}px`,
                };
                return module.access.accessible && module.targetCourseSlug ? (
                  <Link
                    key={module.id}
                    href={`/academy/courses/${module.targetCourseSlug}`}
                    className={`${className} hover:bg-[#f7fafc]`}
                    style={style}
                  >
                    {linkContent}
                  </Link>
                ) : (
                  <div key={module.id} className={className} style={style}>
                    {linkContent}
                  </div>
                );
              }
              return (
                <details
                  key={module.id}
                  open={moduleIndex === 0}
                  className="panel group overflow-hidden"
                  style={{
                    marginInlineStart: `${Math.min(module.indentLevel, 3) * 16}px`,
                  }}
                >
                  <summary className="focus-ring flex cursor-pointer list-none items-center gap-4 p-4 md:p-5">
                    <span className={module.kind === "exam" ? "grid size-10 shrink-0 place-items-center rounded-md bg-[#fdf0ee] text-[#b84e42]" : "grid size-10 shrink-0 place-items-center rounded-md bg-[#edf3f7] text-sm font-bold text-[#365f8d]"}>
                      {module.kind === "exam" ? <FileQuestion className="size-5" /> : moduleIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-[#2b3a48]">
                        {module.title}
                      </span>
                      <span className="mt-1 block text-[10px] text-[#7a8690]">
                        {module.kind === "exam"
                          ? `${copy.examModule} | ${copy.examCount}`
                          : copy.lessons(module.lessons.length)}{" "}
                        | {formatDuration(module.estimatedMinutes, locale)}
                      </span>
                    </span>
                    <Badge
                      tone={
                        module.access.state === "read_only"
                          ? "blue"
                          : module.access.state !== "available"
                            ? "neutral"
                            : moduleCompleted === module.lessons.length
                              ? "teal"
                              : "neutral"
                      }
                    >
                      {module.access.state === "read_only"
                        ? copy.readOnly
                        : module.access.state === "coming_soon"
                          ? copy.comingSoon
                          : module.access.state === "locked"
                            ? copy.locked
                            : `${moduleCompleted}/${module.lessons.length}`}
                    </Badge>
                    <ChevronDown className="size-4 text-[#71808b] transition-transform group-open:rotate-180" />
                  </summary>
                  {user.role === "member" &&
                  module.access.state === "locked" &&
                  (module.access.requestable ||
                    module.access.requestStatus === "pending") ? (
                    <div className="border-t border-[#edf0f2] p-3 md:px-5">
                      <CourseModuleAccessRequest
                        courseId={data.course.id}
                        moduleId={module.id}
                        moduleTitle={module.title}
                        access={module.access}
                        pendingRequest={
                          pendingAccessRequestByModule.get(module.id) ?? null
                        }
                        locale={locale}
                      />
                    </div>
                  ) : null}
                  <div className="border-t border-[#edf0f2] px-3 py-2 md:px-5">
                    {module.lessons.map((lesson, lessonIndex) => {
                      const lessonKind = !lesson.access.canInteract
                        ? copy.readOnly
                        : lesson.type === "assignment"
                          ? copy.submission
                          : lesson.type === "exam"
                            ? copy.exam
                          : lesson.type === "quiz"
                              ? copy.knowledgeCheck
                              : copy.lesson;
                      const content = (
                        <>
                          <span
                            className={`grid size-7 shrink-0 place-items-center rounded-full ${lesson.progressStatus === "completed" ? "bg-[#e9f8f6] text-[#167e74]" : lessonIndex === 0 || moduleIndex === 0 ? "bg-[#eef3f9] text-[#365f8d]" : "bg-[#f1f3f5] text-[#8a949d]"}`}
                          >
                            {lesson.progressStatus === "completed" ? (
                              <Check className="size-4" />
                            ) : !lesson.access.accessible ? (
                              <LockKeyhole className="size-3.5" />
                            ) : lesson.type === "quiz" ||
                              lesson.type === "exam" ? (
                              <FileQuestion className="size-3.5" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-[#455463]">
                              {lesson.title}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-[#8a949d]">
                              {lesson.access.accessible
                                ? `${copy.minutes(lesson.durationMinutes)} | ${lessonKind}`
                                : availabilityLabel(lesson.access, locale, copy)}
                            </span>
                          </span>
                          {lesson.progressStatus === "completed" ? (
                            <CheckCircle2 className="size-4 text-[#2bb7a9]" />
                          ) : !lesson.access.accessible ? (
                            <LockKeyhole className="size-4 text-[#8a949d]" />
                          ) : null}
                        </>
                      );
                      return lesson.access.accessible ? (
                        <Link
                          href={`/academy/courses/${data.course.slug}/learn/${lesson.id}`}
                          key={lesson.id}
                          className="focus-ring flex items-center gap-3 rounded-md px-3 py-3 hover:bg-[#f5f7f8]"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={lesson.id} data-locked-lesson={lesson.id}>
                          <div className="flex items-center gap-3 rounded-md px-3 py-3 opacity-80">
                            {content}
                          </div>
                          {user.role === "member" &&
                          lesson.access.state === "coming_soon" ? (
                            <LessonAvailabilitySubscription
                              courseId={data.course.id}
                              courseSlug={data.course.slug}
                              lessonId={lesson.id}
                              initialSubscribed={subscribedLessonIds.has(
                                lesson.id,
                              )}
                              locale={locale}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
        <aside className="space-y-4">
          {data.course.showProgressPercentage !== false ? (
            <div className="panel p-5">
              <p className="text-[10px] font-bold uppercase text-[#4f7cac]">
                {copy.yourProgress}
              </p>
              <p className="mt-2 text-3xl font-bold text-[#243444]">
                {data.course.progress}%
              </p>
              <Progress value={data.course.progress} className="mt-3" />
              <p className="mt-3 text-xs leading-5 text-[#71808b]">
                {requiredLessons.length > 0 &&
                completedLessons === requiredLessons.length
                  ? copy.allRequiredComplete
                  : copy.requiredRemaining(
                      Math.max(requiredLessons.length - completedLessons, 0),
                    )}
              </p>
            </div>
          ) : null}
          {data.course.certificateEnabled && data.course.progress === 100 ? (
            <div className="panel border-[#eadcae] bg-[#fffdf6] p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-[#243444]">
                <Award className="size-5 text-[#a57b13]" />
                {copy.courseCertificate}
              </div>
              <p className="mt-2 text-xs leading-5 text-[#71808b]">
                {data.certificate
                  ? copy.certificateIssued
                  : copy.certificatePending}
              </p>
              {data.certificate ? (
                <Link
                  href={`/academy/certificates/${data.certificate.id}`}
                  className={buttonClassName({ variant: "navy", size: "sm", className: "mt-4" })}
                >
                  <Award className="size-3.5" />
                  {copy.viewCertificate}
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="panel p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#243444]">
              <Sparkles className="size-5 text-[#d6a536]" />
              {copy.coachTitle}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#71808b]">
              {copy.coachDescription}
            </p>
          </div>
          <div className="panel p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#243444]">
              <LockKeyhole className="size-5 text-[#2b9188]" />
              {copy.safeLearning}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#71808b]">
              {copy.safeLearningDescription}
            </p>
          </div>
          <CourseFeedback courseId={data.course.id} locale={locale} />
        </aside>
      </section>
    </div>
  );
}
