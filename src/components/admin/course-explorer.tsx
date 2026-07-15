"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Clock3,
  Grid2X2,
  LayoutList,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CourseCreationDialog } from "@/components/admin/course-creation-dialog";
import { courseCoverImageProps } from "@/lib/course-cover";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

type CourseRow = {
  id: string;
  title: string;
  slug: string;
  shortDescription: string;
  coverImage: string | null;
  status: "draft" | "published" | "archived";
  difficulty: string;
  estimatedMinutes: number;
  featured: boolean;
  updatedAt: Date;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  learners: number;
  averageProgress: number;
  moduleCount: number;
  permission: "view" | "edit" | "manage";
};

type Category = { id: string; name: string; color: string; slug: string };

export function CourseExplorer({
  courses,
  categories,
  locale,
}: {
  courses: CourseRow[];
  categories: Category[];
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const formatNumber = (value: number) => numberFormatter.format(value);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dialogOpen, setDialogOpen] = useState(false);
  const hydrated = useHydrated();

  const filtered = useMemo(
    () =>
      courses.filter((course) => {
        const matchesSearch = `${course.title} ${course.shortDescription}`
          .toLocaleLowerCase(intlLocale(locale))
          .includes(search.toLocaleLowerCase(intlLocale(locale)));
        const matchesCategory =
          category === "all" || course.categoryId === category;
        return matchesSearch && matchesCategory;
      }),
    [courses, search, category, locale],
  );
  const courseHref = (course: CourseRow) =>
    course.permission === "view"
      ? `/admin/courses/${course.id}/preview`
      : `/admin/courses/${course.id}`;

  return (
    <>
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#85919b]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-[#f8f9fa] pl-9 pr-3 text-sm"
                placeholder={copy.explorer.search}
                aria-label={copy.explorer.search}
              />
            </div>
            <label className="relative">
              <span className="sr-only">{copy.explorer.filterCategory}</span>
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6e7a84]" />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="focus-ring h-10 min-w-44 appearance-none rounded-md border border-[#dfe4e8] bg-white pl-9 pr-8 text-sm text-[#354555]"
              >
                <option value="all">{copy.explorer.allCategories}</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <div
              className="flex rounded-md border border-[#dfe4e8] bg-white p-1"
              role="group"
              aria-label={copy.explorer.view}
            >
              <button
                disabled={!hydrated}
                onClick={() => setView("grid")}
                className={cn(
                  "focus-ring grid size-8 place-items-center rounded",
                  view === "grid"
                    ? "bg-[#17324d] text-white"
                    : "text-[#687580] hover:bg-[#f1f3f5]",
                )}
                aria-label={copy.explorer.gridView}
                title={copy.explorer.gridView}
              >
                <Grid2X2 className="size-4" />
              </button>
              <button
                disabled={!hydrated}
                onClick={() => setView("list")}
                className={cn(
                  "focus-ring grid size-8 place-items-center rounded",
                  view === "list"
                    ? "bg-[#17324d] text-white"
                    : "text-[#687580] hover:bg-[#f1f3f5]",
                )}
                aria-label={copy.explorer.listView}
                title={copy.explorer.listView}
              >
                <LayoutList className="size-4" />
              </button>
            </div>
            <Button disabled={!hydrated} onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              {copy.explorer.newCourse}
            </Button>
          </div>
        </div>

        <div className="border-b border-[#edf0f2] px-4 py-3 text-xs text-[#75818b]">
          {copy.explorer.resultCount(
            formatNumber(filtered.length),
            formatNumber(courses.length),
          )}
        </div>

        {filtered.length ? (
          view === "grid" ? (
            <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((course) => (
                <article
                  key={course.id}
                  className="group overflow-hidden rounded-md border border-[#e2e6e9] bg-white transition-shadow hover:shadow-lg"
                >
                  <Link
                    href={courseHref(course)}
                    className="focus-ring relative block aspect-[16/8.5] overflow-hidden bg-[#dfe5eb]"
                  >
                    <Image
                      {...courseCoverImageProps(course.coverImage)}
                      alt=""
                      fill
                      loading="eager"
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                    <span className="absolute left-3 top-3">
                      <Badge
                        tone={
                          course.status === "published"
                            ? "teal"
                            : course.status === "draft"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {copy.common.courseStatus[course.status]}
                      </Badge>
                    </span>
                    {course.featured ? (
                      <span className="absolute right-3 top-3">
                        <Badge tone="navy">{copy.explorer.featured}</Badge>
                      </span>
                    ) : null}
                  </Link>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#52606d]">
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: course.categoryColor ?? "#66727f" }}
                          />
                          {course.categoryName ?? copy.common.uncategorized}
                        </p>
                        <h2 className="mt-1 line-clamp-2 text-base font-bold text-[#1d2b38]">
                          {course.title}
                        </h2>
                        <Badge className="mt-2">
                          {copy.common.permission[course.permission]}
                        </Badge>
                      </div>
                      <Link
                        href={courseHref(course)}
                        className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3] hover:text-[#17324d]"
                        aria-label={copy.explorer.courseAction(
                          course.title,
                          course.permission === "view"
                            ? copy.explorer.viewCourse
                            : copy.explorer.editCourse,
                        )}
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[#6c7882]">
                      {course.shortDescription}
                    </p>
                    <div className="mt-4 grid grid-cols-3 gap-2 border-y border-[#edf0f2] py-3 text-[11px] text-[#66727f]">
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="size-3.5" />
                        {copy.explorer.modules(formatNumber(course.moduleCount))}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Users className="size-3.5" />
                        {formatNumber(course.learners)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock3 className="size-3.5" />
                        {formatDuration(course.estimatedMinutes, locale)}
                      </span>
                    </div>
                    <Progress
                      value={course.averageProgress}
                      label={copy.explorer.averageProgress}
                      className="mt-4"
                      color={course.categoryColor ?? "#2bb7a9"}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="table-scroll overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                    <th className="px-4 py-3">{copy.explorer.columns.course}</th>
                    <th className="px-4 py-3">{copy.explorer.columns.category}</th>
                    <th className="px-4 py-3">{copy.explorer.columns.status}</th>
                    <th className="px-4 py-3">{copy.explorer.columns.permission}</th>
                    <th className="px-4 py-3">{copy.explorer.columns.members}</th>
                    <th className="px-4 py-3">{copy.explorer.columns.progress}</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">{copy.explorer.columns.action}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0f2]">
                  {filtered.map((course) => (
                    <tr key={course.id} className="hover:bg-[#fafbfb]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded">
                            <Image
                              {...courseCoverImageProps(course.coverImage)}
                              alt=""
                              fill
                              loading="eager"
                              sizes="80px"
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[#243444]">
                              {course.title}
                            </p>
                            <p className="mt-0.5 text-xs text-[#7a8690]">
                              {copy.explorer.modules(formatNumber(course.moduleCount))} |{" "}
                              {formatDuration(course.estimatedMinutes, locale)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#52606d]">
                        {course.categoryName ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            course.status === "published" ? "teal" : "amber"
                          }
                        >
                          {copy.common.courseStatus[course.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{copy.common.permission[course.permission]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-[#354555]">
                        {formatNumber(course.learners)}
                      </td>
                      <td className="w-48 px-4 py-3">
                        <Progress value={course.averageProgress} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={courseHref(course)}
                          className={buttonClassName({
                            variant: "secondary",
                            size: "sm",
                          })}
                        >
                          {course.permission === "view"
                            ? copy.explorer.viewCourse
                            : copy.explorer.editCourse}
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="grid min-h-72 place-items-center p-8 text-center">
            <div>
              <BookOpen className="mx-auto size-8 text-[#a2abb3]" />
              <p className="mt-3 text-sm font-semibold text-[#354555]">
                {copy.explorer.emptyTitle}
              </p>
              <p className="mt-1 text-xs text-[#7a8690]">
                {copy.explorer.emptyDescription}
              </p>
            </div>
          </div>
        )}
      </div>

      {dialogOpen ? (
        <CourseCreationDialog
          categories={categories}
          locale={locale}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}
