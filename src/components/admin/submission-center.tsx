"use client";

import { useActionState, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  FileText,
  History,
  LoaderCircle,
  Search,
  Send,
  UserRoundCheck,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import {
  SubmissionAttachmentLinks,
  type SubmissionAttachmentView,
} from "@/components/academy/submission-attachment-uploader";
import {
  SubmissionReviewAnnotations,
  type SubmissionReviewAnnotationView,
} from "@/components/academy/submission-review-annotations";
import { SubmissionAnnotationComposer } from "@/components/admin/submission-annotation-composer";
import { SubmissionAnswerContent } from "@/components/content/submission-answer-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewSubmissionAction, type ActionState } from "@/lib/actions";
import { cn, formatDateTime } from "@/lib/utils";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  formatSubmissionReviewScore,
  formatSubmissionReviewTime,
  getSubmissionReviewCopy,
  resolveSubmissionReviewMessage,
} from "@/lib/i18n/submission-review";

type SubmissionReviewRow = {
  id: string;
  submissionId: string;
  reviewerId: string | null;
  reviewerName: string | null;
  decision: "revision" | "approved";
  feedback: string;
  score: number;
  reviewedAt: Date;
  annotations: SubmissionReviewAnnotationView[];
};

type SubmissionRow = {
  id: string;
  userId: string;
  courseId: string;
  lessonId: string | null;
  blockId: string | null;
  attemptNumber: number;
  supersedesId: string | null;
  title: string;
  type: string;
  content: string | null;
  contentFormat: "plain_text" | "rich_text";
  richText: unknown;
  contentProjectionVersion: number;
  status: "open" | "in_review" | "revision" | "approved";
  score: number | null;
  feedback: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  firstName: string;
  lastName: string;
  email: string;
  courseTitle: string;
  attachments: SubmissionAttachmentView[];
  reviews: SubmissionReviewRow[];
};

const initialState: ActionState = {};

function threadKey(submission: SubmissionRow) {
  if (!submission.lessonId || !submission.blockId) return submission.id;
  return [
    submission.userId,
    submission.courseId,
    submission.lessonId,
    submission.blockId,
  ].join(":");
}

function statusTone(status: SubmissionRow["status"]) {
  if (status === "approved") return "teal" as const;
  if (status === "revision") return "coral" as const;
  if (status === "in_review") return "blue" as const;
  return "amber" as const;
}

export function SubmissionCenter({
  submissions,
  locale,
}: {
  submissions: SubmissionRow[];
  locale: AppLocale;
}) {
  const copy = getSubmissionReviewCopy(locale).center;
  const latestSubmissions = useMemo(() => {
    const latestByThread = new Map<string, SubmissionRow>();
    for (const submission of submissions) {
      const key = threadKey(submission);
      const current = latestByThread.get(key);
      if (
        !current ||
        submission.attemptNumber > current.attemptNumber ||
        (submission.attemptNumber === current.attemptNumber &&
          submission.submittedAt > current.submittedAt)
      ) {
        latestByThread.set(key, submission);
      }
    }
    return [...latestByThread.values()].sort(
      (left, right) => right.submittedAt.getTime() - left.submittedAt.getTime(),
    );
  }, [submissions]);
  const [selectedId, setSelectedId] = useState(latestSubmissions[0]?.id ?? "");
  const [filter, setFilter] = useState<"all" | SubmissionRow["status"]>("all");
  const [search, setSearch] = useState("");
  const [state, action, pending] = useActionState(
    reviewSubmissionAction,
    initialState,
  );

  const filtered = useMemo(
    () =>
      latestSubmissions.filter(
        (item) =>
          (filter === "all" || item.status === filter) &&
          `${item.title} ${item.firstName} ${item.lastName} ${item.courseTitle}`
            .toLocaleLowerCase(intlLocale(locale))
            .includes(search.toLocaleLowerCase(intlLocale(locale))),
      ),
    [filter, latestSubmissions, locale, search],
  );
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const attempts = selected
    ? submissions
        .filter((submission) => threadKey(submission) === threadKey(selected))
        .sort(
          (left, right) =>
            right.attemptNumber - left.attemptNumber ||
            right.submittedAt.getTime() - left.submittedAt.getTime(),
        )
    : [];
  const reviewable =
    selected?.status === "open" || selected?.status === "in_review";
  const reviewFormId = selected ? `submission-review-${selected.id}` : undefined;

  return (
    <div className="panel grid min-h-[650px] overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
      <section className="border-b border-[#e5e8eb] lg:border-b-0 lg:border-r">
        <div className="border-b border-[#e8ebee] p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-[#f8f9fa] pl-9 pr-3 text-sm"
              placeholder={copy.search}
            />
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {(["all", "open", "in_review", "revision", "approved"] as const).map(
              (value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "focus-ring shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                    filter === value
                      ? "border-[#17324d] bg-[#17324d] text-white"
                      : "border-[#dfe4e8] text-[#66727f] hover:bg-[#f2f4f5]",
                  )}
                >
                  {value === "all" ? copy.all : copy.statuses[value]}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto p-2">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={cn(
                "focus-ring mb-1 flex w-full gap-3 rounded-md p-3 text-left",
                selected?.id === item.id ? "bg-[#edf6f5]" : "hover:bg-[#f5f7f8]",
              )}
            >
              <Avatar firstName={item.firstName} lastName={item.lastName} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <strong className="line-clamp-1 text-xs text-[#2b3a48]">
                    {item.title}
                  </strong>
                  <span className="shrink-0 text-[9px] text-[#8a949d]">
                    {formatSubmissionReviewTime(locale, item.submittedAt)}
                  </span>
                </span>
                <span className="mt-1 block truncate text-[10px] text-[#6f7b85]">
                  {item.firstName} {item.lastName} | {item.courseTitle}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(item.status)}>
                    {copy.statuses[item.status]}
                  </Badge>
                  <span className="text-[9px] font-semibold text-[#7b8791]">
                    {copy.attempt(item.attemptNumber)}
                  </span>
                </span>
              </span>
            </button>
          ))}
          {!filtered.length ? (
            <p className="p-8 text-center text-xs text-[#7a8690]">
              {copy.noMatches}
            </p>
          ) : null}
        </div>
      </section>

      {selected ? (
        <section className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(selected.status)}>
                  {copy.statuses[selected.status]}
                </Badge>
                <span className="text-[10px] text-[#7b8791]">
                  {copy.attemptSubmitted(
                    selected.attemptNumber,
                    formatDateTime(selected.submittedAt, locale),
                  )}
                </span>
              </div>
              <h2 className="mt-2 break-words text-xl font-bold text-[#243444] [overflow-wrap:anywhere]">
                {selected.title}
              </h2>
              <p className="mt-1 text-xs text-[#66727f]">{selected.courseTitle}</p>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-[#f5f7f8] px-3 py-2">
              <Avatar
                firstName={selected.firstName}
                lastName={selected.lastName}
                size="sm"
              />
              <div>
                <p className="text-xs font-semibold text-[#354555]">
                  {selected.firstName} {selected.lastName}
                </p>
                <p className="text-[10px] text-[#7b8791]">{selected.email}</p>
              </div>
            </div>
          </div>

          {state.error ? (
            <p className="mx-5 mt-5 rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]">
              {resolveSubmissionReviewMessage(locale, state.messageCode)}
            </p>
          ) : null}
          {state.success ? (
            <p className="mx-5 mt-5 rounded-md bg-[#e9f8f6] p-3 text-xs text-[#167e74]">
              {resolveSubmissionReviewMessage(locale, state.messageCode)}
            </p>
          ) : null}

          <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0 space-y-6">
              <section>
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase text-[#66727f]">
                  <FileText className="size-4" />
                  {copy.currentAnswer}
                </h3>
                <div className="mt-3">
                  {reviewable ? (
                    <SubmissionAnnotationComposer
                      key={selected.id}
                      content={selected.content}
                      contentFormat={selected.contentFormat}
                      richText={selected.richText}
                      attachments={selected.attachments}
                      formId={reviewFormId!}
                      disabled={pending}
                      locale={locale}
                    />
                  ) : (
                    <>
                      <div className="min-h-48 rounded-md border border-[#e1e5e8] bg-[#fafbfb] p-4">
                        <SubmissionAnswerContent
                          emptyLabel={copy.noText}
                          content={selected.content}
                          contentFormat={selected.contentFormat}
                          richText={selected.richText}
                        />
                      </div>
                      <SubmissionAttachmentLinks
                        attachments={selected.attachments}
                        locale={locale}
                      />
                    </>
                  )}
                </div>
              </section>

              <section>
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase text-[#66727f]">
                  <History className="size-4" />
                  {copy.history(attempts.length)}
                </h3>
                <div className="mt-3 divide-y divide-[#e1e5e8] border-y border-[#e1e5e8]">
                  {attempts.map((attempt) => {
                    const review = attempt.reviews[0];
                    return (
                      <article key={attempt.id} className="py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <strong className="text-sm text-[#243444]">
                              {copy.attempt(attempt.attemptNumber)}
                            </strong>
                            <Badge tone={statusTone(attempt.status)}>
                              {copy.statuses[attempt.status]}
                            </Badge>
                          </div>
                          <span className="text-[10px] text-[#7b8791]">
                            {formatDateTime(attempt.submittedAt, locale)}
                          </span>
                        </div>
                        <SubmissionAnswerContent
                          emptyLabel={copy.noText}
                          content={attempt.content}
                          contentFormat={attempt.contentFormat}
                          richText={attempt.richText}
                          className="mt-2 text-xs leading-5"
                        />
                        <SubmissionAttachmentLinks attachments={attempt.attachments} locale={locale} />
                        {review ? (
                          <div className="mt-3 border-l-4 border-[#2b9188] bg-[#f2faf9] px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase text-[#176f68]">
                              {review.decision === "approved"
                                ? copy.approvedDecision
                                : copy.revisionDecision}{" "}
                              {formatSubmissionReviewScore(locale, review.score)}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-[#52606d]">
                              {review.feedback}
                            </p>
                            <SubmissionReviewAnnotations
                              locale={locale}
                              annotations={review.annotations}
                              content={attempt.content}
                              attachments={attempt.attachments}
                            />
                            <p className="mt-1 text-[9px] text-[#7b8791]">
                              {review.reviewerName ?? copy.staffAccount} | {formatDateTime(review.reviewedAt, locale)}
                            </p>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>

            {reviewable ? (
              <form
                key={selected.id}
                id={reviewFormId}
                action={action}
                className="h-fit rounded-md border border-[#dfe4e8] p-4"
              >
                <input type="hidden" name="submissionId" value={selected.id} />
                <div className="flex items-center gap-2 border-b border-[#edf0f2] pb-3">
                  <UserRoundCheck className="size-4 text-[#2b9188]" />
                  <h3 className="text-sm font-bold text-[#243444]">
                    {copy.trainerReview}
                  </h3>
                </div>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                    {copy.result}
                  </span>
                  <select
                    name="status"
                    defaultValue="approved"
                    className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
                  >
                    <option value="approved">{copy.approve}</option>
                    <option value="revision">{copy.requestRevision}</option>
                  </select>
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                    {copy.points}
                  </span>
                  <input
                    name="score"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue="85"
                    className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                    required
                  />
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                    {copy.feedback}
                  </span>
                  <textarea
                    name="feedback"
                    className="focus-ring min-h-32 w-full rounded-md border border-[#dce1e5] p-3 text-sm"
                    placeholder={copy.feedbackPlaceholder}
                    required
                  />
                </label>
                <Button type="submit" className="mt-4 w-full" disabled={pending}>
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {pending ? copy.saving : copy.saveReview}
                </Button>
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-[#8a949d]">
                  <Clock3 className="size-3" />
                  {copy.immutable}
                </div>
              </form>
            ) : (
              <aside className="h-fit rounded-md border border-[#dfe4e8] p-4">
                <div className="flex items-center gap-2">
                  {selected.status === "approved" ? (
                    <CheckCircle2 className="size-5 text-[#2b9188]" />
                  ) : (
                    <Clock3 className="size-5 text-[#b84e42]" />
                  )}
                  <h3 className="text-sm font-bold text-[#243444]">
                    {selected.status === "approved"
                      ? copy.approvedAttempt
                      : copy.waitingRevision}
                  </h3>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#66727f]">
                  {copy.historyRetained}
                </p>
              </aside>
            )}
          </div>
        </section>
      ) : (
        <div className="grid place-items-center p-8 text-sm text-[#7a8690]">
          {copy.selectSubmission}
        </div>
      )}
    </div>
  );
}
