"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LoaderCircle,
  MessageSquareText,
  Scale,
  Send,
  X,
} from "lucide-react";
import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createOwnCommunityModerationAppealAction,
  type CommunityModerationAppealActionState,
} from "@/lib/community-moderation-appeal-actions";
import type {
  CommunityOwnModerationStatus,
  CommunityOwnModerationSubmission,
} from "@/lib/community-moderation-submissions-core";
import { resolveCommunityActionMessage } from "@/lib/i18n/community-actions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import { formatDate } from "@/lib/utils";

const initialAppealState: CommunityModerationAppealActionState = {
  ok: null,
  message: "",
};

const statusTones: Record<
  CommunityOwnModerationStatus,
  "neutral" | "teal" | "amber" | "blue" | "coral"
> = {
  awaiting_review: "amber",
  in_review: "blue",
  appeal_pending: "blue",
  published: "teal",
  held: "amber",
  rejected: "coral",
  appeal_upheld: "coral",
  appeal_accepted: "teal",
  unavailable: "neutral",
};

function AppealForm({
  submission,
  locale,
  onCancel,
}: {
  submission: CommunityOwnModerationSubmission;
  locale: AppLocale;
  onCancel: () => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const action = createOwnCommunityModerationAppealAction.bind(
    null,
    submission.caseId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    initialAppealState,
  );
  const [statement, setStatement] = useState("");
  const inputId = `community-appeal-${submission.caseId}`;

  return (
    <form
      action={formAction}
      className="mt-4 min-w-0 border-t border-[#e8ebee] pt-4"
    >
      <label htmlFor={inputId} className="block">
        <span className="text-xs font-semibold text-[#455463]">
          {copy.submissions.appealStatement}
        </span>
        <textarea
          id={inputId}
          name="statement"
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          minLength={3}
          maxLength={2000}
          required
          autoFocus
          disabled={pending}
          className="focus-ring mt-2 min-h-28 w-full min-w-0 resize-y rounded-md border border-[#dce1e5] p-3 text-sm leading-6 text-[#2b3a48] disabled:bg-[#f4f6f7]"
        />
      </label>
      <div className="mt-1 flex justify-end text-[10px] text-[#7a8690]">
        {statement.length}/2000
      </div>
      {state.ok === false ? (
        <p
          role="alert"
          className="mt-3 break-words rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2.5 text-xs leading-5 text-[#a94339] [overflow-wrap:anywhere]"
        >
          {resolveCommunityActionMessage(locale, state, "appealFailed")}
        </p>
      ) : null}
      <div className="mt-4 flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onCancel}
          className="w-full min-w-0 sm:w-auto"
        >
          <X className="size-4" />
          {copy.common.cancel}
        </Button>
        <Button
          type="submit"
          disabled={pending || statement.trim().length < 3}
          className="w-full min-w-0 sm:w-auto"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {pending ? copy.submissions.sending : copy.submissions.sendAppeal}
        </Button>
      </div>
    </form>
  );
}

function SubmissionItem({
  submission,
  locale,
}: {
  submission: CommunityOwnModerationSubmission;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [showAppealForm, setShowAppealForm] = useState(false);
  const title =
    submission.targetTitle ??
    (submission.targetType === "post"
      ? copy.submissions.postFallback
      : copy.submissions.answerFallback);
  const TargetIcon =
    submission.targetType === "post" ? FileCheck2 : MessageSquareText;

  return (
    <article
      id={`own-community-submission-${submission.caseId}`}
      className="min-w-0 px-4 py-4 sm:px-5"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TargetIcon className="size-4 shrink-0 text-[#2b9188]" />
            <h3 className="min-w-0 break-words text-sm font-bold text-[#2b3a48] [overflow-wrap:anywhere]">
              {title}
            </h3>
            <Badge tone={statusTones[submission.status]}>
              {copy.submissions.status[submission.status]}
            </Badge>
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-[#7a8690] [overflow-wrap:anywhere]">
            {submission.spaceTitle} -{" "}
            {copy.submissions.submittedOn(
              formatDate(submission.submittedAt, { dateStyle: "medium" }, locale),
            )}
          </p>
        </div>
        {submission.canAppeal && !showAppealForm ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAppealForm(true)}
            className="w-full min-w-0 sm:w-auto"
          >
            <Scale className="size-4" />
            {copy.submissions.appeal}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 min-w-0 border-l-2 border-[#d8e5e3] pl-3">
        <p className="break-words text-xs font-semibold text-[#455463] [overflow-wrap:anywhere]">
          {copy.submissions.reasons[submission.reason]}
        </p>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-[#66737f] [overflow-wrap:anywhere]">
          {submission.excerpt || copy.submissions.unavailableContent}
        </p>
      </div>

      {submission.appealDeadline ? (
        <p className="mt-3 flex min-w-0 items-start gap-2 break-words text-[11px] leading-5 text-[#66737f] [overflow-wrap:anywhere]">
          <Clock3 className="mt-0.5 size-3.5 shrink-0 text-[#8d6a12]" />
          {copy.submissions.deadline(
            formatDate(
              submission.appealDeadline,
              { dateStyle: "medium" },
              locale,
            ),
          )}
        </p>
      ) : null}

      {submission.appeal ? (
        <p className="mt-3 flex min-w-0 items-start gap-2 break-words text-[11px] leading-5 text-[#536b84] [overflow-wrap:anywhere]">
          {submission.appeal.status === "pending" ? (
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          )}
          {submission.appeal.status === "pending"
            ? copy.submissions.appealSubmitted(
                formatDate(
                  submission.appeal.submittedAt,
                  { dateStyle: "medium" },
                  locale,
                ),
              )
            : submission.appeal.status === "accepted"
              ? copy.submissions.appealAccepted
              : copy.submissions.decisionConfirmed}
        </p>
      ) : null}

      {submission.canAppeal && showAppealForm ? (
        <AppealForm
          submission={submission}
          locale={locale}
          onCancel={() => setShowAppealForm(false)}
        />
      ) : null}
    </article>
  );
}

export function CommunityOwnSubmissions({
  submissions,
  locale,
}: {
  submissions: readonly CommunityOwnModerationSubmission[];
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  return (
    <section
      className="panel min-w-0 overflow-hidden"
      aria-labelledby="own-community-submissions-heading"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <FileCheck2 className="size-4 shrink-0 text-[#2b9188]" />
        <h2
          id="own-community-submissions-heading"
          className="min-w-0 text-sm font-bold text-[#243444]"
        >
          {copy.submissions.title}
        </h2>
        <Badge tone="neutral" className="ml-auto">
          {submissions.length}
        </Badge>
      </header>
      {submissions.length ? (
        <div className="min-w-0 divide-y divide-[#e8ebee]">
          {submissions.map((submission) => (
            <SubmissionItem
              key={submission.caseId}
              submission={submission}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs leading-5 text-[#71808b] sm:px-5">
          {copy.submissions.empty}
        </p>
      )}
    </section>
  );
}
