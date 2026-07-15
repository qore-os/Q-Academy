"use client";

import type { ReactNode } from "react";
import { useActionState, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  Code2,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  Headphones,
  History,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RichTextContent } from "@/components/content/rich-text-content";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { SubmissionAnswerContent } from "@/components/content/submission-answer-content";
import {
  GalleryContent,
  LinkButtonContent,
  StructuredBlockContent,
} from "@/components/content/interactive-block-content";
import {
  SubmissionAttachmentLinks,
  SubmissionAttachmentUploader,
  type SubmissionAttachmentView,
} from "@/components/academy/submission-attachment-uploader";
import {
  SubmissionReviewAnnotations,
  type SubmissionReviewAnnotationView,
} from "@/components/academy/submission-review-annotations";
import { VideoTranscriptPlayer } from "@/components/academy/video-transcript-player";
import { EmbeddedDataForm } from "@/components/academy/embedded-data-form";
import { EmbeddedAiAgent } from "@/components/academy/embedded-ai-agent";
import { CourseIntegrationEmbed } from "@/components/academy/course-integration-embed";
import {
  completeLessonAction,
  createSubmissionAction,
  submitAssessmentAction,
  type ActionState,
  type AssessmentActionState,
} from "@/lib/actions";
import { cn, formatDateTime } from "@/lib/utils";
import type { AppLocale } from "@/lib/i18n/model";
import { getLearningUiCopy, type LearningUiCopy } from "@/lib/i18n/learning";
import { createRichTextDocument } from "@/lib/rich-text/document";
import { sanitizeVideoPlaybackPolicy } from "@/lib/media/video-playback-policy";
import { safeCourseEmbedUrl } from "@/lib/hub-embed-policy";
import {
  courseIntegrationProviderById,
  courseIntegrationProviderForUrl,
  resolveCourseIntegrationLayout,
} from "@/lib/content-blocks/integration-catalog";

export type Block = {
  id: string;
  type: string;
  title: string | null;
  required: boolean;
  data: Record<string, unknown>;
  style?: {
    width: "compact" | "content" | "full";
    alignment: "left" | "center";
    surface: "plain" | "bordered" | "muted";
  };
};

type AssessmentSummary = {
  requiredQuizCount: number;
  passingScore: number;
  maxAttempts: number | null;
  shuffleQuestions: boolean;
  attemptsUsed: number;
  attemptsRemaining: number | null;
  maxAttemptsReached: boolean;
  passed: boolean | null;
  latestAttempt: {
    id: string;
    attemptNumber: number;
    score: number;
    passed: boolean;
    submittedAt: Date | string | null;
  } | null;
};

type LessonPage = {
  id: string;
  title: string;
  layoutWidth?: "narrow" | "standard" | "wide";
  backgroundTone?: "plain" | "soft" | "contrast";
  contentSpacing?: "compact" | "comfortable" | "spacious";
  blocks: Block[];
};

export type SubmissionAttempt = {
  id: string;
  blockId: string | null;
  attemptNumber: number;
  supersedesId: string | null;
  title: string;
  content: string | null;
  contentFormat: "plain_text" | "rich_text";
  richText: unknown;
  contentProjectionVersion: number;
  status: "open" | "in_review" | "revision" | "approved";
  score: number | null;
  feedback: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  annotations: SubmissionReviewAnnotationView[];
  attachments: SubmissionAttachmentView[];
};

type AssessmentAnswerValue = number | number[] | string;
type AssessmentSubmissionAnswer = Parameters<
  typeof submitAssessmentAction
>[2][number];
type AssessmentQuestionFeedback = NonNullable<
  AssessmentActionState["questionFeedback"]
>[number];

const initialState: ActionState = {};

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  if (
    /^\/api\/media-assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i.test(
      value,
    )
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function ChecklistBlock({
  block,
  copy,
}: {
  block: Block;
  copy: LearningUiCopy;
}) {
  const items = (block.data.items as string[] | undefined) ?? [];
  const [checked, setChecked] = useState<string[]>([]);

  return (
    <section>
      <h2 className="text-base font-bold text-[#243444]">
        {block.title ?? copy("lesson.checklist")}
      </h2>
      <div className="mt-3 space-y-2">
        {items.map((item) => {
          const active = checked.includes(item);
          return (
            <button
              key={item}
              type="button"
              onClick={() =>
                setChecked((value) =>
                  active
                    ? value.filter((entry) => entry !== item)
                    : [...value, item],
                )
              }
              className={cn(
                "focus-ring flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm",
                active
                  ? "border-[#b9e8e3] bg-[#edf9f7] text-[#176f68]"
                  : "border-[#e1e5e8] text-[#52606d] hover:bg-[#f8f9fa]",
              )}
              aria-pressed={active}
            >
              {active ? (
                <CheckCircle2 className="size-5 shrink-0 text-[#2bb7a9]" />
              ) : (
                <Circle className="size-5 shrink-0 text-[#a0a9b1]" />
              )}
              {item}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StyledBlock({
  block,
  children,
}: {
  block: Block;
  children: ReactNode;
}) {
  const style = block.style ?? {
    width: "content" as const,
    alignment: "left" as const,
    surface: "plain" as const,
  };
  return (
    <div
      className={cn(
        "w-full",
        style.width === "compact"
          ? "mx-auto max-w-2xl"
          : style.width === "content"
            ? "mx-auto max-w-4xl"
            : "max-w-none",
        style.alignment === "center" && "text-center",
        style.surface === "bordered" &&
          "rounded-md border border-[#dfe4e8] p-5",
        style.surface === "muted" && "rounded-md bg-[#f3f5f7] p-5",
      )}
    >
      {children}
    </div>
  );
}

function QuizBlock({
  block,
  copy,
  locked,
  onSelect,
  selected,
}: {
  block: Block;
  copy: LearningUiCopy;
  locked: boolean;
  onSelect: (option: number) => void;
  selected: number | undefined;
}) {
  const options = (block.data.options as string[] | undefined) ?? [];

  return (
    <section
      className="rounded-md border border-[#dfe4e8] p-5"
      data-quiz-block={block.id}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#4f7cac]">
        <Sparkles className="size-4" />
        {block.required
          ? copy("lesson.requiredQuestion")
          : copy("lesson.knowledgeCheck")}
      </div>
      <h2 className="mt-2 text-base font-bold text-[#243444]">
        {String(
          block.data.prompt ?? block.title ?? copy("lesson.quizQuestion"),
        )}
      </h2>
      <div className="mt-4 space-y-2">
        {options.map((option, index) => (
          <button
            key={`${block.id}-${index}`}
            type="button"
            onClick={() => onSelect(index)}
            disabled={locked}
            className={cn(
              "focus-ring flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-70",
              selected === index
                ? "border-[#4f7cac] bg-[#f1f5f9] text-[#294f79]"
                : "border-[#e1e5e8] text-[#52606d] hover:bg-[#f8f9fa]",
            )}
            aria-pressed={selected === index}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-current text-[10px] font-bold">
              {String.fromCharCode(65 + index)}
            </span>
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}

function MultiSelectQuizBlock({
  block,
  copy,
  locked,
  onSelect,
  selected,
}: {
  block: Block;
  copy: LearningUiCopy;
  locked: boolean;
  onSelect: (options: number[]) => void;
  selected: number[];
}) {
  const options = (block.data.options as string[] | undefined) ?? [];
  return (
    <section
      className="rounded-md border border-[#dfe4e8] p-5"
      data-quiz-block={block.id}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#4f7cac]">
        <Sparkles className="size-4" />
        {block.required
          ? copy("lesson.requiredQuestion")
          : copy("lesson.multipleChoice")}
      </div>
      <h2 className="mt-2 text-base font-bold text-[#243444]">
        {String(
          block.data.prompt ?? block.title ?? copy("lesson.multipleChoice"),
        )}
      </h2>
      <div
        className="mt-4 space-y-2"
        role="group"
        aria-label={copy("lesson.multipleChoiceHint")}
      >
        {options.map((option, index) => {
          const active = selected.includes(index);
          return (
            <button
              key={`${block.id}-${index}`}
              type="button"
              onClick={() =>
                onSelect(
                  active
                    ? selected.filter((entry) => entry !== index)
                    : [...selected, index].sort((left, right) => left - right),
                )
              }
              disabled={locked}
              className={cn(
                "focus-ring flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-70",
                active
                  ? "border-[#4f7cac] bg-[#f1f5f9] text-[#294f79]"
                  : "border-[#e1e5e8] text-[#52606d] hover:bg-[#f8f9fa]",
              )}
              aria-pressed={active}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded border border-current">
                {active ? <Check className="size-4" /> : null}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FillBlankQuizBlock({
  block,
  copy,
  locked,
  onChange,
  value,
}: {
  block: Block;
  copy: LearningUiCopy;
  locked: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = `assessment-answer-${block.id}`;
  return (
    <section
      className="rounded-md border border-[#dfe4e8] p-5"
      data-quiz-block={block.id}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#4f7cac]">
        <Sparkles className="size-4" />
        {block.required
          ? copy("lesson.requiredQuestion")
          : copy("lesson.fillBlank")}
      </div>
      <label
        htmlFor={inputId}
        className="mt-2 block text-base font-bold text-[#243444]"
      >
        {String(block.data.prompt ?? block.title ?? copy("lesson.fillBlank"))}
      </label>
      <input
        id={inputId}
        type="text"
        value={value}
        maxLength={500}
        disabled={locked}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        className="focus-ring mt-4 h-11 w-full rounded-md border border-[#cfd8df] bg-white px-3 text-sm text-[#243444] disabled:cursor-not-allowed disabled:bg-[#f5f7f8]"
      />
      {block.data.caseSensitive === true ? (
        <p className="mt-2 text-xs text-[#66727f]">
          {copy("lesson.caseSensitive")}
        </p>
      ) : null}
    </section>
  );
}

function OrderingQuizBlock({
  block,
  copy,
  locked,
  onChange,
  selected,
}: {
  block: Block;
  copy: LearningUiCopy;
  locked: boolean;
  onChange: (value: number[]) => void;
  selected: number[] | undefined;
}) {
  const options = (block.data.options as string[] | undefined) ?? [];
  const order = selected ?? options.map((_, index) => index);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <section
      className="rounded-md border border-[#dfe4e8] p-5"
      data-quiz-block={block.id}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#4f7cac]">
        <Sparkles className="size-4" />
        {block.required
          ? copy("lesson.requiredQuestion")
          : copy("lesson.ordering")}
      </div>
      <h2 className="mt-2 text-base font-bold text-[#243444]">
        {String(block.data.prompt ?? block.title ?? copy("lesson.ordering"))}
      </h2>
      <ol className="mt-4 space-y-2" aria-label={copy("lesson.currentOrder")}>
        {order.map((optionIndex, position) => {
          const option = options[optionIndex] ?? "";
          return (
            <li
              key={`${block.id}-${optionIndex}`}
              className="flex min-h-12 items-center gap-3 rounded-md border border-[#e1e5e8] bg-white p-2 pl-3 text-sm text-[#354555]"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded bg-[#eef3f7] text-[10px] font-bold text-[#365f8d]">
                {position + 1}
              </span>
              <span className="min-w-0 flex-1">{option}</span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(position, position - 1)}
                  disabled={locked || position === 0}
                  className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-30"
                  aria-label={copy("lesson.moveItemUp", { item: option })}
                  title={copy("lesson.moveUp")}
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(position, position + 1)}
                  disabled={locked || position === order.length - 1}
                  className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-30"
                  aria-label={copy("lesson.moveItemDown", { item: option })}
                  title={copy("lesson.moveDown")}
                >
                  <ArrowDown className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function assessmentAnswerPayload(
  block: Block,
  value: AssessmentAnswerValue | undefined,
): AssessmentSubmissionAnswer | null {
  if (block.type === "multiple_choice" || block.type === "true_false") {
    return typeof value === "number"
      ? { blockId: block.id, selectedOption: value }
      : null;
  }
  if (block.type === "multi_select") {
    return Array.isArray(value) && value.length
      ? { blockId: block.id, selectedOptions: value }
      : null;
  }
  if (block.type === "fill_blank") {
    return typeof value === "string" && value.trim()
      ? { blockId: block.id, textAnswer: value }
      : null;
  }
  if (block.type === "ordering") {
    const options = (block.data.options as string[] | undefined) ?? [];
    const optionIds = (block.data.optionIds as string[] | undefined) ?? [];
    const orderedOptions = Array.isArray(value)
      ? value
      : options.map((_, index) => index);
    return orderedOptions.length === options.length &&
      optionIds.length === options.length &&
      options.length >= 2
      ? {
          blockId: block.id,
          orderedItemIds: orderedOptions.map((index) => optionIds[index]),
        }
      : null;
  }
  return null;
}

function QuestionFeedback({
  copy,
  result,
}: {
  copy: LearningUiCopy;
  result: AssessmentQuestionFeedback | undefined;
}) {
  if (!result) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3",
        result.correct
          ? "border-[#b9e8e3] bg-[#edf9f7] text-[#176f68]"
          : "border-[#efc6c1] bg-[#fff7f6] text-[#9f4037]",
      )}
    >
      {result.correct ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 size-5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-bold">
          {result.correct ? copy("lesson.correct") : copy("lesson.incorrect")}
        </p>
        {result.feedback ? (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5">
            {result.feedback}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SubmissionBlock({
  block,
  courseId,
  lessonId,
  attempts,
  canInteract,
  locale,
}: {
  block: Block;
  courseId: string;
  lessonId: string;
  attempts: SubmissionAttempt[];
  canInteract: boolean;
  locale: AppLocale;
}) {
  const copy = getLearningUiCopy(locale);
  const [state, action, pending] = useActionState(
    createSubmissionAction,
    initialState,
  );
  const [attachmentsReady, setAttachmentsReady] = useState(true);
  const orderedAttempts = [...attempts].sort(
    (left, right) =>
      left.attemptNumber - right.attemptNumber ||
      left.submittedAt.localeCompare(right.submittedAt),
  );
  const latest = orderedAttempts.at(-1);
  const canSubmit = !latest || latest.status === "revision";

  return (
    <section className="rounded-md border border-[#f1c7c1] bg-[var(--theme-layer-background)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#b84e42]">
          <FileText className="size-4" />
          {copy("submission.practice")}
        </div>
        {block.required ? (
          <Badge tone="coral">{copy("submission.required")}</Badge>
        ) : null}
      </div>
      <h2 className="mt-2 text-base font-bold text-[var(--theme-strong-text)]">
        {block.title ?? copy("submission.yourSubmission")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--theme-muted-text)]">
        {String(block.data.prompt ?? copy("submission.defaultPrompt"))}
      </p>

      {latest ? (
        <div className="mt-4 border-y border-[#efd8d4] py-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                latest.status === "approved"
                  ? "teal"
                  : latest.status === "revision"
                    ? "coral"
                    : "blue"
              }
            >
              {latest.status === "approved"
                ? copy("submission.approved")
                : latest.status === "revision"
                  ? copy("submission.revision")
                  : copy("submission.inReview")}
            </Badge>
            <span className="text-[10px] font-semibold text-[var(--theme-muted-text)]">
              {copy("common.attempt", { count: latest.attemptNumber })} |{" "}
              {formatDateTime(latest.submittedAt, locale)}
            </span>
          </div>
          {latest.score !== null ? (
            <p className="mt-3 text-sm font-bold text-[var(--theme-strong-text)]">
              {copy("submission.result", { score: latest.score })}
            </p>
          ) : null}
          <div className="mt-3 rounded-md border border-[#efd8d4] bg-white p-3">
            <p className="mb-2 text-[10px] font-bold uppercase text-[var(--theme-coral-text)]">
              {copy("submission.yourAnswer")}
            </p>
            <SubmissionAnswerContent
              content={latest.content}
              contentFormat={latest.contentFormat}
              richText={latest.richText}
              emptyLabel={copy("submission.noText")}
            />
          </div>
          {latest.feedback ? (
            <div className="mt-3 border-l-4 border-[#ee6c5d] bg-white px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-[var(--theme-coral-text)]">
                {copy("submission.trainerFeedback")}
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--theme-muted-text)]">
                {latest.feedback}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-[var(--theme-muted-text)]">
              {copy("submission.pendingReview")}
            </p>
          )}
          <SubmissionReviewAnnotations
            annotations={latest.annotations}
            content={latest.content}
            attachments={latest.attachments}
            locale={locale}
          />
          <SubmissionAttachmentLinks
            attachments={latest.attachments}
            locale={locale}
          />
        </div>
      ) : null}

      {state.error ? (
        <p className="mt-3 text-xs text-[var(--theme-coral-text)]">
          {copy("submission.submitError")}
        </p>
      ) : null}
      {state.success ? (
        <p className="mt-3 rounded-md border border-[#b9e8e3] bg-[var(--theme-layer-background)] p-3 text-xs text-[var(--theme-teal-text)]">
          {copy("submission.submitSuccess")}
        </p>
      ) : null}

      {canSubmit && canInteract ? (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="lessonId" value={lessonId} />
          <input type="hidden" name="blockId" value={block.id} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[var(--theme-strong-text)]">
              {copy("submission.title")}
            </span>
            <input
              name="title"
              defaultValue={latest?.title ?? ""}
              className="focus-ring h-10 w-full rounded-md border border-[#e3cbc7] bg-white px-3 text-sm"
              placeholder={copy("submission.titlePlaceholder")}
              required
            />
          </label>
          <p
            id={`submission-${block.id}-content-label`}
            className="text-xs font-semibold text-[var(--theme-strong-text)]"
          >
            {copy("submission.answer")}
          </p>
          <RichTextEditor
            key={latest?.id ?? `new-${block.id}`}
            id={`submission-${block.id}-content`}
            name="richText"
            initialValue={
              latest?.richText ?? createRichTextDocument(latest?.content ?? "")
            }
            labelledBy={`submission-${block.id}-content-label`}
            ariaLabel={copy("submission.answer")}
            placeholder={copy("submission.draftPlaceholder")}
            minHeightClassName="min-h-36"
            disabled={pending}
            variant="submission"
            locale={locale}
          />
          <SubmissionAttachmentUploader
            disabled={pending}
            onReadinessChange={setAttachmentsReady}
            resetKey={state.submissionId}
            locale={locale}
          />
          <Button type="submit" disabled={pending || !attachmentsReady}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : latest ? (
              <RotateCcw className="size-4" />
            ) : (
              <Send className="size-4" />
            )}
            {!attachmentsReady
              ? copy("submission.attachmentsChecking")
              : pending
                ? copy("submission.sending")
                : latest
                  ? copy("submission.resubmit")
                  : copy("submission.submit")}
          </Button>
        </form>
      ) : null}

      {orderedAttempts.length > 1 ? (
        <details className="mt-4 border-t border-[#efd8d4] pt-3">
          <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded text-xs font-semibold text-[var(--theme-strong-text)]">
            <History className="size-4" />
            {copy("submission.allAttempts", {
              count: orderedAttempts.length,
            })}
          </summary>
          <div className="mt-3 divide-y divide-[#efd8d4]">
            {[...orderedAttempts].reverse().map((attempt) => (
              <div key={attempt.id} className="py-3 text-xs text-[var(--theme-muted-text)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {copy("common.attempt", { count: attempt.attemptNumber })}
                  </strong>
                  <span>{formatDateTime(attempt.submittedAt, locale)}</span>
                </div>
                {attempt.feedback ? (
                  <p className="mt-1 leading-5">{attempt.feedback}</p>
                ) : null}
                <SubmissionAnswerContent
                  content={attempt.content}
                  contentFormat={attempt.contentFormat}
                  richText={attempt.richText}
                  className="mt-2 text-xs leading-5"
                  emptyLabel={copy("submission.noText")}
                />
                <SubmissionReviewAnnotations
                  annotations={attempt.annotations}
                  content={attempt.content}
                  attachments={attempt.attachments}
                  locale={locale}
                />
                <SubmissionAttachmentLinks
                  attachments={attempt.attachments}
                  locale={locale}
                />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

export function LessonContent({
  assessment,
  blocks,
  pages = [],
  completed,
  courseId,
  lessonId,
  courseSlug,
  lessonType = "lesson",
  initialPageId,
  submissions = [],
  canInteract = true,
  locale,
}: {
  assessment: AssessmentSummary;
  blocks: Block[];
  pages?: LessonPage[];
  completed: boolean;
  courseId: string;
  lessonId: string;
  courseSlug: string;
  lessonType?: string;
  initialPageId?: string;
  submissions?: SubmissionAttempt[];
  canInteract?: boolean;
  locale: AppLocale;
}) {
  const router = useRouter();
  const copy = getLearningUiCopy(locale);
  const isExam = lessonType === "exam";
  const [completionPending, startCompletionTransition] = useTransition();
  const [assessmentPending, startAssessmentTransition] = useTransition();
  const [answers, setAnswers] = useState<Record<string, AssessmentAnswerValue>>(
    {},
  );
  const [activePageIndex, setActivePageIndex] = useState(() =>
    Math.max(
      0,
      initialPageId ? pages.findIndex((page) => page.id === initialPageId) : 0,
    ),
  );
  const [assessmentPassed, setAssessmentPassed] = useState(assessment.passed);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentActionState | null>(null);
  const [lessonCompleted, setLessonCompleted] = useState(completed);
  const [completedRequiredVideos, setCompletedRequiredVideos] = useState<
    Set<string>
  >(() => new Set());
  const allBlocks = pages.length
    ? [...blocks, ...pages.flatMap((page) => page.blocks)]
    : blocks;
  const visibleBlocks = pages.length
    ? [...blocks, ...(pages[activePageIndex]?.blocks ?? [])]
    : blocks;
  const activePage = pages[activePageIndex];
  const finalPage = !pages.length || activePageIndex === pages.length - 1;
  const quizBlocks = allBlocks.filter((block) =>
    [
      "multiple_choice",
      "true_false",
      "multi_select",
      "fill_blank",
      "ordering",
    ].includes(block.type),
  );
  const requiredQuizBlocks = quizBlocks.filter((block) => block.required);
  const assessedBlocks = requiredQuizBlocks.length
    ? requiredQuizBlocks
    : quizBlocks;
  const assessmentRequired = requiredQuizBlocks.length > 0;
  const requiredSubmissionBlocks = allBlocks.filter(
    (block) => block.type === "submission" && block.required,
  );
  const submissionGateOpen = requiredSubmissionBlocks.every((block) => {
    const latest = submissions
      .filter((submission) => submission.blockId === block.id)
      .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
    return latest?.status === "approved";
  });
  const requiredVideoBlocks = allBlocks.filter(
    (block) =>
      block.type === "video" &&
      sanitizeVideoPlaybackPolicy(block.data.videoPlayback).completionMode ===
        "required",
  );
  const videoGateOpen = requiredVideoBlocks.every((block) =>
    completedRequiredVideos.has(block.id),
  );
  const updateRequiredVideoCompletion = useCallback(
    (blockId: string, isComplete: boolean) => {
      setCompletedRequiredVideos((current) => {
        const next = new Set(current);
        if (isComplete) next.add(blockId);
        else next.delete(blockId);
        return next;
      });
    },
    [],
  );
  const allQuestionsAnswered = assessedBlocks.every((block) =>
    Boolean(assessmentAnswerPayload(block, answers[block.id])),
  );
  const quizGateOpen = !assessmentRequired || assessmentPassed;
  const displayedAttempt = assessmentResult ?? assessment.latestAttempt;
  const attemptsUsed =
    assessmentResult?.attemptsUsed ?? assessment.attemptsUsed;
  const attemptsRemaining =
    assessmentResult?.attemptsRemaining ?? assessment.attemptsRemaining;
  const maxAttemptsReached =
    assessmentResult?.maxAttemptsReached ?? assessment.maxAttemptsReached;
  const updateAnswer = (blockId: string, value: AssessmentAnswerValue) => {
    setAssessmentResult(null);
    setAnswers((current) => ({ ...current, [blockId]: value }));
  };
  const feedbackFor = (blockId: string) =>
    assessmentResult?.questionFeedback?.find(
      (feedback) => feedback.blockId === blockId,
    );

  const submitQuiz = () => {
    if (
      !canInteract ||
      !allQuestionsAnswered ||
      assessmentPending ||
      maxAttemptsReached
    )
      return;
    const payload = assessedBlocks.map((block) =>
      assessmentAnswerPayload(block, answers[block.id]),
    );
    if (payload.some((answer) => !answer)) return;
    startAssessmentTransition(async () => {
      const result = await submitAssessmentAction(
        courseId,
        lessonId,
        payload.filter((answer): answer is AssessmentSubmissionAnswer =>
          Boolean(answer),
        ),
      );
      setAssessmentResult(result);
      if (result.passed) {
        setAssessmentPassed(true);
        toast.success(
          isExam
            ? copy("lesson.examPassed")
            : copy("lesson.requiredQuizPassed"),
        );
        router.refresh();
      } else {
        setAnswers({});
        toast.error(
          result.maxAttemptsReached
            ? copy("lesson.attemptLimitReached")
            : copy("lesson.notPassed"),
        );
        router.refresh();
      }
    });
  };

  const complete = () => {
    if (!canInteract) return;
    startCompletionTransition(async () => {
      const result = await completeLessonAction(courseId, lessonId);
      if (result.error) {
        toast.error(copy("lesson.completeError"));
        return;
      }
      setLessonCompleted(true);
      toast.success(
        isExam ? copy("lesson.examCompleted") : copy("lesson.completed"),
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-7">
      {!canInteract ? (
        <div
          className="flex items-start gap-3 border-l-4 border-[#4f7cac] bg-[#f4f7fa] px-4 py-3 text-[#365f8d]"
          role="status"
        >
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-xs font-bold">{copy("lesson.readOnlyTitle")}</p>
            <p className="mt-0.5 text-xs leading-5 text-[#5f7080]">
              {copy("lesson.readOnlyBody")}
            </p>
          </div>
        </div>
      ) : null}
      {pages.length ? (
        <nav
          className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-[#e8ebee] pb-3"
          aria-label={copy("lesson.pages")}
        >
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setActivePageIndex(index)}
              className={cn(
                "focus-ring flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-semibold",
                index === activePageIndex
                  ? "bg-[#17324d] text-white"
                  : "text-[#66727f] hover:bg-[#edf1f3]",
              )}
              aria-current={index === activePageIndex ? "page" : undefined}
            >
              <span className="grid size-5 place-items-center rounded bg-current/10 text-[10px]">
                {index + 1}
              </span>
              {page.title}
            </button>
          ))}
        </nav>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full",
          activePage?.layoutWidth === "narrow"
            ? "max-w-3xl"
            : activePage?.layoutWidth === "wide"
              ? "max-w-none"
              : "max-w-5xl",
          activePage?.backgroundTone === "soft" &&
            "rounded-md bg-[#f6f8f8] p-5",
          activePage?.backgroundTone === "contrast" &&
            "rounded-md border border-[#ccd6df] bg-[#eef3f7] p-5",
          activePage?.contentSpacing === "compact"
            ? "space-y-3"
            : activePage?.contentSpacing === "spacious"
              ? "space-y-10"
              : "space-y-7",
        )}
      >
        {visibleBlocks.map((block) => (
          <StyledBlock key={block.id} block={block}>
            {(() => {
              if (
                block.type === "ai_agent" &&
                typeof block.data.agentId === "string"
              ) {
                return (
                  <EmbeddedAiAgent
                    key={block.id}
                    locale={locale}
                    agentId={block.data.agentId}
                    canInteract={canInteract}
                  />
                );
              }
              if (block.type === "eyebrow") {
                return (
                  <p
                    key={block.id}
                    className="text-[10px] font-bold uppercase text-[#2b9188]"
                  >
                    {String(block.data.text ?? "")}
                  </p>
                );
              }
              if (block.type === "heading") {
                return (
                  <h1
                    key={block.id}
                    className="text-3xl font-bold leading-tight text-[#17212b]"
                  >
                    {String(block.data.text ?? "")}
                  </h1>
                );
              }
              if (block.type === "text") {
                return (
                  <p
                    key={block.id}
                    className="text-[15px] leading-8 text-[#52606d]"
                  >
                    {String(block.data.text ?? "")}
                  </p>
                );
              }
              if (block.type === "rich_text") {
                return (
                  <RichTextContent
                    key={block.id}
                    document={block.data.richText}
                  />
                );
              }
              if (block.type === "button") {
                return (
                  <div key={block.id}>
                    <LinkButtonContent document={block.data.button} />
                  </div>
                );
              }
              if (block.type === "gallery") {
                return (
                  <GalleryContent
                    key={block.id}
                    document={block.data.gallery}
                    locale={locale}
                  />
                );
              }
              if (
                block.type === "callout" ||
                block.type === "quote" ||
                block.type === "divider" ||
                block.type === "accordion" ||
                block.type === "tabs" ||
                block.type === "columns" ||
                block.type === "download" ||
                block.type === "code" ||
                block.type === "table"
              ) {
                return (
                  <StructuredBlockContent
                    key={block.id}
                    type={block.type}
                    document={block.data[block.type]}
                    locale={locale}
                  />
                );
              }
              if (
                block.type === "data_form" &&
                typeof block.data.formId === "string"
              ) {
                return (
                  <EmbeddedDataForm
                    key={block.id}
                    formId={block.data.formId}
                    sourceType="lesson"
                    sourceId={lessonId}
                    readOnly={!canInteract}
                    locale={locale}
                  />
                );
              }
              if (block.type === "info") {
                return (
                  <aside
                    key={block.id}
                    className="rounded-md border-l-4 border-[#d6a536] bg-[#fbf6e7] p-5"
                  >
                    <p className="text-xs font-bold text-[#6f5617]">
                      {block.title ?? copy("lesson.notice")}
                    </p>
                    <p className="mt-1 text-sm leading-7 text-[#6d603c]">
                      {String(block.data.text ?? "")}
                    </p>
                  </aside>
                );
              }
              if (block.type === "image") {
                const src = safeHttpUrl(block.data.imageUrl);
                const stockImage =
                  block.data.stockImage &&
                  typeof block.data.stockImage === "object"
                    ? (block.data.stockImage as Record<string, unknown>)
                    : null;
                const sourceUrl = safeHttpUrl(stockImage?.sourceUrl);
                return src ? (
                  <figure key={block.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={String(
                        block.title ??
                          block.data.caption ??
                          copy("lesson.courseImage"),
                      )}
                      className="max-h-[640px] w-full rounded-md object-contain"
                    />
                    {block.data.caption ? (
                      <figcaption className="mt-2 text-center text-xs leading-5 text-[#71808b]">
                        {String(block.data.caption)}
                      </figcaption>
                    ) : null}
                    {stockImage?.attribution ? (
                      <p className="mt-1 text-center text-[10px] text-[var(--theme-muted-text)]">
                        {sourceUrl ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {String(stockImage.attribution)}
                          </a>
                        ) : (
                          String(stockImage.attribution)
                        )}
                      </p>
                    ) : null}
                  </figure>
                ) : null;
              }
              if (block.type === "video") {
                const src = safeHttpUrl(block.data.videoUrl);
                return src ? (
                  <VideoTranscriptPlayer
                    key={block.id}
                    src={src}
                    title={block.title}
                    caption={
                      typeof block.data.caption === "string"
                        ? block.data.caption
                        : null
                    }
                    transcript={block.data.transcript}
                    endCard={block.data.videoEndCard}
                    playbackPolicy={block.data.videoPlayback}
                    mediaAssetId={
                      typeof block.data.mediaAssetId === "string"
                        ? block.data.mediaAssetId
                        : undefined
                    }
                    transcodeJobId={
                      block.data.videoComposition &&
                      typeof block.data.videoComposition === "object" &&
                      "renderJobId" in block.data.videoComposition &&
                      typeof block.data.videoComposition.renderJobId ===
                        "string"
                        ? block.data.videoComposition.renderJobId
                        : undefined
                    }
                    courseId={courseId}
                    courseSlug={courseSlug}
                    lessonId={lessonId}
                    blockId={block.id}
                    locale={locale}
                    onCompletionChange={(isComplete) =>
                      updateRequiredVideoCompletion(block.id, isComplete)
                    }
                  />
                ) : null;
              }
              if (block.type === "audio") {
                const src = safeHttpUrl(block.data.audioUrl);
                return src ? (
                  <section
                    key={block.id}
                    className="rounded-md border border-[#dfe4e8] p-5"
                  >
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[#354555]">
                      <Headphones className="size-4 text-[#365f8d]" />
                      {block.title ?? copy("lesson.audio")}
                    </div>
                    <audio
                      src={src}
                      controls
                      preload="metadata"
                      className="w-full"
                    />
                    {block.data.caption ? (
                      <p className="mt-2 text-xs leading-5 text-[#71808b]">
                        {String(block.data.caption)}
                      </p>
                    ) : null}
                  </section>
                ) : null;
              }
              if (block.type === "file") {
                const href = safeHttpUrl(block.data.fileUrl);
                return href ? (
                  <a
                    key={block.id}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring flex items-center gap-4 rounded-md border border-[#cbd7e2] bg-[#f7f9fb] p-4 hover:bg-[#eef3f7]"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-[#365f8d] shadow-sm">
                      <Download className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-[#354555]">
                        {String(
                          block.data.fileName ??
                            block.title ??
                            copy("lesson.courseMaterial"),
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-[#71808b]">
                        {String(block.data.caption ?? copy("lesson.openFile"))}
                      </span>
                    </span>
                  </a>
                ) : null;
              }
              if (block.type === "embed") {
                const src = safeCourseEmbedUrl(block.data.embedUrl);
                const provider =
                  courseIntegrationProviderForUrl(src) ??
                  courseIntegrationProviderById(block.data.embedProvider);
                const layout = resolveCourseIntegrationLayout(
                  block.data.embedLayout,
                  provider?.id,
                );
                return src ? (
                  <section key={block.id}>
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[#354555]">
                      <Code2 className="size-4 text-[#365f8d]" />
                      {block.title ?? copy("lesson.embed")}
                      {provider ? (
                        <span className="ml-auto text-xs font-medium text-[#71808b]">
                          {provider.name}
                        </span>
                      ) : null}
                    </div>
                    <CourseIntegrationEmbed
                      src={src}
                      title={block.title ?? copy("lesson.embeddedContent")}
                      providerName={provider?.name ?? copy("lesson.embed")}
                      layout={layout}
                      locale={locale}
                    />
                  </section>
                ) : null;
              }
              if (block.type === "checklist")
                return (
                  <ChecklistBlock key={block.id} block={block} copy={copy} />
                );
              if (
                block.type === "multiple_choice" ||
                block.type === "true_false"
              ) {
                return (
                  <div key={block.id} className="space-y-2">
                    <QuizBlock
                      block={block}
                      copy={copy}
                      locked={
                        !canInteract ||
                        maxAttemptsReached ||
                        (assessmentPassed === true && block.required)
                      }
                      selected={
                        typeof answers[block.id] === "number"
                          ? (answers[block.id] as number)
                          : undefined
                      }
                      onSelect={(selectedOption) =>
                        updateAnswer(block.id, selectedOption)
                      }
                    />
                    <QuestionFeedback
                      copy={copy}
                      result={feedbackFor(block.id)}
                    />
                  </div>
                );
              }
              if (block.type === "multi_select") {
                return (
                  <div key={block.id} className="space-y-2">
                    <MultiSelectQuizBlock
                      block={block}
                      copy={copy}
                      locked={
                        !canInteract ||
                        maxAttemptsReached ||
                        (assessmentPassed === true && block.required)
                      }
                      selected={
                        Array.isArray(answers[block.id])
                          ? (answers[block.id] as number[])
                          : []
                      }
                      onSelect={(selectedOptions) =>
                        updateAnswer(block.id, selectedOptions)
                      }
                    />
                    <QuestionFeedback
                      copy={copy}
                      result={feedbackFor(block.id)}
                    />
                  </div>
                );
              }
              if (block.type === "fill_blank") {
                return (
                  <div key={block.id} className="space-y-2">
                    <FillBlankQuizBlock
                      block={block}
                      copy={copy}
                      locked={
                        !canInteract ||
                        maxAttemptsReached ||
                        (assessmentPassed === true && block.required)
                      }
                      value={
                        typeof answers[block.id] === "string"
                          ? (answers[block.id] as string)
                          : ""
                      }
                      onChange={(textAnswer) =>
                        updateAnswer(block.id, textAnswer)
                      }
                    />
                    <QuestionFeedback
                      copy={copy}
                      result={feedbackFor(block.id)}
                    />
                  </div>
                );
              }
              if (block.type === "ordering") {
                return (
                  <div key={block.id} className="space-y-2">
                    <OrderingQuizBlock
                      block={block}
                      copy={copy}
                      locked={
                        !canInteract ||
                        maxAttemptsReached ||
                        (assessmentPassed === true && block.required)
                      }
                      selected={
                        Array.isArray(answers[block.id])
                          ? (answers[block.id] as number[])
                          : undefined
                      }
                      onChange={(orderedOptions) =>
                        updateAnswer(block.id, orderedOptions)
                      }
                    />
                    <QuestionFeedback
                      copy={copy}
                      result={feedbackFor(block.id)}
                    />
                  </div>
                );
              }
              if (block.type === "submission") {
                return (
                  <SubmissionBlock
                    key={block.id}
                    block={block}
                    courseId={courseId}
                    lessonId={lessonId}
                    attempts={submissions.filter(
                      (submission) => submission.blockId === block.id,
                    )}
                    canInteract={canInteract}
                    locale={locale}
                  />
                );
              }
              return null;
            })()}
          </StyledBlock>
        ))}
      </div>

      {finalPage && assessedBlocks.length ? (
        <section
          className={cn(
            "border-l-4 px-4 py-3",
            assessmentPassed
              ? "border-[#2bb7a9] bg-[#edf9f7]"
              : assessmentResult?.passed === false
                ? "border-[#d3695e] bg-[#fff7f6]"
                : "border-[#4f7cac] bg-[#f4f7fa]",
          )}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {assessmentPassed ? (
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#167e74]" />
              ) : assessmentResult?.passed === false ? (
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-[#b84e42]" />
              ) : (
                <Sparkles className="mt-0.5 size-5 shrink-0 text-[#365f8d]" />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-bold",
                    assessmentPassed
                      ? "text-[#176f68]"
                      : assessmentResult?.passed === false
                        ? "text-[#9f4037]"
                        : "text-[#294f79]",
                  )}
                >
                  {assessmentPassed
                    ? isExam
                      ? copy("lesson.examPassed")
                      : copy("lesson.requiredQuizPassed")
                    : maxAttemptsReached
                      ? copy("lesson.attemptLimitReached")
                      : assessmentResult?.passed === false
                        ? copy("lesson.notPassed")
                        : isExam
                          ? copy("lesson.exam")
                          : assessmentRequired
                            ? copy("lesson.requiredQuiz")
                            : copy("lesson.quiz")}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-[#66727f]">
                  {assessmentPassed
                    ? copy("lesson.passedAttempt", {
                        score: Number(displayedAttempt?.score ?? 100),
                        attempt: Number(displayedAttempt?.attemptNumber ?? 1),
                      })
                    : maxAttemptsReached
                      ? copy("lesson.attemptsExhausted", {
                          used: attemptsUsed,
                          max: assessment.maxAttempts ?? attemptsUsed,
                        })
                      : assessmentResult?.passed === false
                        ? copy("lesson.retryScore", {
                            score: Number(assessmentResult.score ?? 0),
                          })
                        : copy("lesson.answerAll")}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-semibold text-[#66727f]">
                  <span>
                    {copy("lesson.passAt", {
                      score: assessment.passingScore,
                    })}
                  </span>
                  <span>
                    {assessment.maxAttempts === null
                      ? copy("lesson.attemptsUnlimited", {
                          used: attemptsUsed,
                        })
                      : copy("lesson.attemptsLimited", {
                          used: attemptsUsed,
                          max: assessment.maxAttempts,
                        })}
                  </span>
                  {attemptsRemaining !== null && !maxAttemptsReached ? (
                    <span>
                      {copy("lesson.remaining", { count: attemptsRemaining })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {!assessmentPassed ? (
              <Button
                type="button"
                variant="navy"
                onClick={submitQuiz}
                disabled={
                  !allQuestionsAnswered ||
                  assessmentPending ||
                  maxAttemptsReached ||
                  !canInteract
                }
              >
                {assessmentPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {assessmentPending
                  ? copy("lesson.evaluating")
                  : maxAttemptsReached
                    ? copy("lesson.noAttempts")
                    : isExam
                      ? copy("lesson.submitExam")
                      : assessmentRequired
                        ? copy("lesson.submitRequiredQuiz")
                        : copy("lesson.submitQuiz")}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {pages.length ? (
        <div className="flex items-center justify-between gap-3 border-t border-[#e8ebee] pt-5">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setActivePageIndex((index) => Math.max(0, index - 1))
            }
            disabled={activePageIndex === 0}
          >
            <ChevronLeft className="size-4" />
            {copy("lesson.previous")}
          </Button>
          {!finalPage ? (
            <Button
              type="button"
              onClick={() =>
                setActivePageIndex((index) =>
                  Math.min(pages.length - 1, index + 1),
                )
              }
            >
              {copy("lesson.nextPage")}
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <span className="text-xs font-semibold text-[#7a8690]">
              {activePageIndex + 1} / {pages.length}
            </span>
          )}
        </div>
      ) : null}

      {finalPage ? (
        <div className="border-t border-[#e8ebee] pt-6">
          <Button
            type="button"
            onClick={complete}
            disabled={
              completionPending ||
              !canInteract ||
              lessonCompleted ||
              !quizGateOpen ||
              !submissionGateOpen ||
              !videoGateOpen
            }
            className="w-full sm:w-auto"
            title={
              !quizGateOpen
                ? isExam
                  ? copy("lesson.gatePassExam")
                  : copy("lesson.gatePassQuiz")
                : !submissionGateOpen
                  ? copy("lesson.gateSubmission")
                  : !videoGateOpen
                    ? copy("lesson.gateVideo")
                    : undefined
            }
          >
            {completionPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {lessonCompleted
              ? isExam
                ? copy("lesson.examCompleted")
                : copy("lesson.completed")
              : completionPending
                ? copy("lesson.saving")
                : !quizGateOpen
                  ? isExam
                    ? copy("lesson.passExamFirst")
                    : copy("lesson.passQuizFirst")
                  : !submissionGateOpen
                    ? copy("lesson.approveSubmissionFirst")
                    : !videoGateOpen
                      ? copy("lesson.watchVideoFirst")
                      : isExam
                        ? copy("lesson.completeExam")
                        : copy("lesson.completeLesson")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
