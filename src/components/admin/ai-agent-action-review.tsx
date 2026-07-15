"use client";

import {
  Check,
  Clock3,
  GraduationCap,
  LoaderCircle,
  Package,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  decideAiAgentActionAdminAction,
  type AiAgentActionDecisionState,
} from "@/lib/admin/ai-agent-action-actions";
import {
  formatAiAdminDateTime,
  getAiAdminCopy,
  localizeAiAdminMessage,
} from "@/lib/i18n/ai-admin";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

export type AiAgentActionReviewRow = {
  request: {
    id: string;
    actionType:
      | "course_enrollment"
      | "course_unenrollment"
      | "group_membership_add"
      | "group_membership_remove"
      | "bundle_assignment_add"
      | "bundle_assignment_remove";
    targetType: "course" | "group" | "bundle";
    status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
    revision: number;
    labelSnapshot: string;
    decisionNote: string | null;
    requestedAt: Date;
    expiresAt: Date;
    decidedAt: Date | null;
  };
  memberFirstName: string;
  memberLastName: string;
  memberEmail: string;
  agentName: string;
  agentVersion: number;
  courseTitle: string | null;
  groupName: string | null;
  bundleName: string | null;
};

const initialState: AiAgentActionDecisionState = { ok: null, message: "" };

function isAssignmentAction(
  actionType: AiAgentActionReviewRow["request"]["actionType"],
) {
  return [
    "course_enrollment",
    "group_membership_add",
    "bundle_assignment_add",
  ].includes(actionType);
}

function targetLabel(row: AiAgentActionReviewRow) {
  return row.request.targetType === "course"
    ? row.courseTitle
    : row.request.targetType === "group"
      ? row.groupName
      : row.bundleName;
}

function DecisionForm({
  locale,
  row,
}: {
  locale: AppLocale;
  row: AiAgentActionReviewRow;
}) {
  const copy = getAiAdminCopy(locale);
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [state, action, pending] = useActionState(
    decideAiAgentActionAdminAction,
    initialState,
  );
  const hydrated = useHydrated();
  const feedbackMessage = localizeAiAdminMessage(locale, state);

  useEffect(() => {
    if (state.ok === true) {
      toast.success(feedbackMessage);
      router.refresh();
    } else if (state.ok === false) {
      toast.error(feedbackMessage);
    }
  }, [feedbackMessage, router, state.ok]);

  if (!mode) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          disabled={!hydrated}
          onClick={() => setMode("approve")}
        >
          <Check aria-hidden="true" className="size-3.5" />
          {copy.review.approve}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!hydrated}
          onClick={() => setMode("reject")}
        >
          <X aria-hidden="true" className="size-3.5" />
          {copy.review.reject}
        </Button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="grid w-full gap-3 border-t border-[#e5eaed] pt-3"
    >
      <input type="hidden" name="requestId" value={row.request.id} />
      <input
        type="hidden"
        name="expectedRevision"
        value={row.request.revision}
      />
      <input type="hidden" name="decision" value={mode} />
      {mode === "reject" ? (
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.review.reason}
          </span>
          <textarea
            name="note"
            required
            maxLength={1000}
            rows={3}
            className="focus-ring w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#2b3a48]"
          />
        </label>
      ) : (
        <p className="text-xs leading-5 text-[#536675]">
          {row.request.actionType === "course_enrollment"
            ? copy.review.approveEnrollment
            : row.request.actionType === "course_unenrollment"
              ? copy.review.approveUnenrollment
              : isAssignmentAction(row.request.actionType)
                ? copy.review.approveAssignment
                : copy.review.approveRemoval}
        </p>
      )}
      <label className="flex items-start gap-2 text-xs leading-5 text-[#52606d]">
        <input
          type="checkbox"
          name="confirmed"
          value="yes"
          required
          className="mt-0.5 size-4 accent-[#2b9188]"
        />
        <span>
          {mode === "approve"
            ? isAssignmentAction(row.request.actionType)
              ? copy.review.confirmAssignment
              : copy.review.confirmRemoval
            : copy.review.confirmReason}
        </span>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setMode(null)}
        >
          {copy.common.cancel}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant={mode === "approve" ? "primary" : "danger"}
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
          ) : mode === "approve" ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <X aria-hidden="true" className="size-3.5" />
          )}
          {copy.review.saveDecision}
        </Button>
      </div>
      {state.ok === false ? (
        <p className="text-xs text-[#a74439]" role="alert">
          {feedbackMessage}
        </p>
      ) : null}
    </form>
  );
}

function ReviewRow({
  locale,
  row,
  actionable,
}: {
  locale: AppLocale;
  row: AiAgentActionReviewRow;
  actionable: boolean;
}) {
  const copy = getAiAdminCopy(locale);
  return (
    <article className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-bold text-[#2b3a48]">
              {row.request.labelSnapshot}
            </h3>
            <Badge
              tone={
                row.request.status === "pending"
                  ? "amber"
                  : row.request.status === "approved"
                    ? "teal"
                    : "neutral"
              }
            >
              {copy.review.statuses[row.request.status]}
            </Badge>
          </div>
          <p className="mt-1 break-words text-xs text-[#52606d]">
            {row.memberFirstName} {row.memberLastName} ({row.memberEmail})
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#71808b]">
            <span className="flex items-center gap-1.5">
              {row.request.targetType === "course" ? (
                <GraduationCap aria-hidden="true" className="size-3.5" />
              ) : row.request.targetType === "group" ? (
                <Users aria-hidden="true" className="size-3.5" />
              ) : (
                <Package aria-hidden="true" className="size-3.5" />
              )}
              {targetLabel(row) ?? copy.review.missingTarget}
            </span>
            <span>
              {copy.review.agentVersion(row.agentName, row.agentVersion)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 aria-hidden="true" className="size-3.5" />
              {formatAiAdminDateTime(row.request.requestedAt, locale)}
            </span>
          </div>
          {row.request.decisionNote ? (
            <p className="mt-2 text-xs leading-5 text-[#52606d]">
              {copy.review.decisionReason(row.request.decisionNote)}
            </p>
          ) : null}
        </div>
        {actionable ? <DecisionForm locale={locale} row={row} /> : null}
      </div>
    </article>
  );
}

export function AiAgentActionReview({
  locale,
  rows,
}: {
  locale: AppLocale;
  rows: AiAgentActionReviewRow[];
}) {
  const copy = getAiAdminCopy(locale);
  const pending = rows.filter((row) => row.request.status === "pending");
  const history = rows
    .filter((row) => row.request.status !== "pending")
    .slice(0, 8);
  return (
    <section
      className="border-y border-[#dce3e7] bg-white py-5"
      aria-labelledby="agent-action-review-title"
    >
      <div className="mb-4 flex flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2
            id="agent-action-review-title"
            className="flex items-center gap-2 text-sm font-bold text-[#243444]"
          >
            <ShieldCheck aria-hidden="true" className="size-4 text-[#2b9188]" />
            {copy.review.title}
          </h2>
          <p className="mt-1 text-xs text-[#71808b]">
            {copy.review.description}
          </p>
        </div>
        <Badge tone={pending.length ? "amber" : "teal"}>
          {copy.review.pendingCount(pending.length)}
        </Badge>
      </div>

      <div className="divide-y divide-[#e7ecef] px-4 sm:px-5">
        {pending.map((row) => (
          <ReviewRow
            key={row.request.id}
            locale={locale}
            row={row}
            actionable
          />
        ))}
        {!pending.length ? (
          <p className="py-5 text-sm text-[#71808b]">{copy.review.empty}</p>
        ) : null}
      </div>

      {history.length ? (
        <div className="mt-5 border-t border-[#e7ecef] px-4 pt-4 sm:px-5">
          <h3 className="mb-3 text-xs font-bold uppercase text-[#52606d]">
            {copy.review.recent}
          </h3>
          <div className="divide-y divide-[#e7ecef]">
            {history.map((row) => (
              <ReviewRow
                key={row.request.id}
                locale={locale}
                row={row}
                actionable={false}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
