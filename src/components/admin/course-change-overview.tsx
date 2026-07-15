"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ArrowUpDown,
  CheckCircle2,
  CloudUpload,
  FilePenLine,
  History,
  LoaderCircle,
  Mail,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  publishCourseChangesAction,
  toggleCourseStatusAction,
} from "@/lib/actions";
import type {
  CourseChangeEntry,
  CourseChangeKind,
} from "@/lib/course-change-log";
import type { AdminCourseChangeOverview } from "@/lib/course-change-service";
import { cn } from "@/lib/utils";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

const kindStyles: Record<CourseChangeKind, string> = {
  added: "bg-[#e9f8f6] text-[#167e74]",
  updated: "bg-[#eef3f9] text-[#365f8d]",
  removed: "bg-[#fdf0ee] text-[#b84e42]",
  moved: "bg-[#fbf6e7] text-[#8d6a12]",
};

function ChangeIcon({ kind }: { kind: CourseChangeKind }) {
  if (kind === "added") return <Plus className="size-3.5" />;
  if (kind === "removed") return <Trash2 className="size-3.5" />;
  if (kind === "moved") return <ArrowUpDown className="size-3.5" />;
  return <FilePenLine className="size-3.5" />;
}

function ChangeRow({ entry, locale }: { entry: CourseChangeEntry; locale: AppLocale }) {
  const kindLabels = getCourseSupportCopy(locale).changes.kind;
  return (
    <li className="flex min-w-0 items-start gap-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md",
          kindStyles[entry.kind],
        )}
        title={kindLabels[entry.kind]}
      >
        <ChangeIcon kind={entry.kind} />
      </span>
      <span className="min-w-0">
        <span className="block break-words text-xs font-semibold text-[#2b3a48]">
          {entry.title}
        </span>
        <span className="mt-0.5 block break-words text-[11px] leading-4 text-[#74818c]">
          {entry.detail}
        </span>
      </span>
      <span className="ml-auto hidden shrink-0 text-[10px] font-semibold text-[#87919a] sm:block">
        {kindLabels[entry.kind]}
      </span>
    </li>
  );
}

function PublishButton({
  initialPublication,
  locale,
}: {
  initialPublication: boolean;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).changes;
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <CloudUpload className="size-4" />
      )}
      {pending
        ? copy.publishing
        : initialPublication
          ? copy.publishCourse
          : copy.publishVersion}
    </Button>
  );
}

function ChangesPanel({
  courseId,
  courseStatus,
  overview,
  canPublishCourse,
  locale,
}: {
  courseId: string;
  courseStatus: string;
  overview: AdminCourseChangeOverview;
  canPublishCourse: boolean;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).changes;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const comparison = overview.comparison;
  const initialPublication = courseStatus !== "published";
  const publicationAction = initialPublication
    ? toggleCourseStatusAction.bind(null, courseId)
    : publishCourseChangesAction.bind(null, courseId);

  if (overview.comparisonUnavailable || !comparison) {
    return (
      <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
        <div className="max-w-md">
          <TriangleAlert className="mx-auto size-8 text-[#b07b18]" />
          <h3 className="mt-3 text-sm font-bold text-[#243444]">
            {copy.unavailableTitle}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#74818c]">
            {copy.unavailableDescription}
          </p>
        </div>
      </div>
    );
  }

  if (!comparison.hasChanges) {
    return (
      <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
        <div>
          <CheckCircle2 className="mx-auto size-9 text-[#24988d]" />
          <h3 className="mt-3 text-sm font-bold text-[#243444]">
            {copy.noChangesTitle}
          </h3>
          <p className="mt-1 text-xs text-[#74818c]">
            {copy.noChangesDescription}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={publicationAction}>
      <input type="hidden" name="locale" value={locale} />
      <div className="border-b border-[#e8ebee] bg-[#f7f9fa] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#61707c]">
          <strong className="text-xs text-[#243444]">
            {copy.total(numberFormatter.format(comparison.total))}
          </strong>
          {comparison.counts.added ? <span>{copy.newCount(numberFormatter.format(comparison.counts.added))}</span> : null}
          {comparison.counts.updated ? <span>{copy.updatedCount(numberFormatter.format(comparison.counts.updated))}</span> : null}
          {comparison.counts.removed ? <span>{copy.removedCount(numberFormatter.format(comparison.counts.removed))}</span> : null}
          {comparison.counts.moved ? <span>{copy.movedCount(numberFormatter.format(comparison.counts.moved))}</span> : null}
        </div>
      </div>
      <div className="divide-y divide-[#e8ebee] px-4 sm:px-5">
        {comparison.groups.map((group) => (
          <details key={group.key} open className="group py-3">
            <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 rounded py-1 text-sm font-bold text-[#2b3a48]">
              <FilePenLine className="size-4 shrink-0 text-[#4b7ca4]" />
              <span>{group.label}</span>
              <Badge className="ml-auto">{group.entries.length}</Badge>
            </summary>
            <ul className="mt-2 divide-y divide-[#edf0f2] pl-1 sm:pl-7">
              {group.entries.map((entry) => (
                <ChangeRow key={entry.key} entry={entry} locale={locale} />
              ))}
            </ul>
          </details>
        ))}
      </div>
      <div className="sticky bottom-0 border-t border-[#e1e5e8] bg-white px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-start gap-2.5 rounded-md border border-[#dce5e9] bg-[#f7f9fa] p-3">
          <Mail className="mt-0.5 size-4 shrink-0 text-[#39766f]" />
          <div className="min-w-0 text-[11px] leading-4 text-[#61707c]">
            <strong className="block text-xs text-[#2b3a48]">
              {copy.emailPreview}
            </strong>
            {overview.releaseEmailPreview.enabled ? (
              overview.releaseEmailPreview.modules.length ? (
                <>
                  <span className="mt-0.5 block">
                    {copy.emailSummary(
                      numberFormatter.format(overview.releaseEmailPreview.recipientCount),
                      numberFormatter.format(overview.releaseEmailPreview.eligibleRecipientCount),
                      numberFormatter.format(overview.releaseEmailPreview.modules.length),
                    )}
                  </span>
                  <span className="mt-1 block break-words font-medium text-[#465866]">
                    {overview.releaseEmailPreview.modules
                      .slice(0, 4)
                      .map((module) => module.title)
                      .join(" | ")}
                    {overview.releaseEmailPreview.modules.length > 4
                      ? ` | +${overview.releaseEmailPreview.modules.length - 4}`
                      : ""}
                  </span>
                </>
              ) : (
                <span className="mt-0.5 block">
                  {copy.noNewModules}
                </span>
              )
            ) : (
              <span className="mt-0.5 block">
                {copy.emailsDisabled}
              </span>
            )}
          </div>
        </div>
        <label className="block text-xs font-semibold text-[#42515f]" htmlFor="course-changelog">
          {copy.versionNote}
        </label>
        <textarea
          id="course-changelog"
          name="changelog"
          maxLength={5_000}
          rows={2}
          disabled={!canPublishCourse}
          placeholder={copy.versionPlaceholder}
          className="focus-ring mt-1.5 min-h-16 w-full resize-y rounded-md border border-[#dce1e5] bg-white px-3 py-2 text-sm leading-5 text-[#243444] placeholder:text-[var(--theme-muted-text)]"
        />
        <div className="mt-3 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-[11px] leading-4 text-[#74818c]">
            {copy.publishVisibility}
          </p>
          {canPublishCourse ? (
            <PublishButton initialPublication={initialPublication} locale={locale} />
          ) : (
            <Badge>{copy.publishPermission}</Badge>
          )}
        </div>
      </div>
    </form>
  );
}

function HistoryPanel({
  overview,
  locale,
}: {
  overview: AdminCourseChangeOverview;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).changes;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const dateFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  if (!overview.versions.length) {
    return (
      <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
        <div>
          <History className="mx-auto size-8 text-[#7f8b95]" />
          <h3 className="mt-3 text-sm font-bold text-[#243444]">
            {copy.noVersionsTitle}
          </h3>
          <p className="mt-1 text-xs text-[#74818c]">
            {copy.noVersionsDescription}
          </p>
        </div>
      </div>
    );
  }
  return (
    <ol className="divide-y divide-[#e8ebee] px-4 sm:px-5">
      {overview.versions.map((version) => (
        <li key={version.id} className="grid gap-2 py-4 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:gap-4">
          <div>
            <p className="text-sm font-bold text-[#243444]">
              {copy.version(numberFormatter.format(version.version))}
            </p>
            <p className="mt-0.5 text-[10px] text-[#87919a]">
              {version.publishedAt ? copy.published : copy.saved}
            </p>
          </div>
          <div className="min-w-0">
            <p className="break-words text-xs leading-5 text-[#52616d]">
              {version.changelog || copy.noVersionNote}
            </p>
            <p className="mt-1 text-[10px] text-[#87919a]">
              {dateFormatter.format(new Date(version.publishedAt ?? version.createdAt))} | {version.authorName}
            </p>
          </div>
          <div>{version.isCurrent ? <Badge tone="teal">{copy.current}</Badge> : null}</div>
        </li>
      ))}
    </ol>
  );
}

export function CourseChangeOverview({
  courseId,
  courseStatus,
  overview,
  canPublishCourse,
  locale,
}: {
  courseId: string;
  courseStatus: string;
  overview: AdminCourseChangeOverview;
  canPublishCourse: boolean;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).changes;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const hydrated = useHydrated();
  const dialogRef = useRef<HTMLElement>(null);
  const changesTabRef = useRef<HTMLButtonElement>(null);
  const historyTabRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const initialTabRef = useRef<"changes" | "history">("changes");
  const comparison = overview.comparison;
  const hasChanges = Boolean(comparison?.hasChanges);
  const canPublish =
    courseStatus !== "archived" &&
    (hasChanges || courseStatus !== "published");
  const directPublicationAction =
    courseStatus !== "published"
      ? toggleCourseStatusAction.bind(null, courseId)
      : publishCourseChangesAction.bind(null, courseId);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocus =
      initialTabRef.current === "history"
        ? historyTabRef.current
        : changesTabRef.current;
    initialFocus?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), details > summary',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  const show = (nextTab: "changes" | "history") => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    initialTabRef.current = nextTab;
    setTab(nextTab);
    setOpen(true);
  };

  const closeDialog = () => setOpen(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {hasChanges ? (
          <button
            type="button"
            onClick={() => show("changes")}
            disabled={!hydrated}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-[#cedbed] bg-[#eef3f9] px-3 text-xs font-semibold text-[#365f8d] hover:bg-[#e5edf6]"
            data-testid="course-change-marker"
          >
            <FilePenLine className="size-4" />
            {copy.viewChanges}
            <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px]">
              {numberFormatter.format(comparison!.total)}
            </span>
          </button>
        ) : overview.comparisonUnavailable ? (
          <span className="inline-flex h-10 items-center gap-2 text-xs font-semibold text-[#9a6e17]">
            <TriangleAlert className="size-4" />
            {copy.comparisonUnavailable}
          </span>
        ) : (
          <span className="inline-flex h-10 items-center gap-2 text-xs font-semibold text-[#3f786f]">
            <CheckCircle2 className="size-4" />
            {copy.noChangesTitle}
          </span>
        )}
        {canPublishCourse ? (
          <form action={directPublicationAction}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" disabled={!canPublish}>
              <CloudUpload className="size-4" />
              {courseStatus !== "published" ? copy.publishCourse : copy.updateCourse}
              {courseStatus === "published" ? (
                <span className="sr-only">{copy.publishChanges}</span>
              ) : null}
            </Button>
          </form>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => show("history")}
          disabled={!hydrated}
          aria-label={copy.versionHistory}
          title={copy.versionHistory}
        >
          <History className="size-4" />
        </Button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[85] grid place-items-center p-3 sm:p-5">
          <button
            type="button"
            onClick={closeDialog}
            className="absolute inset-0 bg-[#0f263c]/55 backdrop-blur-[1px]"
            tabIndex={-1}
            aria-hidden="true"
          />
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-change-dialog-title"
            className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-[#e8ebee] px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[9px] font-bold uppercase text-[#2b9188]">
                  {copy.eyebrow}
                </p>
                <h2 id="course-change-dialog-title" className="text-base font-bold text-[#243444]">
                  {copy.dialogTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                aria-label={getCourseSupportCopy(locale).common.closeDialog}
              >
                <X className="size-4.5" />
              </button>
            </header>
            <div className="grid grid-cols-2 border-b border-[#e8ebee] px-3" role="tablist" aria-label={copy.views}>
              <button
                ref={changesTabRef}
                type="button"
                role="tab"
                aria-selected={tab === "changes"}
                onClick={() => setTab("changes")}
                className={cn(
                  "focus-ring relative h-11 px-2 text-xs font-semibold",
                  tab === "changes" ? "text-[#17324d]" : "text-[#74818c]",
                )}
              >
                {copy.viewChanges}
                {tab === "changes" ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[#2bb7a9]" /> : null}
              </button>
              <button
                ref={historyTabRef}
                type="button"
                role="tab"
                aria-selected={tab === "history"}
                onClick={() => setTab("history")}
                className={cn(
                  "focus-ring relative h-11 px-2 text-xs font-semibold",
                  tab === "history" ? "text-[#17324d]" : "text-[#74818c]",
                )}
              >
                {copy.versionHistory}
                {tab === "history" ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[#2bb7a9]" /> : null}
              </button>
            </div>
            <div
              role="tabpanel"
              className="min-h-0 flex-1 overflow-y-auto"
              data-testid={tab === "changes" ? "course-change-list" : "course-version-history"}
            >
              {tab === "changes" ? (
                <ChangesPanel
                  courseId={courseId}
                  courseStatus={courseStatus}
                  overview={overview}
                  canPublishCourse={canPublishCourse}
                  locale={locale}
                />
              ) : (
                <HistoryPanel overview={overview} locale={locale} />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
