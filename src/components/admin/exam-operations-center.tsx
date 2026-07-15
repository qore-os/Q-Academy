"use client";

import { useActionState, useMemo, useState } from "react";
import {
  CircleStop,
  Clock3,
  Eye,
  LoaderCircle,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  finalizeExamOperationAction,
  releaseExamOperationAction,
  type ExamOperationActionState,
} from "@/lib/admin/exam-operations-actions";
import type { AdminExamOperation } from "@/lib/admin/exam-operations";
import {
  getOperationsAdminCopy,
  type OperationsAdminCopy,
} from "@/lib/i18n/operations-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { cn, formatDateTime } from "@/lib/utils";

const initialState: ExamOperationActionState = {};

function statusTone(status: AdminExamOperation["operationStatus"]) {
  if (status === "active") return "blue" as const;
  if (status === "result_manual" || status === "review_manual") {
    return "amber" as const;
  }
  return "neutral" as const;
}

function statusLabel(
  status: AdminExamOperation["operationStatus"],
  copy: OperationsAdminCopy,
) {
  const keys = {
    active: "exam.status.active",
    result_manual: "exam.status.resultManual",
    result_scheduled: "exam.status.resultScheduled",
    result_pending: "exam.status.resultPending",
    review_manual: "exam.status.reviewManual",
    review_pending: "exam.status.reviewPending",
  } as const;
  return copy(keys[status]);
}

function releaseModeLabel(
  mode: AdminExamOperation["resultReleaseMode"],
  copy: OperationsAdminCopy,
) {
  if (mode === "manual") return copy("exam.release.manual");
  if (mode === "after_deadline") return copy("exam.release.deadline");
  return copy("exam.release.immediate");
}

export function ExamOperationsCenter({
  attempts,
  locale,
}: {
  attempts: AdminExamOperation[];
  locale: AppLocale;
}) {
  const copy = getOperationsAdminCopy(locale);
  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale(locale), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [locale],
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending">("all");
  const [releaseState, releaseAction, releasePending] = useActionState(
    releaseExamOperationAction,
    initialState,
  );
  const [finalizeState, finalizeAction, finalizePending] = useActionState(
    finalizeExamOperationAction,
    initialState,
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return attempts.filter((attempt) => {
      const statusMatches =
        filter === "all" ||
        (filter === "active"
          ? attempt.operationStatus === "active"
          : attempt.operationStatus !== "active");
      const searchMatches =
        !needle ||
        `${attempt.firstName} ${attempt.lastName} ${attempt.email} ${attempt.courseTitle} ${attempt.lessonTitle}`
          .toLowerCase()
          .includes(needle);
      return statusMatches && searchMatches;
    });
  }, [attempts, filter, search]);
  const pending = releasePending || finalizePending;
  const state = releaseState.error || releaseState.success
    ? releaseState
    : finalizeState;

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-col gap-4 border-b border-[#e5e8eb] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-md bg-[#eaf0f4] text-[#17324d]">
            <ShieldAlert className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#243444]">
              {copy("exam.title")}
            </h2>
            <p className="text-[11px] text-[#71808b]">
              {copy("exam.openProcesses", { count: attempts.length })}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="inline-flex h-9 rounded-md border border-[#dfe4e8] bg-[#f7f8f9] p-0.5">
            {(["all", "active", "pending"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "focus-ring min-w-20 rounded px-3 text-[11px] font-semibold",
                  filter === value
                    ? "bg-white text-[#17324d] shadow-sm"
                    : "text-[#687681] hover:text-[#243444]",
                )}
              >
                {value === "all"
                  ? copy("exam.filter.all")
                  : value === "active"
                    ? copy("exam.filter.active")
                    : copy("exam.filter.releases")}
              </button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="focus-ring h-9 w-full rounded-md border border-[#dfe4e8] bg-white pl-9 pr-3 text-xs"
              placeholder={copy("exam.search")}
            />
          </div>
        </div>
      </header>

      {state.error ? (
        <p className="border-b border-[#f4c8c2] bg-[#fdf0ee] px-4 py-3 text-xs text-[#a94339]">
          {copy(
            state.code
              ? `exam.message.${state.code}`
              : "exam.message.failed",
          )}
        </p>
      ) : null}
      {state.success ? (
        <p className="border-b border-[#b9e8e3] bg-[#e9f8f6] px-4 py-3 text-xs text-[#167e74]">
          {state.code
            ? copy(`exam.message.${state.code}`)
            : copy("exam.message.failed")}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left">
          <thead className="border-b border-[#e8ebee] bg-[#fafbfb] text-[10px] font-bold uppercase text-[#71808b]">
            <tr>
              <th className="px-4 py-3">{copy("exam.column.participant")}</th>
              <th className="px-4 py-3">{copy("exam.column.exam")}</th>
              <th className="px-4 py-3">{copy("exam.column.status")}</th>
              <th className="px-4 py-3">{copy("exam.column.deadline")}</th>
              <th className="px-4 py-3">{copy("exam.column.result")}</th>
              <th className="px-4 py-3 text-right">{copy("exam.column.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf0f2]">
            {filtered.map((attempt) => (
              <tr key={attempt.id} className="align-top hover:bg-[#fafbfb]">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      firstName={attempt.firstName}
                      lastName={attempt.lastName}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="max-w-52 truncate text-xs font-semibold text-[#2b3a48]">
                        {attempt.firstName} {attempt.lastName}
                      </p>
                      <p className="max-w-52 truncate text-[10px] text-[#7b8791]">
                        {attempt.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <p className="max-w-64 truncate text-xs font-semibold text-[#2b3a48]">
                    {attempt.lessonTitle}
                  </p>
                  <p className="mt-0.5 max-w-64 truncate text-[10px] text-[#7b8791]">
                    {attempt.courseTitle} | {copy("exam.attempt", { count: attempt.attemptNumber })}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <Badge tone={statusTone(attempt.operationStatus)}>
                    {statusLabel(attempt.operationStatus, copy)}
                  </Badge>
                  {attempt.contentAccessMode !== "allow" &&
                  attempt.operationStatus === "active" ? (
                    <p className="mt-1.5 text-[10px] font-semibold text-[#b84e42]">
                      {attempt.contentAccessMode === "block_academy"
                        ? copy("exam.access.academyBlocked")
                        : copy("exam.access.courseBlocked")}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  <p className="flex items-center gap-1.5 text-xs text-[#425160]">
                    <Clock3 className="size-3.5 text-[#7b8791]" />
                    {attempt.deadlineAt
                      ? formatDateTime(attempt.deadlineAt, locale)
                      : copy("exam.noTimeLimit")}
                  </p>
                  <p className="mt-1 text-[10px] text-[#8a949d]">
                    {copy("exam.started", {
                      date: formatDateTime(attempt.startedAt, locale),
                    })}
                  </p>
                </td>
                <td className="px-4 py-4">
                  {attempt.status === "graded" ? (
                    <>
                      <p className="text-xs font-semibold text-[#2b3a48]">
                        {numberFormatter.format(attempt.score)} % | {attempt.passed ? copy("exam.passed") : copy("exam.failed")}
                      </p>
                      <p className="mt-1 text-[10px] text-[#7b8791]">
                        {copy("exam.correct", {
                          correct: attempt.correctCount,
                          total: attempt.questionCount,
                        })} | {releaseModeLabel(attempt.resultReleaseMode, copy)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-[#2b3a48]">
                        {copy("exam.revision", { revision: attempt.draftRevision })}
                      </p>
                      <p className="mt-1 text-[10px] text-[#7b8791]">
                        {attempt.lastSavedAt
                          ? copy("exam.saved", {
                              date: formatDateTime(attempt.lastSavedAt, locale),
                            })
                          : copy("exam.notSaved")}
                      </p>
                    </>
                  )}
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    {attempt.availableActions.includes("release_result") ? (
                      <form action={releaseAction}>
                        <input type="hidden" name="attemptId" value={attempt.id} />
                        <input type="hidden" name="release" value="result" />
                        <Button type="submit" size="sm" disabled={pending}>
                          {releasePending ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Send className="size-3.5" />
                          )}
                          {copy("exam.action.result")}
                        </Button>
                      </form>
                    ) : null}
                    {attempt.availableActions.includes("release_review") ? (
                      <form action={releaseAction}>
                        <input type="hidden" name="attemptId" value={attempt.id} />
                        <input type="hidden" name="release" value="review" />
                        <Button type="submit" size="sm" disabled={pending}>
                          {releasePending ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                          {copy("exam.action.review")}
                        </Button>
                      </form>
                    ) : null}
                    {attempt.availableActions.includes("finalize") ? (
                      <form
                        action={finalizeAction}
                        onSubmit={(event) => {
                          if (
                            !window.confirm(
                              copy("exam.action.finalizeConfirm"),
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="attemptId" value={attempt.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="danger"
                          disabled={pending}
                        >
                          {finalizePending ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <CircleStop className="size-3.5" />
                          )}
                          {copy("exam.action.finalize")}
                        </Button>
                      </form>
                    ) : null}
                    {!attempt.availableActions.length ? (
                      <span className="inline-flex h-8 items-center text-[10px] font-semibold text-[#8a949d]">
                        {copy("exam.action.automatic")}
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length ? (
        <div className="grid min-h-40 place-items-center border-t border-[#edf0f2] px-6 text-center">
          <p className="text-xs text-[#7a8690]">
            {copy("exam.empty")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
