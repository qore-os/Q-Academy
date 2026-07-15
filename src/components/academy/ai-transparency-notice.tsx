"use client";

import { useId } from "react";
import { ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiTransparencyState } from "@/components/academy/use-ai-conversations";
import { getAiMemberCopy } from "@/lib/i18n/ai-member";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

export function AiTransparencyNotice({
  locale,
  state,
  pending,
  onAcknowledge,
  compact = false,
  className,
}: {
  locale: AppLocale;
  state: AiTransparencyState;
  pending: boolean;
  onAcknowledge: () => void;
  compact?: boolean;
  className?: string;
}) {
  const copy = getAiMemberCopy(locale);
  const titleId = useId();
  if (!state.required) return null;
  const { notice } = state;
  return (
    <section
      className={cn(
        "flex flex-col justify-center bg-[#f5f7f8]",
        compact ? "min-h-0 px-4 py-5" : "min-h-72 px-5 py-8 sm:px-8",
        className,
      )}
      aria-labelledby={titleId}
    >
      <div className={cn("mx-auto w-full", compact ? "max-w-sm" : "max-w-xl")}>
        <span className="grid size-10 place-items-center rounded-md bg-[#e5f5f2] text-[#16796f]">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </span>
        <h3
          id={titleId}
          className={cn(
            "mt-4 font-bold text-[#243444]",
            compact ? "text-sm" : "text-lg",
          )}
        >
          {notice.title}
        </h3>
        <p className="mt-2 text-xs leading-5 text-[#526673]">
          {notice.description}
        </p>
        <p className="mt-3 border-l-2 border-[#d7a438] pl-3 text-xs leading-5 text-[#526673]">
          {notice.warning}
        </p>
        {notice.privacyPolicyUrl || notice.transparencyPolicyUrl ? (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#315f83]">
            {notice.privacyPolicyUrl ? (
              <a
                href={notice.privacyPolicyUrl}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex items-center gap-1 hover:underline"
              >
                {copy.transparency.privacy}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : null}
            {notice.transparencyPolicyUrl ? (
              <a
                href={notice.transparencyPolicyUrl}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex items-center gap-1 hover:underline"
              >
                {copy.transparency.aiPolicy}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : null}
          </div>
        ) : null}
        <Button
          type="button"
          size={compact ? "sm" : "md"}
          className="mt-5"
          disabled={pending}
          onClick={onAcknowledge}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ShieldCheck aria-hidden="true" className="size-4" />
          )}
          {pending ? copy.transparency.confirming : copy.transparency.confirm}
        </Button>
      </div>
    </section>
  );
}
