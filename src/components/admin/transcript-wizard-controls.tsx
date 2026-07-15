"use client";

import { Check, Copy, LoaderCircle, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createBlocksFromTranscriptAction } from "@/lib/admin/transcript-wizard-actions";
import {
  MAX_TRANSCRIPT_WIZARD_INSTRUCTION_LENGTH,
  type TranscriptWizardOperation,
} from "@/lib/ai/transcript-wizard-schema";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";
import { getTranscriptWizardUiCopy } from "@/lib/i18n/transcript-wizard";

export function TranscriptWizardControls({
  courseId,
  blockId,
  locale,
}: {
  courseId: string;
  blockId: string;
  locale: AppLocale;
}) {
  const router = useRouter();
  const copy = getCourseParityCopy(locale).transcript;
  const uiCopy = getTranscriptWizardUiCopy(locale);
  const [operation, setOperation] = useState<TranscriptWizardOperation>("mixed");
  const [instruction, setInstruction] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    setResponse(null);
    setCopied(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("operation", operation);
      formData.set("locale", locale);
      formData.set("instruction", instruction);
      const result = await createBlocksFromTranscriptAction(
        courseId,
        blockId,
        {},
        formData,
      );
      if (result.ok) {
        setResponse(result.response ?? null);
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message ?? copy.genericFailure);
      }
    });
  };

  const copyResponse = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      toast.success(uiCopy.responseCopied);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error(uiCopy.responseCopyFailed);
    }
  };

  return (
    <div
      className="space-y-3 border-t border-[#e1e6e9] pt-4"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.wizard}
          </span>
          <select
            name="operation"
            value={operation}
            onChange={(event) =>
              setOperation(event.target.value as TranscriptWizardOperation)
            }
            disabled={pending}
            className="focus-ring h-10 w-full rounded-md border border-[#d5dde3] bg-white px-3 text-sm"
          >
            {Object.entries(uiCopy.operations).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#365f8d] px-4 text-sm font-bold text-white hover:bg-[#294f79] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {pending ? copy.generating : copy.generate}
        </button>
      </div>
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-[#52606d]">
          <span>{uiCopy.instructionLabel}</span>
          <span className="font-normal text-[#71808b]">
            {uiCopy.instructionCount(
              instruction.length,
              MAX_TRANSCRIPT_WIZARD_INSTRUCTION_LENGTH,
            )}
          </span>
        </span>
        <textarea
          name="instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={MAX_TRANSCRIPT_WIZARD_INSTRUCTION_LENGTH}
          disabled={pending}
          placeholder={uiCopy.instructionPlaceholder}
          className="focus-ring min-h-20 w-full resize-y rounded-md border border-[#d5dde3] bg-white p-3 text-sm leading-6"
        />
      </label>
      {response ? (
        <section
          aria-label={uiCopy.responseLabel}
          aria-live="polite"
          className="rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-[#354555]">
              {uiCopy.responseLabel}
            </h3>
            <button
              type="button"
              onClick={() => void copyResponse()}
              className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-2.5 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa]"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? uiCopy.responseCopied : uiCopy.copyResponse}
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#52606d]">
            {response}
          </p>
        </section>
      ) : null}
    </div>
  );
}
