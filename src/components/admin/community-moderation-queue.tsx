"use client";

import {
  Check,
  CircleSlash2,
  LoaderCircle,
  Scale,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  claimCommunityModerationCaseAdminAction,
  decideCommunityModerationCaseAdminAction,
  resolveCommunityModerationAppealAdminAction,
} from "@/lib/community-moderation-case-actions";
import type { CommunityModerationQueueItem } from "@/lib/community-moderation-queue";
import {
  formatCommunityAdminDateTime,
  formatCommunityAdminNumber,
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

type DecisionDialogState = Readonly<{
  item: CommunityModerationQueueItem;
  action: "approve" | "reject" | "uphold" | "overturn";
}>;

function DecisionDialog({
  decision,
  onClose,
  locale,
}: {
  decision: DecisionDialogState;
  onClose: () => void;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const appealAction =
    decision.action === "uphold" || decision.action === "overturn";
  const title = copy.queue.decisionTitles[decision.action];

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="my-4 w-full max-w-lg rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <h2 className="text-lg font-bold text-[#243444]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#344454]">
            {decision.item.authorName}
          </p>
          <p className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[#66737f]">
            {decision.item.contentExcerpt || copy.queue.missingContent}
          </p>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.queue.note}
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              minLength={3}
              maxLength={1000}
              required
              autoFocus
              className="min-h-28 w-full resize-y rounded-md border border-[#dce1e5] p-3 text-sm leading-6 text-[#2b3a48] outline-none focus:border-[#2b9188] focus:ring-2 focus:ring-[#2b9188]/15"
            />
          </label>
          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[#edf0f2] pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {copy.common.cancel}
            </Button>
            <Button
              variant={decision.action === "reject" ? "danger" : "primary"}
              disabled={pending || note.trim().length < 3}
              onClick={() =>
                startTransition(async () => {
                  const result = appealAction
                    ? await resolveCommunityModerationAppealAdminAction({
                        appealId: decision.item.appeal!.id,
                        action: decision.action,
                        expectedDecisionVersion:
                          decision.item.decisionVersion,
                        expectedContentVersion: decision.item.contentVersion,
                        note,
                      })
                    : await decideCommunityModerationCaseAdminAction({
                        caseId: decision.item.id,
                        action: decision.action,
                        expectedDecisionVersion:
                          decision.item.decisionVersion,
                        expectedContentVersion: decision.item.contentVersion,
                        note,
                      });
                  if (!result.ok) {
                    toast.error(localizeCommunityAdminAction(locale, result));
                    return;
                  }
                  toast.success(localizeCommunityAdminAction(locale, result));
                  onClose();
                  router.refresh();
                })
              }
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : decision.action === "reject" ? (
                <CircleSlash2 className="size-4" />
              ) : appealAction ? (
                <Scale className="size-4" />
              ) : (
                <Check className="size-4" />
              )}
              {copy.queue.saveDecision}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommunityModerationQueue({
  items,
  currentAdminId,
  locale,
}: {
  items: readonly CommunityModerationQueueItem[];
  currentAdminId: string;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const reasonLabels = copy.queue.reasons;
  const stateLabels = copy.queue.states;
  const router = useRouter();
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionDialogState | null>(null);

  return (
    <section
      className="panel min-w-0 overflow-hidden"
      aria-labelledby="community-case-queue-heading"
    >
      <header className="flex items-center gap-2 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <ShieldCheck className="size-4 text-[#b84e42]" />
        <h2
          id="community-case-queue-heading"
          className="text-sm font-bold text-[#243444]"
        >
          {copy.queue.heading}
        </h2>
        <Badge tone={items.length ? "coral" : "neutral"} className="ml-auto">
          {copy.queue.openCount(formatCommunityAdminNumber(items.length, locale))}
        </Badge>
      </header>
      {items.length ? (
        <div className="divide-y divide-[#e8ebee]">
          {items.map((item) => {
            const claimedByMe = item.claimedById === currentAdminId;
            return (
              <article
                id={`moderation-case-${item.id}`}
                key={item.id}
                className="min-w-0 p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-[#2b3a48]">
                        {item.authorName}
                      </p>
                      <Badge tone="neutral">{reasonLabels[item.reason]}</Badge>
                      {item.contentState ? (
                        <Badge
                          tone={
                            item.contentState === "published"
                              ? "teal"
                              : item.contentState === "rejected"
                                ? "coral"
                                : "amber"
                          }
                        >
                          {stateLabels[item.contentState]}
                        </Badge>
                      ) : null}
                      {item.appeal ? <Badge tone="blue">{copy.queue.appeal}</Badge> : null}
                    </div>
                    <p className="mt-1 text-[10px] text-[#7a8690]">
                      {item.spaceTitle} - {formatCommunityAdminDateTime(
                        item.createdAt,
                        locale,
                        PLATFORM_TIME_ZONE,
                      )}
                      {item.reportCount
                        ? ` - ${copy.queue.reportCount(formatCommunityAdminNumber(item.reportCount, locale))}`
                        : ""}
                    </p>
                    {item.targetTitle ? (
                      <p className="mt-3 text-xs font-semibold text-[#455463]">
                        {item.targetTitle}
                      </p>
                    ) : null}
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[#66737f]">
                      {item.contentExcerpt || copy.queue.missingContent}
                    </p>
                    {item.appeal ? (
                      <div className="mt-3 border-l-2 border-[#4f7cac] pl-3">
                        <p className="text-[10px] font-bold uppercase text-[#365f8d]">
                          {copy.queue.authorAppeal}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#536b84]">
                          {item.appeal.statement}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                    {!item.claimedById ? (
                      <Button
                        variant="secondary"
                        disabled={pendingCaseId === item.id}
                        onClick={async () => {
                          setPendingCaseId(item.id);
                          const result =
                            await claimCommunityModerationCaseAdminAction(
                              item.id,
                              item.decisionVersion,
                              item.contentVersion,
                            );
                          setPendingCaseId(null);
                          if (result.ok) {
                             toast.success(localizeCommunityAdminAction(locale, result));
                          } else {
                             toast.error(localizeCommunityAdminAction(locale, result));
                          }
                          if (result.ok) router.refresh();
                        }}
                      >
                        {pendingCaseId === item.id ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <UserCheck className="size-4" />
                        )}
                        {copy.queue.claim}
                      </Button>
                    ) : (
                      <Badge tone="teal">{claimedByMe ? copy.queue.claimedByYou : copy.queue.inReview}</Badge>
                    )}
                    {item.appeal ? (
                      <>
                        <Button
                          variant="secondary"
                          disabled={item.targetMissing}
                          onClick={() =>
                            setDecision({ item, action: "uphold" })
                          }
                        >
                          <Scale className="size-4" />
                          {copy.queue.uphold}
                        </Button>
                        <Button
                          disabled={item.targetMissing}
                          onClick={() =>
                            setDecision({ item, action: "overturn" })
                          }
                        >
                          <Check className="size-4" />
                          {copy.queue.overturn}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          disabled={item.targetMissing}
                          onClick={() =>
                            setDecision({ item, action: "approve" })
                          }
                        >
                          <Check className="size-4" />
                          {copy.queue.approve}
                        </Button>
                        <Button
                          variant="danger"
                          disabled={item.targetMissing}
                          onClick={() =>
                            setDecision({ item, action: "reject" })
                          }
                        >
                          <CircleSlash2 className="size-4" />
                          {copy.queue.reject}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[#71808b]">
          {copy.queue.empty}
        </p>
      )}
      {decision ? (
        <DecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
          locale={locale}
        />
      ) : null}
    </section>
  );
}
