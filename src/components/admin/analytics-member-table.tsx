"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  Clock3,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  resetMemberCourseProgressAction,
  type ProgressResetInput,
} from "@/lib/admin-analytics-actions";
import type {
  AdminAnalyticsEnrollment,
  AdminAnalyticsMember,
} from "@/lib/admin-analytics";
import { progressResetActionMessage } from "@/lib/i18n/admin-analytics-actions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  formatDateTime,
  formatDuration,
  formatLearningTime,
} from "@/lib/utils";

type ProgressFilter =
  | "all"
  | "not_started"
  | "in_progress"
  | "completed"
  | "no_assignment";

const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-3 text-sm text-[#243444]";

type AnalyticsMemberCopy = ReturnType<
  typeof getMainPageDictionary
>["admin"]["analytics"]["members"];

function dateLabel(
  value: Date | null,
  locale: AppLocale,
  copy: AnalyticsMemberCopy,
) {
  return value ? formatDateTime(value, locale) : copy.noMeasurement;
}

function statusTone(status: AdminAnalyticsMember["status"]) {
  if (status === "active") return "teal" as const;
  if (status === "invited") return "amber" as const;
  return "coral" as const;
}

function enrollmentTone(status: AdminAnalyticsEnrollment["status"]) {
  if (status === "completed") return "teal" as const;
  if (status === "in_progress") return "blue" as const;
  return "neutral" as const;
}

function ResetProgressDialog({
  member,
  enrollment,
  copy,
  locale,
  onClose,
}: {
  member: AdminAnalyticsMember;
  enrollment: AdminAnalyticsEnrollment;
  copy: AnalyticsMemberCopy;
  locale: AppLocale;
  onClose: () => void;
}) {
  const memberName = `${member.firstName} ${member.lastName}`.trim();
  const [memberConfirmation, setMemberConfirmation] = useState("");
  const [courseConfirmation, setCourseConfirmation] = useState("");
  const [resetSubmissions, setResetSubmissions] = useState(false);
  const [revokeCertificate, setRevokeCertificate] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const confirmed =
    memberConfirmation === memberName &&
    courseConfirmation === enrollment.courseTitle &&
    (!enrollment.activeCertificateId || revokeCertificate);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, pending]);

  function resetProgress() {
    if (!confirmed || pending) return;
    setError("");
    const input: ProgressResetInput = {
      memberId: member.id,
      courseId: enrollment.courseId,
      memberConfirmation,
      courseConfirmation,
      resetSubmissions,
      revokeCertificate,
    };
    startTransition(async () => {
      const result = await resetMemberCourseProgressAction(input);
      const message = progressResetActionMessage(
        locale,
        result.code,
        result.params,
      );
      if (!result.ok) {
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(message);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-5">
      <button
        type="button"
        className="absolute inset-0 bg-[#0f263c]/55 backdrop-blur-[1px] disabled:cursor-wait"
        onClick={onClose}
        disabled={pending}
        aria-label={copy.closeDialog}
      />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.resetProgress}
        className="relative max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#f0d9d6] bg-[#fdf7f6] px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#fbe5e2] text-[#b84e42]">
              <RotateCcw className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase text-[#b84e42]">
                {copy.administrativeAction}
              </p>
              <h2 className="truncate text-base font-bold text-[#243444]">
                {copy.resetProgress}
              </h2>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={onClose}
            disabled={pending}
            aria-label={copy.closeDialog}
          >
            <X className="size-4" />
          </Button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            resetProgress();
          }}
        >
          <div className="space-y-5 p-4 sm:p-5">
            <div>
              <p className="text-sm leading-6 text-[#52606d]">
                {copy.resetSummary(memberName, enrollment.courseTitle)}
              </p>
              <div className="mt-3 grid gap-2 rounded-md border border-[#e4e8eb] bg-[#f8f9fa] p-3 text-xs text-[#52606d] sm:grid-cols-3">
                <span>{copy.lessonStates(enrollment.lessonProgressCount)}</span>
                <span>{copy.quizAttempts(enrollment.assessmentAttemptCount)}</span>
                <span>{copy.submissions(enrollment.submissionCount)}</span>
              </div>
            </div>

            <div className="rounded-md border border-[#ead9a8] bg-[#fffaf0] p-3 text-xs leading-5 text-[#705712]">
              <div className="flex gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>{copy.sharedModuleWarning}</p>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-md border border-[#e4e8eb] p-3">
              <input
                type="checkbox"
                className="focus-ring mt-0.5 size-4 rounded border-[#cfd6dc] accent-[#167e74]"
                checked={resetSubmissions}
                onChange={(event) => setResetSubmissions(event.target.checked)}
              />
              <span>
                <span className="block text-xs font-semibold text-[#354555]">
                  {copy.deleteSubmissions}
                </span>
                <span className="mt-0.5 block text-[11px] leading-5 text-[#71808b]">
                  {copy.deleteSubmissionsHelp}
                </span>
              </span>
            </label>

            {enrollment.activeCertificateId ? (
              <label className="flex items-start gap-3 rounded-md border border-[#f4c8c2] bg-[#fdf7f6] p-3">
                <input
                  type="checkbox"
                  className="focus-ring mt-0.5 size-4 rounded border-[#d8aaa4] accent-[#b84e42]"
                  checked={revokeCertificate}
                  onChange={(event) =>
                    setRevokeCertificate(event.target.checked)
                  }
                />
                <span>
                  <span className="block text-xs font-semibold text-[#9f4137]">
                    {copy.revokeCertificate}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-[#815953]">
                    {copy.revokeCertificateHelp(
                      enrollment.activeCertificateNumber ?? "",
                    )}
                  </span>
                </span>
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[#354555]">
                  {copy.memberConfirmation}
                </span>
                <input
                  className={inputClassName}
                  value={memberConfirmation}
                  onChange={(event) => setMemberConfirmation(event.target.value)}
                  placeholder={memberName}
                  autoComplete="off"
                  autoFocus
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[#354555]">
                  {copy.courseConfirmation}
                </span>
                <input
                  className={inputClassName}
                  value={courseConfirmation}
                  onChange={(event) => setCourseConfirmation(event.target.value)}
                  placeholder={enrollment.courseTitle}
                  autoComplete="off"
                />
              </label>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3 text-xs leading-5 text-[#a94339]"
              >
                {error}
              </p>
            ) : null}
          </div>

          <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {copy.cancel}
            </Button>
            <Button type="submit" variant="danger" disabled={!confirmed || pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              {pending ? copy.resetting : copy.resetProgress}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CourseRows({
  member,
  courses,
  canReset,
  locale,
  copy,
  onReset,
}: {
  member: AdminAnalyticsMember;
  courses: AdminAnalyticsEnrollment[];
  canReset: boolean;
  locale: AppLocale;
  copy: AnalyticsMemberCopy;
  onReset: (course: AdminAnalyticsEnrollment) => void;
}) {
  if (!courses.length) {
    return (
      <p className="py-5 text-center text-xs text-[#7a8690]">
        {copy.noCourseAssignment}
      </p>
    );
  }

  return (
    <div className="divide-y divide-[#e8ecef]">
      {courses.map((course) => (
        <div
          key={course.id}
          className="grid gap-3 py-3 lg:grid-cols-[minmax(180px,1.3fr)_minmax(150px,0.8fr)_130px_auto] lg:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-xs font-semibold text-[#354555]">
                {course.courseTitle}
              </p>
              <Badge tone={course.accessActive ? "neutral" : "coral"}>
                {course.accessActive
                  ? copy.courseStatus[course.courseStatus]
                  : copy.accessRevoked}
              </Badge>
            </div>
            <p className="mt-1 text-[10px] text-[#84909a]">
              {copy.lastAccess(dateLabel(course.lastAccessedAt, locale, copy))}
            </p>
            <p className="mt-1 text-[10px] font-medium text-[#52606d]">
              {copy.activeLearningTime(
                formatLearningTime(course.activeLearningSeconds, locale),
              )}
            </p>
          </div>
          <Progress value={course.progress} label={copy.progress} />
          <Badge tone={enrollmentTone(course.status)}>
            {copy.enrollmentStatus[course.status]}
          </Badge>
          {canReset ? (
            <Button
              size="sm"
              variant="secondary"
              className="w-fit text-[#a94339]"
              onClick={() => onReset(course)}
              aria-label={copy.resetFor(
                `${member.firstName} ${member.lastName}`,
                course.courseTitle,
              )}
            >
              <RotateCcw className="size-3.5" />
              {copy.reset}
            </Button>
          ) : (
            <span className="text-[10px] font-semibold text-[#84909a]">
              {copy.readOnly}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function AnalyticsMemberTable({
  members,
  canReset,
  locale,
}: {
  members: AdminAnalyticsMember[];
  canReset: boolean;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).admin.analytics.members;
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [progressFilter, setProgressFilter] =
    useState<ProgressFilter>("all");
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<{
    member: AdminAnalyticsMember;
    enrollment: AdminAnalyticsEnrollment;
  } | null>(null);

  const courseOptions = useMemo(() => {
    const courses = new Map<string, string>();
    for (const member of members) {
      for (const course of member.courses) {
        courses.set(course.courseId, course.courseTitle);
      }
    }
    return [...courses.entries()].sort((left, right) =>
      left[1].localeCompare(right[1], intlLocale(locale)),
    );
  }, [locale, members]);

  const normalizedSearch = search
    .trim()
    .toLocaleLowerCase(intlLocale(locale));
  const filteredMembers = useMemo(
    () =>
      members.filter((member) => {
        const matchesSearch =
          !normalizedSearch ||
          [
            member.firstName,
            member.lastName,
            member.email,
            member.department ?? "",
            ...member.courses.map((course) => course.courseTitle),
          ]
            .join(" ")
            .toLocaleLowerCase(intlLocale(locale))
            .includes(normalizedSearch);
        if (!matchesSearch) return false;

        const scopedCourses =
          courseFilter === "all"
            ? member.courses
            : member.courses.filter(
                (course) => course.courseId === courseFilter,
              );
        if (courseFilter !== "all" && !scopedCourses.length) return false;
        if (progressFilter === "all") return true;
        if (progressFilter === "no_assignment") {
          return member.courses.length === 0;
        }
        return scopedCourses.some(
          (course) => course.status === progressFilter,
        );
      }),
    [courseFilter, locale, members, normalizedSearch, progressFilter],
  );

  function visibleCourses(member: AdminAnalyticsMember) {
    return courseFilter === "all"
      ? member.courses
      : member.courses.filter((course) => course.courseId === courseFilter);
  }

  function toggleMember(memberId: string) {
    setExpandedMemberId((current) => (current === memberId ? null : memberId));
  }

  return (
    <>
      <section className="panel overflow-hidden" aria-labelledby="member-analytics-title">
        <div className="border-b border-[#e8ebee] p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 id="member-analytics-title" className="text-base font-bold text-[#243444]">
                {copy.title}
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[#71808b]">
                {copy.description}
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-3 xl:max-w-3xl">
              <label className="relative">
                <span className="sr-only">{copy.search}</span>
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={`${inputClassName} pl-9`}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.search}
                />
              </label>
              <select
                value={courseFilter}
                onChange={(event) => setCourseFilter(event.target.value)}
                className={inputClassName}
                aria-label={copy.courseFilter}
              >
                <option value="all">{copy.allCourses}</option>
                {courseOptions.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
              <select
                value={progressFilter}
                onChange={(event) =>
                  setProgressFilter(event.target.value as ProgressFilter)
                }
                className={inputClassName}
                aria-label={copy.progressFilter}
              >
                <option value="all">{copy.allProgress}</option>
                <option value="not_started">{copy.enrollmentStatus.not_started}</option>
                <option value="in_progress">{copy.enrollmentStatus.in_progress}</option>
                <option value="completed">{copy.enrollmentStatus.completed}</option>
                <option value="no_assignment">{copy.noAssignment}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1120px] border-collapse text-left">
            <thead>
              <tr className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                <th className="px-4 py-3">{copy.columns.member}</th>
                <th className="px-4 py-3">{copy.columns.courses}</th>
                <th className="px-4 py-3">{copy.columns.average}</th>
                <th className="px-4 py-3">{copy.columns.lastActivity}</th>
                <th className="px-4 py-3">{copy.columns.lastLesson}</th>
                <th className="px-4 py-3">{copy.columns.activeLearningTime}</th>
                <th className="px-4 py-3 text-right">{copy.columns.details}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {filteredMembers.map((member) => {
                const expanded = expandedMemberId === member.id;
                return (
                  <Fragment key={member.id}>
                    <tr className="hover:bg-[#fafbfb]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar firstName={member.firstName} lastName={member.lastName} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-[#2b3a48]">
                                {member.firstName} {member.lastName}
                              </p>
                              <Badge tone={statusTone(member.status)}>
                                {copy.memberStatus[member.status]}
                              </Badge>
                            </div>
                            <p className="mt-0.5 max-w-56 truncate text-[11px] text-[#7a8690]">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#52606d]">
                        {copy.assignedSummary(
                          member.assignedCourses,
                          member.completedCourses,
                        )}
                      </td>
                      <td className="w-44 px-4 py-3">
                        <Progress value={member.averageProgress} label={copy.average} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[#52606d]">
                        {dateLabel(member.lastActivityAt, locale, copy)}
                      </td>
                      <td className="max-w-56 px-4 py-3">
                        <p className="truncate text-xs font-medium text-[#52606d]">
                          {member.lastLessonTitle ?? copy.noLesson}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[#84909a]">
                          {member.lastLessonAt
                            ? formatDateTime(member.lastLessonAt, locale)
                            : copy.noMeasurement}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-semibold text-[#354555]">
                        {formatLearningTime(member.activeLearningSeconds, locale)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => toggleMember(member.id)}
                          aria-label={copy.courseDetailsFor(
                            `${member.firstName} ${member.lastName}`,
                            expanded ? copy.hideDetails : copy.showDetails,
                          )}
                        >
                          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </Button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={7} className="bg-[#fafbfb] px-5 py-2">
                          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[#e4e8eb] py-3 text-[11px] text-[#66727f]">
                            <span className="inline-flex items-center gap-1.5">
                              <Clock3 className="size-3.5" />
                              {copy.activeLearningTime(
                                formatLearningTime(member.activeLearningSeconds, locale),
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Clock3 className="size-3.5" />
                              {copy.estimatedCompleted(
                                formatDuration(member.estimatedCompletedMinutes, locale),
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Activity className="size-3.5" />
                              {copy.coursesInProgress(member.inProgressCourses)}
                            </span>
                          </div>
                          <CourseRows
                            member={member}
                            courses={visibleCourses(member)}
                            canReset={canReset}
                            locale={locale}
                            copy={copy}
                            onReset={(enrollment) => setResetTarget({ member, enrollment })}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[#edf0f2] md:hidden">
          {filteredMembers.map((member) => {
            const expanded = expandedMemberId === member.id;
            return (
              <article key={member.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar firstName={member.firstName} lastName={member.lastName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[#2b3a48]">
                        {member.firstName} {member.lastName}
                      </h3>
                      <Badge tone={statusTone(member.status)}>
                        {copy.memberStatus[member.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-[#7a8690]">{member.email}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() => toggleMember(member.id)}
                    aria-label={copy.courseDetailsFor(
                      `${member.firstName} ${member.lastName}`,
                      expanded ? copy.hideDetails : copy.showDetails,
                    )}
                  >
                    {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] text-[#84909a]">{copy.columns.courses}</p>
                    <p className="mt-0.5 font-semibold text-[#354555]">
                      {copy.assignedCompact(
                        member.assignedCourses,
                        member.completedCourses,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#84909a]">
                      {copy.columns.activeLearningTime}
                    </p>
                    <p className="mt-0.5 font-semibold text-[#354555]">
                      {formatLearningTime(member.activeLearningSeconds, locale)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Progress value={member.averageProgress} label={copy.average} />
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] text-[#84909a]">
                      {copy.lastMeasuredActivity}
                    </p>
                    <p className="mt-0.5 text-[#52606d]">
                      {dateLabel(member.lastActivityAt, locale, copy)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] text-[#84909a]">
                      {copy.columns.lastLesson}
                    </p>
                    <p className="mt-0.5 truncate text-[#52606d]">
                      {member.lastLessonTitle ?? copy.noLesson}
                    </p>
                  </div>
                </div>
                {expanded ? (
                  <div className="mt-4 border-t border-[#e4e8eb] pt-2">
                    <p className="py-2 text-[10px] text-[#71808b]">
                      {copy.activeLearningTime(
                        formatLearningTime(member.activeLearningSeconds, locale),
                      )}
                    </p>
                    <p className="py-2 text-[10px] text-[#71808b]">
                      {copy.estimatedCompleted(
                        formatDuration(member.estimatedCompletedMinutes, locale),
                      )}
                    </p>
                    <CourseRows
                      member={member}
                      courses={visibleCourses(member)}
                      canReset={canReset}
                      locale={locale}
                      copy={copy}
                      onReset={(enrollment) => setResetTarget({ member, enrollment })}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {filteredMembers.length === 0 ? (
          <div className="grid place-items-center px-5 py-12 text-center">
            <BookOpenCheck className="size-7 text-[#9aa4ac]" />
            <p className="mt-3 text-sm font-semibold text-[#52606d]">
              {copy.noMatchingMembers}
            </p>
            <p className="mt-1 text-xs text-[#84909a]">
              {copy.noMatchingMembersDescription}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f2] px-4 py-3 text-xs text-[#7a8690]">
          <span>{copy.entries(filteredMembers.length, members.length)}</span>
          <span>{canReset ? copy.resetAccess : copy.trainerReadAccess}</span>
        </div>
      </section>

      {resetTarget ? (
        <ResetProgressDialog
          member={resetTarget.member}
          enrollment={resetTarget.enrollment}
          copy={copy}
          locale={locale}
          onClose={() => setResetTarget(null)}
        />
      ) : null}
    </>
  );
}
