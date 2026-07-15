"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Award,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { courseCoverImageProps } from "@/lib/course-cover";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { cn, formatDuration, PLATFORM_TIME_ZONE } from "@/lib/utils";

type MemberCourse = {
  id: string;
  title: string;
  slug: string;
  shortDescription: string;
  coverImage: string | null;
  estimatedMinutes: number;
  difficulty: string;
  progress: number;
  showProgressPercentage: boolean;
  status: "not_started" | "in_progress" | "completed";
  categoryName: string | null;
  categoryColor: string | null;
  access: {
    state: "available" | "upcoming" | "expired" | "unavailable" | "hidden";
    accessible: boolean;
    availableAt: string | null;
    expiresAt: string | null;
  };
};

type CourseFilter = "all" | "active" | "completed" | "locked";

const filters: CourseFilter[] = ["all", "active", "completed", "locked"];

function accessMessage(course: MemberCourse, locale: AppLocale) {
  const copy = getMemberExperienceCopy(locale).courses;
  const dateFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PLATFORM_TIME_ZONE,
  });
  if (course.access.state === "upcoming" && course.access.availableAt) {
    return copy.availableAt(dateFormatter.format(new Date(course.access.availableAt)));
  }
  if (course.access.state === "expired" && course.access.expiresAt) {
    return copy.expiredAt(dateFormatter.format(new Date(course.access.expiresAt)));
  }
  if (course.access.state === "unavailable") {
    return copy.windowUnavailable;
  }
  return copy.courseUnavailable;
}

function CourseCard({ course, locale }: { course: MemberCourse; locale: AppLocale }) {
  const copy = getMemberExperienceCopy(locale).courses;
  const locked = !course.access.accessible;
  const content = (
    <>
      <div className="relative aspect-[16/8.5] overflow-hidden">
        <Image
          {...courseCoverImageProps(course.coverImage)}
          alt=""
          fill
          loading="eager"
          sizes="(max-width:768px) 100vw, 33vw"
          className={cn(
            "object-cover transition-transform duration-300",
            locked ? "opacity-60 grayscale" : "group-hover:scale-[1.02]",
          )}
        />
        <span className="absolute left-3 top-3">
          <Badge
            tone={
              locked
                ? course.access.state === "expired"
                  ? "coral"
                  : "amber"
                : course.status === "completed"
                  ? "teal"
                  : course.status === "not_started"
                    ? "neutral"
                    : "navy"
            }
          >
            {locked ? (
              <>
                <LockKeyhole className="mr-1 size-3" />
                {course.access.state === "upcoming"
                  ? copy.status.upcoming
                  : course.access.state === "expired"
                    ? copy.status.expired
                    : copy.status.unavailable}
              </>
            ) : course.status === "completed" ? (
              <>
                <CheckCircle2 className="mr-1 size-3" />
                {copy.status.completed}
              </>
            ) : course.status === "not_started" ? (
              copy.status.new
            ) : (
              copy.status.inProgress
            )}
          </Badge>
        </span>
        {course.status === "completed" && !locked ? (
          <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-white/90 text-[#d6a536]">
            <Award className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#52606d]">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: course.categoryColor ?? "#66727f" }}
          />
          {course.categoryName ?? copy.uncategorized}
        </p>
        <h2 className="mt-1 text-base font-bold text-[#243444]">
          {course.title}
        </h2>
        <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[#6c7882]">
          {course.shortDescription}
        </p>
        {locked ? (
          <p className="mt-3 flex min-h-5 items-start gap-1.5 text-[11px] font-semibold text-[#8d6a12]">
            <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
            {accessMessage(course, locale)}
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-4 border-t border-[#edf0f2] pt-3 text-[10px] text-[#7a8690]">
          <span className="flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {formatDuration(course.estimatedMinutes, locale)}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="size-3.5" />
            {course.difficulty}
          </span>
        </div>
        {course.showProgressPercentage ? (
          <Progress
            value={course.progress}
            label={copy.progress}
            className="mt-3"
            color={course.categoryColor ?? "#2bb7a9"}
          />
        ) : null}
      </div>
    </>
  );

  if (locked) {
    return (
      <article className="panel overflow-hidden">
        {content}
      </article>
    );
  }
  return (
    <Link
      href={`/academy/courses/${course.slug}`}
      className="focus-ring panel group overflow-hidden"
    >
      {content}
    </Link>
  );
}

export function MemberCourseExplorer({
  courses,
  locale,
}: {
  courses: MemberCourse[];
  locale: AppLocale;
}) {
  const copy = getMemberExperienceCopy(locale).courses;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CourseFilter>("all");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(intlLocale(locale));
    return courses.filter((course) => {
      const matchesQuery =
        !query ||
        `${course.title} ${course.shortDescription} ${course.categoryName ?? ""}`
          .toLocaleLowerCase(intlLocale(locale))
          .includes(query);
      const matchesFilter =
        filter === "all" ||
        (filter === "locked"
          ? !course.access.accessible
          : filter === "completed"
            ? course.access.accessible && course.status === "completed"
            : course.access.accessible && course.status !== "completed");
      return matchesQuery && matchesFilter;
    });
  }, [courses, filter, locale, search]);

  return (
    <>
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-[#f8f9fa] pl-9 pr-3 text-sm"
            placeholder={copy.search}
            aria-label={copy.search}
          />
        </div>
        <div
          className="flex w-full flex-wrap gap-1 rounded-md bg-[#f1f3f5] p-1 sm:w-auto sm:flex-nowrap"
          role="group"
          aria-label={copy.filterLabel}
        >
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              aria-pressed={filter === item}
              className={cn(
                "focus-ring h-8 min-w-0 flex-1 rounded px-2 text-xs font-semibold sm:flex-none sm:px-3",
                filter === item
                  ? "bg-white text-[#17324d] shadow-sm"
                  : "text-[#71808b] hover:bg-white",
              )}
            >
              {copy.filters[item]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((course) => (
            <CourseCard key={course.id} course={course} locale={locale} />
          ))}
        </section>
      ) : (
        <div className="panel grid min-h-64 place-items-center p-8 text-center">
          <div>
            <BookOpen className="mx-auto size-8 text-[#a2abb3]" />
            <p className="mt-3 text-sm font-semibold text-[#354555]">
              {copy.emptyTitle}
            </p>
            <p className="mt-1 text-xs text-[#7a8690]">
              {copy.emptyDescription}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
