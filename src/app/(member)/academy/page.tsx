import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  Heart,
  MessageCircle,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { requireUser } from "@/lib/auth";
import { courseCoverImageProps } from "@/lib/course-cover";
import { getMemberDashboard } from "@/lib/data";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDateTime, formatDuration } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return { title: getCoreDictionary(locale).navigation.items.dashboard };
}

export default async function AcademyDashboardPage() {
  const user = await requireUser();
  const [data, locale] = await Promise.all([
    getMemberDashboard(user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getMainPageDictionary(locale).academy.dashboard;
  const activeCourse =
    data.courses.find((course) => course.status === "in_progress") ??
    data.courses[0];
  const completed = data.courses.filter(
    (course) => course.status === "completed",
  ).length;
  const active = data.courses.filter(
    (course) => course.status === "in_progress",
  ).length;
  return (
    <div className="mx-auto max-w-[1420px] space-y-6">
      <section className="grid overflow-hidden rounded-md bg-[#17324d] text-white lg:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
        <div className="relative min-h-56 overflow-hidden p-6 md:p-8">
          <div className="absolute inset-y-0 right-0 hidden w-1/2 opacity-20 md:block">
            <Image
              src="/images/courses/foundations.webp"
              alt=""
              fill
              loading="eager"
              sizes="40vw"
              className="object-cover"
            />
          </div>
          <div className="relative max-w-2xl">
            <p className="text-[10px] font-bold uppercase text-[#63d5ca]">
              {copy.eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-bold leading-tight">
              {copy.welcome(user.firstName)}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/72">
              {active
                ? copy.activeSummary(active)
                : data.courses.length
                  ? copy.readySummary
                  : copy.emptySummary}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/academy/courses"
                className={buttonClassName({ variant: "primary" })}
              >
                <BookOpen className="size-4" />
                {copy.myCourses}
              </Link>
              <Link
                href="/academy/hub"
                className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-white/25 px-4 text-sm font-semibold text-white hover:bg-white/10"
              >
                <Compass className="size-4" />
                {copy.aiTools}
              </Link>
            </div>
          </div>
        </div>
        {activeCourse ? (
          <div className="relative min-h-56 border-t border-white/10 bg-[#0f263c] p-5 lg:border-l lg:border-t-0">
            <div className="relative aspect-[16/7] overflow-hidden rounded-md">
              <Image
                {...courseCoverImageProps(activeCourse.coverImage)}
                alt=""
                fill
                loading="eager"
                sizes="400px"
                className="object-cover"
              />
            </div>
            <div className="mt-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-bold uppercase text-[#63d5ca]">
                  {copy.lastLearned}
                </p>
                <h2 className="mt-1 text-base font-bold">
                  {activeCourse.title}
                </h2>
              </div>
              <Badge tone="teal">
                {activeCourse.showProgressPercentage
                  ? `${activeCourse.progress}%`
                  : activeCourse.status === "completed"
                    ? copy.completed
                    : copy.inProgress}
              </Badge>
            </div>
            {activeCourse.showProgressPercentage ? (
              <Progress
                value={activeCourse.progress}
                className="mt-3"
                color="#63d5ca"
              />
            ) : null}
            <Link
              href={`/academy/courses/${activeCourse.slug}`}
              className="focus-ring mt-4 flex h-9 items-center justify-center gap-2 rounded-md bg-white text-xs font-bold text-[#17324d] hover:bg-[#eef2f4]"
            >
              {copy.continueLearning}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : (
          <div className="relative min-h-56 border-t border-white/10 bg-[#0f263c] p-5 lg:border-l lg:border-t-0">
            <EmptyState
              icon={BookOpen}
              title={copy.noCourse}
              description={copy.noCourseDescription}
              tone="inverse"
              className="h-full min-h-[13rem] py-5"
            />
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
            <BookOpen className="size-5" />
          </span>
          <div>
            <p className="text-xl font-bold text-[#243444]">{active}</p>
            <p className="mt-0.5 text-[11px] text-[#71808b]">{copy.activeCourses}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-md bg-[#fbf6e7] text-[#8d6a12]">
            <Trophy className="size-5" />
          </span>
          <div>
            <p className="text-xl font-bold text-[#243444]">{user.points}</p>
            <p className="mt-0.5 text-[11px] text-[#71808b]">
              {copy.communityPoints}
            </p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <p className="text-xl font-bold text-[#243444]">{completed}</p>
            <p className="mt-0.5 text-[11px] text-[#71808b]">
              {copy.completedCourses}
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.pathEyebrow}
            </p>
            <h2 className="mt-1 text-xl font-bold text-[#243444]">
              {copy.currentCourses}
            </h2>
          </div>
          <Link
            href="/academy/courses"
            className="text-xs font-semibold text-[#2b9188] hover:text-[#176f68]"
          >
            {copy.allCourses}
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.courses.slice(0, 3).map((course) => (
            <Link
              href={`/academy/courses/${course.slug}`}
              key={course.id}
              className="focus-ring panel group overflow-hidden"
            >
              <div className="relative aspect-[16/8.2] overflow-hidden">
                <Image
                  {...courseCoverImageProps(course.coverImage)}
                  alt=""
                  fill
                  loading="eager"
                  sizes="(max-width:768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <span className="absolute bottom-3 left-3">
                  <Badge tone={course.status === "completed" ? "teal" : "navy"}>
                    {course.status === "completed"
                      ? copy.completed
                      : course.showProgressPercentage
                        ? copy.progress(course.progress)
                        : course.status === "not_started"
                          ? copy.new
                          : copy.inProgress}
                  </Badge>
                </span>
              </div>
              <div className="p-4">
                <h3 className="text-sm font-bold text-[#2b3a48]">
                  {course.title}
                </h3>
                <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-[#6c7882]">
                  {course.shortDescription}
                </p>
                <div className="mt-3 flex items-center justify-between text-[10px] text-[#7a8690]">
                  <span className="flex items-center gap-1">
                    <Clock3 className="size-3" />
                    {formatDuration(course.estimatedMinutes, locale)}
                  </span>
                  <span className="font-semibold text-[#2b9188]">
                    {course.status === "not_started" ? copy.start : copy.continue}
                  </span>
                </div>
                {course.showProgressPercentage ? (
                  <Progress value={course.progress} className="mt-3" />
                ) : null}
              </div>
            </Link>
          ))}
          {!data.courses.length ? (
            <EmptyState
              icon={BookOpen}
              title={copy.emptyCourses}
              description={copy.emptyCoursesDescription}
              className="panel md:col-span-2 xl:col-span-3"
            />
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
        <article className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-[#4f7cac]">
                {copy.communityEyebrow}
              </p>
              <h2 className="mt-1 text-base font-bold text-[#243444]">
                {copy.communityTitle}
              </h2>
            </div>
            <Link
              href="/academy/community"
              className="text-xs font-semibold text-[#2b9188]"
            >
              {copy.feed}
            </Link>
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {data.recentPosts.map((post) => (
              <Link
                href="/academy/community"
                key={post.id}
                className="focus-ring block px-5 py-4 hover:bg-[#fafbfb]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-[#354555]">
                    {post.firstName} {post.lastName} ·{" "}
                    <span className="font-medium text-[#71808b]">
                      {post.spaceTitle}
                    </span>
                  </p>
                  <span className="text-[10px] text-[#8a949d]">
                    {formatDateTime(post.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#52606d]">
                  {post.content}
                </p>
                <div className="mt-2 flex gap-3 text-[10px] text-[#7a8690]">
                  <span className="flex items-center gap-1">
                    <Heart className="size-3" />
                    {post.likes}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageCircle className="size-3" />
                    {post.comments}
                  </span>
                </div>
              </Link>
            ))}
            {!data.recentPosts.length ? (
              <EmptyState
                icon={MessageCircle}
                title={copy.noPosts}
                description={copy.noPostsDescription}
                action={
                  <Link
                    href="/academy/community"
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                  >
                    {copy.community}
                    <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
            ) : null}
          </div>
        </article>
        <aside className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-[#ee6c5d]">
                {copy.events}
              </p>
              <h2 className="mt-1 text-base font-bold text-[#243444]">
                {copy.upcoming}
              </h2>
            </div>
            <CalendarDays className="size-5 text-[#ee6c5d]" />
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {data.upcomingEvents.map((event) => (
              <Link
                href="/academy/events"
                key={event.id}
                className="focus-ring flex gap-3 px-5 py-4 hover:bg-[#fafbfb]"
              >
                <span
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: event.color }}
                />
                <div>
                  <p className="text-xs font-semibold text-[#354555]">
                    {event.title}
                  </p>
                  <p className="mt-1 text-[10px] text-[#7a8690]">
                    {formatDateTime(event.startsAt, locale, event.timezone)} · {event.location}
                  </p>
                </div>
              </Link>
            ))}
            {!data.upcomingEvents.length ? (
              <EmptyState
                icon={CalendarDays}
                title={copy.noEvents}
                description={copy.noEventsDescription}
                action={
                  <Link
                    href="/academy/events"
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                  >
                    {copy.eventPlan}
                    <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
            ) : null}
          </div>
        </aside>
      </section>
    </div>
  );
}
