"use client";

import { useActionState, useMemo, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Mail,
  MessageSquareQuote,
  RotateCcw,
  Search,
  Send,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  replyToFeedbackAction,
  reviewFeedbackAction,
  type FeedbackActionState,
} from "@/lib/feedback-actions";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  formatOperationsAdminNumber,
  getOperationsAdminCopy,
  type OperationsAdminCopy,
} from "@/lib/i18n/operations-admin";
import { formatDateTime } from "@/lib/utils";

type FeedbackRow = {
  id: string;
  type: string;
  rating: number;
  content: string;
  testimonialConsent: boolean;
  status: "new" | "reviewed" | "archived";
  createdAt: Date;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  courseId: string | null;
  courseTitle: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
};

type StatusFilter = "all" | "open" | "completed";
type SortMode = "latest" | "name" | "rating_desc" | "rating_asc";

const initialState: FeedbackActionState = {};
const controlClassName =
  "focus-ring h-9 min-w-0 rounded-md border border-[#dfe4e8] bg-white px-3 text-xs text-[#354555]";

function ReplyComposer({
  feedback,
  copy,
}: {
  feedback: FeedbackRow;
  copy: OperationsAdminCopy;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    replyToFeedbackAction,
    initialState,
  );

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="size-8"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={copy("feedback.sendTo", {
          name: `${feedback.firstName} ${feedback.lastName}`,
        })}
        title={copy("feedback.sendTitle")}
      >
        <Mail className="size-4" />
      </Button>
      {open ? (
        <form
          action={action}
          className="mt-3 grid gap-3 rounded-md border border-[#dfe4e8] bg-[#fafbfb] p-3 sm:min-w-[360px]"
        >
          <input type="hidden" name="feedbackId" value={feedback.id} />
          <p className="text-xs font-semibold text-[#354555]">
            {copy("feedback.sendTo", {
              name: `${feedback.firstName} ${feedback.lastName}`,
            })}
          </p>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-[#66727f]">
              {copy("feedback.subject")}
            </span>
            <input
              name="subject"
              required
              minLength={3}
              maxLength={200}
              defaultValue={
                feedback.courseTitle
                  ? copy("feedback.subjectCourse", {
                      course: feedback.courseTitle,
                    })
                  : copy("feedback.subjectDefault")
              }
              className={`${controlClassName} w-full`}
              disabled={pending || Boolean(state.success)}
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-[#66727f]">
              {copy("feedback.message")}
            </span>
            <textarea
              name="message"
              required
              minLength={3}
              maxLength={10_000}
              className="focus-ring min-h-28 w-full rounded-md border border-[#dfe4e8] bg-white p-3 text-sm leading-6"
              disabled={pending || Boolean(state.success)}
            />
          </label>
          <div aria-live="polite">
            {state.error ? (
              <p className="text-xs text-[#a94339]">
                {copy(
                  state.code
                    ? `feedback.message.${state.code}`
                    : "feedback.message.replyFailed",
                )}
              </p>
            ) : null}
            {state.success ? (
              <p className="text-xs text-[#167e74]">
                {copy(
                  state.code
                    ? `feedback.message.${state.code}`
                    : "feedback.message.replyQueued",
                )}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {copy("common.close")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || Boolean(state.success)}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {pending
                ? copy("feedback.queueing")
                : copy("feedback.queueEmail")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function FeedbackItem({
  feedback,
  locale,
  copy,
}: {
  feedback: FeedbackRow;
  locale: AppLocale;
  copy: OperationsAdminCopy;
}) {
  const [state, action, pending] = useActionState(
    reviewFeedbackAction,
    initialState,
  );
  const completed = feedback.status !== "new";

  return (
    <article className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[#2b3a48]">
            {feedback.firstName} {feedback.lastName}
          </p>
          <Badge tone={completed ? "teal" : "amber"}>
            {completed
              ? copy("feedback.status.completed")
              : copy("feedback.status.open")}
          </Badge>
          {feedback.testimonialConsent ? (
            <Badge tone="blue">{copy("feedback.testimonial")}</Badge>
          ) : null}
          <span className="text-[10px] text-[#8a949d]">
            {formatDateTime(feedback.createdAt, locale)}
          </span>
        </div>
        <div
          className="mt-2 flex flex-wrap items-center gap-1"
          aria-label={copy("feedback.stars", {
            rating: formatOperationsAdminNumber(feedback.rating, locale),
          })}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <Star
              key={value}
              className={`size-3.5 ${
                value <= feedback.rating
                  ? "fill-[#d6a536] text-[#d6a536]"
                  : "text-[#cbd2d7]"
              }`}
            />
          ))}
          <span className="ml-2 text-[10px] text-[#71808b]">
            {feedback.courseTitle ?? copy("feedback.platform")}
            {feedback.lessonTitle ? ` / ${feedback.lessonTitle}` : ""}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#52606d]">
          {feedback.content || copy("feedback.noComment")}
        </p>
        <p className="mt-1 break-all text-[10px] text-[#8a949d]">
          {feedback.email}
        </p>
        <div aria-live="polite">
          {state.error ? (
            <p className="mt-2 text-xs text-[#a94339]">
              {copy(
                state.code
                  ? `feedback.message.${state.code}`
                  : "feedback.message.reviewFailed",
              )}
            </p>
          ) : null}
          {state.success ? (
            <p className="mt-2 text-xs text-[#167e74]">
              {copy(
                state.code
                  ? `feedback.message.${state.code}`
                  : "feedback.message.reviewed",
              )}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2 lg:justify-end">
        <ReplyComposer feedback={feedback} copy={copy} />
        <form action={action}>
          <input type="hidden" name="feedbackId" value={feedback.id} />
          <Button
            type="submit"
            name="status"
            value={completed ? "new" : "reviewed"}
            size="sm"
            variant={completed ? "secondary" : "primary"}
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : completed ? (
              <RotateCcw className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {completed
              ? copy("feedback.reopen")
              : copy("feedback.status.completed")}
          </Button>
        </form>
      </div>
    </article>
  );
}

export function FeedbackCenter({
  feedback,
  locale,
}: {
  feedback: FeedbackRow[];
  locale: AppLocale;
}) {
  const copy = getOperationsAdminCopy(locale);
  const localeTag = intlLocale(locale);
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("all");
  const [userId, setUserId] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortMode>("latest");

  const courses = useMemo(
    () =>
      [...new Map(
        feedback
          .filter((item) => item.courseId && item.courseTitle)
          .map((item) => [item.courseId!, item.courseTitle!]),
      )].sort((left, right) => left[1].localeCompare(right[1], localeTag)),
    [feedback, localeTag],
  );
  const members = useMemo(
    () =>
      [...new Map(
        feedback.map((item) => [
          item.userId,
          `${item.firstName} ${item.lastName}`.trim(),
        ]),
      )].sort((left, right) => left[1].localeCompare(right[1], localeTag)),
    [feedback, localeTag],
  );

  const visibleFeedback = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(localeTag);
    const filtered = feedback.filter((item) => {
      if (courseId !== "all" && item.courseId !== courseId) return false;
      if (userId !== "all" && item.userId !== userId) return false;
      if (status === "open" && item.status !== "new") return false;
      if (status === "completed" && item.status === "new") return false;
      if (!needle) return true;
      return [
        item.content,
        item.firstName,
        item.lastName,
        `${item.firstName} ${item.lastName}`,
        item.email,
        item.courseTitle ?? "",
        item.lessonTitle ?? "",
      ].some((value) => value.toLocaleLowerCase(localeTag).includes(needle));
    });
    return filtered.sort((left, right) => {
      if (sort === "name") {
        return `${left.lastName} ${left.firstName}`.localeCompare(
          `${right.lastName} ${right.firstName}`,
          localeTag,
        );
      }
      if (sort === "rating_asc") return left.rating - right.rating;
      if (sort === "rating_desc") return right.rating - left.rating;
      return right.createdAt.getTime() - left.createdAt.getTime();
    });
  }, [courseId, feedback, localeTag, search, sort, status, userId]);

  const openCount = feedback.filter((item) => item.status === "new").length;

  return (
    <section className="panel overflow-hidden">
      <header className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#fbf6e7] text-[#8d6a12]">
              <MessageSquareQuote className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {copy("feedback.title")}
              </h2>
              <p className="text-[11px] text-[#71808b]">
                {copy("feedback.openCount", {
                  count: formatOperationsAdminNumber(openCount, locale),
                })}
              </p>
            </div>
          </div>
          <Badge tone="neutral">
            {copy("feedback.hitCount", {
              count: formatOperationsAdminNumber(
                visibleFeedback.length,
                locale,
              ),
            })}
          </Badge>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(150px,1fr))]">
          <label className="relative min-w-0">
            <span className="sr-only">{copy("feedback.search")}</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[#8a949d]" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${controlClassName} w-full pl-9`}
              placeholder={copy("feedback.search")}
            />
          </label>
          <label>
            <span className="sr-only">{copy("feedback.filterCourse")}</span>
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className={`${controlClassName} w-full`}
            >
              <option value="all">{copy("feedback.allCourses")}</option>
              {courses.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{copy("feedback.filterMember")}</span>
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className={`${controlClassName} w-full`}
            >
              <option value="all">{copy("feedback.allMembers")}</option>
              {members.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{copy("feedback.filterStatus")}</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className={`${controlClassName} w-full`}
            >
              <option value="all">{copy("feedback.allStatuses")}</option>
              <option value="open">{copy("feedback.status.open")}</option>
              <option value="completed">
                {copy("feedback.status.completed")}
              </option>
            </select>
          </label>
          <label>
            <span className="sr-only">{copy("feedback.sort")}</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              className={`${controlClassName} w-full`}
            >
              <option value="latest">{copy("feedback.sortLatest")}</option>
              <option value="name">{copy("feedback.sortName")}</option>
              <option value="rating_desc">
                {copy("feedback.sortRatingDesc")}
              </option>
              <option value="rating_asc">
                {copy("feedback.sortRatingAsc")}
              </option>
            </select>
          </label>
        </div>
      </header>
      {visibleFeedback.length ? (
        <div className="divide-y divide-[#edf0f2]">
          {visibleFeedback.map((item) => (
            <FeedbackItem
              key={item.id}
              feedback={item}
              locale={locale}
              copy={copy}
            />
          ))}
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-[#71808b]">
          {copy("feedback.empty")}
        </div>
      )}
    </section>
  );
}
