"use client";

import { Check, Clock3, LoaderCircle, Send, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AiAgentActionView } from "@/components/academy/use-ai-conversations";
import {
  getAiMemberCopy,
  type AiMemberCopy,
} from "@/lib/i18n/ai-member";
import type { AppLocale } from "@/lib/i18n/model";

function completedLabel(item: AiAgentActionView, copy: AiMemberCopy) {
  if (item.state === "granted") {
    return item.actionType === "course_enrollment"
      ? copy.actions.courseActive
      : copy.actions.assignmentActive;
  }
  return item.actionType === "course_unenrollment"
    ? copy.actions.courseRemoved
    : copy.actions.assignmentRemoved;
}

export function AiAgentActionList({
  locale,
  actions,
  pendingActionId,
  onRequest,
  onCancel,
  compact = false,
}: {
  locale: AppLocale;
  actions: AiAgentActionView[];
  pendingActionId: string | null;
  onRequest: (actionConfigurationId: string) => Promise<boolean>;
  onCancel: (requestId: string, expectedRevision: number) => Promise<boolean>;
  compact?: boolean;
}) {
  const copy = getAiMemberCopy(locale);
  if (!actions.length) return null;
  return (
    <section
      className="border-t border-[#e0e6e9] bg-[#f8fafb] px-3 py-3 sm:px-4"
      aria-label={copy.actions.aria}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase text-[#52606d]">
          {copy.actions.title}
        </h3>
        <Badge tone="neutral">{copy.actions.approval}</Badge>
      </div>
      <div className="divide-y divide-[#e3e9ec] border-y border-[#e3e9ec]">
        {actions.map((item) => {
          const busy =
            pendingActionId === item.id || pendingActionId === item.request?.id;
          return (
            <div
              key={item.id}
              className={`flex min-w-0 flex-col gap-2 py-2.5 ${compact ? "text-xs" : "sm:flex-row sm:items-center sm:justify-between"}`}
            >
              <div className="min-w-0">
                <p className="break-words text-xs font-semibold text-[#354555]">
                  {item.label}
                </p>
                <p className="mt-0.5 break-words text-[10px] leading-4 text-[#71808b]">
                  {item.description}
                </p>
                <p className="mt-1 break-words text-[10px] font-semibold text-[#52606d]">
                  {copy.actions.target}: {item.targetLabel}
                </p>
              </div>
              {item.state === "available" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(pendingActionId)}
                  onClick={() => void onRequest(item.id)}
                >
                  {busy ? (
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Send aria-hidden="true" className="size-3.5" />
                  )}
                  {copy.actions.request}
                </Button>
              ) : item.state === "pending" && item.request ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone="amber">
                    <Clock3 aria-hidden="true" className="mr-1 size-3" />
                    {copy.actions.pending}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={Boolean(pendingActionId)}
                    onClick={() =>
                      void onCancel(item.request!.id, item.request!.revision)
                    }
                    aria-label={copy.actions.cancelNamed(item.label)}
                    title={copy.actions.cancel}
                  >
                    {busy ? (
                      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <X aria-hidden="true" className="size-3.5" />
                    )}
                  </Button>
                </div>
              ) : (
                <Badge tone="teal">
                  <Check aria-hidden="true" className="mr-1 size-3" />
                  {completedLabel(item, copy)}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
