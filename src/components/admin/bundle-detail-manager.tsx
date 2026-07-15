"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarClock,
  Check,
  Eye,
  EyeOff,
  Layers3,
  LoaderCircle,
  PackageOpen,
  Plus,
  Save,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addBundleCourseAdminAction,
  removeBundleCourseAdminAction,
  updateBundleAdminAction,
  updateBundleCoursePolicyAdminAction,
  type AccessManagementActionResult,
} from "@/lib/admin/access-management-actions";
import {
  formatAdminEntityDifficulty,
  formatAdminEntityNumber,
  getAdminEntityCopy,
  type AdminEntityCopy,
  type AdminEntityUiKey,
} from "@/lib/i18n/admin-entities";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";
import { formatDuration } from "@/lib/utils";

type BundleDetailData = {
  bundle: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    active: boolean;
    courseCount: number;
    groupCount: number;
    directMemberCount: number;
    effectiveLearnerCount: number;
  };
  courses: Array<{
    id: string;
    title: string;
    status: string;
    difficulty: string;
    estimatedMinutes: number;
    availableFrom: Date | string | null;
    availableUntil: Date | string | null;
    delayDays: number;
    visible: boolean;
  }>;
  availableCourses: Array<{ id: string; title: string; status: string }>;
  assignedGroups: Array<{ id: string; name: string; color: string }>;
  assignedMembers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  }>;
};

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";
const textareaClass = `${inputClass} h-auto min-h-24 py-2.5 leading-6`;

function toLocalDateTime(value: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function RemoveCourseControl({
  copy,
  label,
  hydrated,
  pending,
  onRemove,
}: {
  copy: AdminEntityCopy;
  label: string;
  hydrated: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending || !hydrated}
        className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a949d] hover:bg-[#fdf0ee] hover:text-[#c95b4f] disabled:opacity-40"
        aria-label={copy("common.removeNamed", { name: label })}
        title={copy("common.removeNamed", { name: label })}
      >
        <Trash2 className="size-4" />
      </button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md bg-[#fdf0ee] p-1">
      <button
        type="button"
        onClick={onRemove}
        disabled={pending || !hydrated}
        className="focus-ring grid size-8 place-items-center rounded text-[#b84e42] hover:bg-white disabled:opacity-40"
        aria-label={copy("common.reallyRemoveNamed", { name: label })}
        title={copy("common.confirmRemove")}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending || !hydrated}
        className="focus-ring grid size-8 place-items-center rounded text-[#66727f] hover:bg-white disabled:opacity-40"
        aria-label={copy("common.cancelRemove")}
        title={copy("common.cancel")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof PackageOpen;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-lg font-bold text-[#243444]">{value}</p>
        <p className="text-[10px] text-[#7a8690]">{label}</p>
      </div>
    </div>
  );
}

export function BundleDetailManager({
  data,
  locale,
}: {
  data: BundleDetailData;
  locale: AppLocale;
}) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const copy = getAdminEntityCopy(locale);

  const run = (
    task: () => Promise<AccessManagementActionResult>,
    successKey: AdminEntityUiKey,
  ) => {
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          toast.error(copy("common.genericError"));
          return;
        }
        toast.success(copy(successKey));
        router.refresh();
      } catch {
        toast.error(copy("common.genericError"));
      }
    });
  };

  const addCourse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const courseId = String(
      new FormData(event.currentTarget).get("courseId") ?? "",
    );
    if (courseId)
      run(
        () => addBundleCourseAdminAction(data.bundle.id, courseId),
        "bundle.courseAdded",
      );
  };

  const updateCoursePolicy = (
    event: FormEvent<HTMLFormElement>,
    courseId: string,
  ) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    for (const field of ["availableFrom", "availableUntil"] as const) {
      const value = String(formData.get(field) ?? "");
      formData.set(field, value ? new Date(value).toISOString() : "");
    }
    formData.set("visible", formData.has("visible") ? "true" : "false");
    run(
      () =>
        updateBundleCoursePolicyAdminAction(
          data.bundle.id,
          courseId,
          formData,
        ),
      "bundle.policySaved",
    );
  };

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateBundleAdminAction(data.bundle.id, formData),
              "bundle.saved",
            );
          }}
          className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("bundle.name")}
              </span>
              <input
                name="name"
                defaultValue={data.bundle.name}
                className={inputClass}
                required
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("common.description")}
              </span>
              <textarea
                name="description"
                defaultValue={data.bundle.description ?? ""}
                className={textareaClass}
              />
            </label>
          </div>
          <div className="grid gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("bundle.color")}
              </span>
              <span className="flex h-10 items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3">
                <input
                  name="color"
                  type="color"
                  defaultValue={data.bundle.color}
                  className="size-6 cursor-pointer border-0 bg-transparent p-0"
                />
                <span className="text-xs text-[#66727f]">
                  {data.bundle.color}
                </span>
              </span>
            </label>
            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold text-[#52606d]">
              <input
                name="active"
                type="checkbox"
                defaultChecked={data.bundle.active}
                className="size-4 accent-[#2bb7a9]"
              />
              {copy("bundle.enabled")}
            </label>
          </div>
          <Button type="submit" disabled={pending || !hydrated}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy("common.save")}
          </Button>
        </form>
        <div className="grid divide-y divide-[#edf0f2] border-t border-[#edf0f2] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Metric
            label={copy("common.courses")}
            value={formatAdminEntityNumber(data.bundle.courseCount, locale)}
            icon={BookOpen}
          />
          <Metric
            label={copy("common.groups")}
            value={formatAdminEntityNumber(data.bundle.groupCount, locale)}
            icon={Layers3}
          />
          <Metric
            label={copy("common.directMembers")}
            value={formatAdminEntityNumber(data.bundle.directMemberCount, locale)}
            icon={UserRound}
          />
          <Metric
            label={copy("common.activeLearners")}
            value={formatAdminEntityNumber(data.bundle.effectiveLearnerCount, locale)}
            icon={UsersRound}
          />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <header className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen className="size-4 text-[#2b9188]" />
            <h2 className="text-sm font-bold text-[#243444]">
              {copy("bundle.includedCourses")}
            </h2>
            <Badge tone="blue">
              {formatAdminEntityNumber(data.courses.length, locale)}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-[#7a8690]">
            {copy("bundle.courseHint")}
          </p>
        </header>
        <div className="border-b border-[#edf0f2] bg-[#fafbfb] p-4 sm:p-5">
          {data.availableCourses.length ? (
            <form
              onSubmit={addCourse}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <label htmlFor="bundle-course-select" className="sr-only">
                {copy("common.selectCourse")}
              </label>
              <select
                id="bundle-course-select"
                name="courseId"
                defaultValue=""
                className={inputClass}
                required
              >
                <option value="" disabled>
                  {copy("common.selectCourse")}
                </option>
                {data.availableCourses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} |{" "}
                    {course.status === "published"
                      ? copy("common.live")
                      : copy("common.draft")}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={pending || !hydrated}>
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {copy("common.add")}
              </Button>
            </form>
          ) : (
            <p className="text-[11px] text-[#7d8891]">
              {copy("bundle.allCoursesIncluded")}
            </p>
          )}
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {data.courses.map((course) => (
            <div
              key={course.id}
              className="px-4 py-4 sm:px-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#176f68]">
                  <BookOpen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className="focus-ring rounded text-sm font-semibold text-[#2b3a48] hover:text-[#176f68]"
                  >
                    {course.title}
                  </Link>
                  <p className="text-[10px] text-[#7a8690]">
                    {formatAdminEntityDifficulty(course.difficulty, copy)} |{" "}
                    {formatDuration(course.estimatedMinutes, locale)}
                  </p>
                </div>
                {!course.visible ? (
                  <Badge tone="coral">{copy("common.hidden")}</Badge>
                ) : null}
                {course.delayDays > 0 ? (
                  <Badge tone="amber">
                    {copy("bundle.delay", {
                      count: formatAdminEntityNumber(course.delayDays, locale),
                    })}
                  </Badge>
                ) : null}
                <Badge tone={course.status === "published" ? "teal" : "amber"}>
                  {course.status === "published"
                    ? copy("common.live")
                    : copy("common.draft")}
                </Badge>
                <RemoveCourseControl
                  copy={copy}
                  label={course.title}
                  hydrated={hydrated}
                  pending={pending}
                  onRemove={() =>
                    run(
                      () =>
                        removeBundleCourseAdminAction(data.bundle.id, course.id),
                      "bundle.courseRemoved",
                    )
                  }
                />
              </div>
              <form
                onSubmit={(event) => updateCoursePolicy(event, course.id)}
                className="mt-3 grid gap-3 border-t border-[#edf0f2] pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_140px_150px_auto] lg:items-end"
              >
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#52606d]">
                    <CalendarClock className="size-3.5" />
                    {copy("bundle.startDate")}
                  </span>
                  <input
                    name="availableFrom"
                    type="datetime-local"
                    defaultValue={toLocalDateTime(course.availableFrom)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#52606d]">
                    <CalendarClock className="size-3.5" />
                    {copy("bundle.endDate")}
                  </span>
                  <input
                    name="availableUntil"
                    type="datetime-local"
                    defaultValue={toLocalDateTime(course.availableUntil)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#52606d]">
                    {copy("bundle.delayDays")}
                  </span>
                  <input
                    name="delayDays"
                    type="number"
                    min={0}
                    max={3650}
                    step={1}
                    defaultValue={course.delayDays}
                    className={inputClass}
                    required
                  />
                </label>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold text-[#52606d]">
                  <input
                    name="visible"
                    type="checkbox"
                    value="true"
                    defaultChecked={course.visible}
                    className="size-4 accent-[#2bb7a9]"
                  />
                  {course.visible ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                  {copy("common.visible")}
                </label>
                <Button
                  type="submit"
                  size="icon"
                  variant="secondary"
                  disabled={pending || !hydrated}
                  aria-label={copy("bundle.saveReleaseNamed", {
                    name: course.title,
                  })}
                  title={copy("bundle.saveRelease")}
                >
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                </Button>
              </form>
            </div>
          ))}
          {!data.courses.length ? (
            <div className="grid min-h-36 place-items-center text-center">
              <div>
                <PackageOpen className="mx-auto size-7 text-[#a2abb3]" />
                <p className="mt-2 text-xs font-semibold text-[#52606d]">
                  {copy("bundle.noCourses")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <header className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
          <h2 className="text-sm font-bold text-[#243444]">
            {copy("bundle.assignments")}
          </h2>
          <p className="mt-1 text-[11px] text-[#7a8690]">
            {copy("bundle.assignmentsHint")}
          </p>
        </header>
        <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-[#edf0f2]">
          <div>
            <div className="flex items-center gap-2 border-b border-[#edf0f2] px-4 py-3 text-xs font-semibold text-[#52606d]">
              <Layers3 className="size-4" />
              {copy("common.groups")} {" "}
              <Badge tone="neutral">
                {formatAdminEntityNumber(data.assignedGroups.length, locale)}
              </Badge>
            </div>
            <div className="divide-y divide-[#edf0f2]">
              {data.assignedGroups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span
                    className="size-3 rounded-sm"
                    style={{ backgroundColor: group.color }}
                  />
                  <Link
                    href={`/admin/groups/${group.id}`}
                    className="focus-ring rounded text-xs font-semibold text-[#2b3a48] hover:text-[#176f68]"
                  >
                    {group.name}
                  </Link>
                </div>
              ))}
              {!data.assignedGroups.length ? (
                <p className="px-4 py-6 text-center text-[11px] text-[#7d8891]">
                  {copy("bundle.noGroups")}
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 border-b border-[#edf0f2] px-4 py-3 text-xs font-semibold text-[#52606d]">
              <UsersRound className="size-4" />
              {copy("common.directMembers")} {" "}
              <Badge tone="neutral">
                {formatAdminEntityNumber(data.assignedMembers.length, locale)}
              </Badge>
            </div>
            <div className="divide-y divide-[#edf0f2]">
              {data.assignedMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Avatar
                    firstName={member.firstName}
                    lastName={member.lastName}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/admin/members/${member.id}`}
                      className="focus-ring rounded text-xs font-semibold text-[#2b3a48] hover:text-[#176f68]"
                    >
                      {member.firstName} {member.lastName}
                    </Link>
                    <p className="truncate text-[10px] text-[#7a8690]">
                      {member.email}
                    </p>
                  </div>
                </div>
              ))}
              {!data.assignedMembers.length ? (
                <p className="px-4 py-6 text-center text-[11px] text-[#7d8891]">
                  {copy("bundle.noMembers")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <p className="text-[10px] text-[#7d8891]">
        {copy("bundle.preserveHint")}
      </p>
    </div>
  );
}
