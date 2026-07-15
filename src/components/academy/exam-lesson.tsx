"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  FileQuestion,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubmissionBlock,
  type Block,
  type SubmissionAttempt,
} from "@/components/academy/lesson-content";
import {
  type ExamNavigationLock,
  useExamNavigationLockController,
} from "@/components/academy/exam-navigation-guard";
import { completeLessonAction } from "@/lib/actions";
import {
  examAnswerMap,
  examAnswersForSubmission,
  examDraftAnswers,
  isAutomaticExamQuestion,
  remainingExamSeconds,
  type ExamAnswerMap,
  type ExamAttemptPayload,
  type ExamDraftAnswerPayload,
  type ExamPendingAttempt,
  type ExamQuestionPayload,
  type ExamResultPayload,
  type ExamReviewEntry,
} from "@/lib/exam-client-model";
import { cn, formatDateTime } from "@/lib/utils";
import type { AppLocale } from "@/lib/i18n/model";
import {
  formatLearningExamDuration,
  getLearningUiCopy,
  type LearningUiCopy,
} from "@/lib/i18n/learning";

export type ExamLessonSummary = {
  questionCount: number;
  durationSeconds: number | null;
  passingScore: number;
  maxAttempts: number | null;
  attemptsUsed: number;
  attemptsRemaining: number | null;
  maxAttemptsReached: boolean;
  resultReleaseMode: "immediate" | "after_deadline" | "manual";
  reviewReleaseMode: "never" | "after_result" | "manual";
  contentAccessMode: "allow" | "block_course" | "block_academy";
  navigationLock: ExamNavigationLock | null;
  pendingAttempt: ExamPendingAttempt | null;
  latestAttempt: {
    id: string;
    attemptNumber: number;
    score: number;
    passed: boolean;
    submittedAt: string | null;
  } | null;
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

class ExamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message);
  }
}

async function examEnvelopeRequest<T>(
  url: string,
  fallbackMessage: string,
  init?: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    detail?: string;
    errors?: unknown;
    meta?: { timestamp?: string };
  } | null;
  if (!response.ok || !payload || !("data" in payload)) {
    throw new ExamApiError(
      fallbackMessage,
      response.status,
      payload?.errors ?? null,
    );
  }
  return {
    data: payload.data as T,
    serverTimestamp: payload.meta?.timestamp ?? null,
  };
}

function optionsFor(question: ExamQuestionPayload) {
  return Array.isArray(question.data.options)
    ? question.data.options.filter(
        (option): option is string => typeof option === "string",
      )
    : [];
}

function optionIdsFor(question: ExamQuestionPayload) {
  return Array.isArray(question.data.optionIds)
    ? question.data.optionIds.filter(
        (option): option is string => typeof option === "string",
      )
    : [];
}

function ExamQuestion({
  answer,
  copy,
  disabled,
  index,
  onAnswer,
  question,
  total,
}: {
  answer: ExamDraftAnswerPayload | undefined;
  copy: LearningUiCopy;
  disabled: boolean;
  index: number;
  onAnswer: (answer: ExamDraftAnswerPayload | null) => void;
  question: ExamQuestionPayload;
  total: number;
}) {
  const options = optionsFor(question);
  const prompt = String(
    question.data.prompt ??
      question.title ??
      copy("exam.questionDefault", { count: index + 1 }),
  );
  const label = copy("exam.questionProgress", {
    current: index + 1,
    total,
  });

  if (question.type === "multiple_choice" || question.type === "true_false") {
    const selected =
      answer && "selectedOption" in answer ? answer.selectedOption : null;
    return (
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="sr-only">{`${label}: ${prompt}`}</legend>
        <p className="text-[10px] font-bold uppercase text-[#4f7cac]">
          {label}
        </p>
        <h2 className="mt-2 text-lg font-bold leading-7 text-[#243444]">
          {prompt}
        </h2>
        <div className="mt-6 space-y-2.5">
          {options.map((option, optionIndex) => {
            const optionId = `exam-${question.blockId}-option-${optionIndex}`;
            const checked = selected === optionIndex;
            return (
              <label
                key={optionId}
                htmlFor={optionId}
                className={cn(
                  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#4f7cac] has-[:focus-visible]:ring-offset-2",
                  checked
                    ? "border-[#4f7cac] bg-[#f1f5f9] text-[#294f79]"
                    : "border-[#dfe4e8] bg-white text-[#52606d] hover:bg-[#f8f9fa]",
                  disabled && "cursor-not-allowed opacity-70",
                )}
              >
                <input
                  id={optionId}
                  type="radio"
                  name={`exam-question-${question.blockId}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onAnswer({
                      blockId: question.blockId,
                      selectedOption: optionIndex,
                    })
                  }
                  className="sr-only"
                />
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-current text-[10px] font-bold">
                  {String.fromCharCode(65 + optionIndex)}
                </span>
                <span className="min-w-0 break-words">{option}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.type === "multi_select") {
    const selected =
      answer && "selectedOptions" in answer ? answer.selectedOptions : [];
    return (
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="sr-only">{label}</legend>
        <p className="text-[10px] font-bold uppercase text-[#4f7cac]">
          {label}
        </p>
        <h2 className="mt-2 text-lg font-bold leading-7 text-[#243444]">
          {prompt}
        </h2>
        <p className="mt-1 text-xs text-[#66727f]">
          {copy("exam.multipleAnswers")}
        </p>
        <div className="mt-5 space-y-2.5">
          {options.map((option, optionIndex) => {
            const active = selected.includes(optionIndex);
            const next = active
              ? selected.filter((entry) => entry !== optionIndex)
              : [...selected, optionIndex].sort((left, right) => left - right);
            return (
              <button
                key={optionIndex}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onAnswer(
                    next.length
                      ? { blockId: question.blockId, selectedOptions: next }
                      : null,
                  )
                }
                className={cn(
                  "focus-ring flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-70",
                  active
                    ? "border-[#4f7cac] bg-[#f1f5f9] text-[#294f79]"
                    : "border-[#dfe4e8] bg-white text-[#52606d] hover:bg-[#f8f9fa]",
                )}
                aria-pressed={active}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded border border-current">
                  {active ? <Check className="size-4" /> : null}
                </span>
                <span className="min-w-0 break-words">{option}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.type === "fill_blank") {
    const value = answer && "textAnswer" in answer ? answer.textAnswer : "";
    const inputId = `exam-answer-${question.blockId}`;
    return (
      <section>
        <p className="text-[10px] font-bold uppercase text-[#4f7cac]">
          {label}
        </p>
        <label
          htmlFor={inputId}
          className="mt-2 block text-lg font-bold leading-7 text-[#243444]"
        >
          {prompt}
        </label>
        <input
          id={inputId}
          value={value}
          maxLength={500}
          disabled={disabled}
          autoComplete="off"
          onChange={(event) =>
            onAnswer(
              event.target.value
                ? {
                    blockId: question.blockId,
                    textAnswer: event.target.value,
                  }
                : null,
            )
          }
          className="focus-ring mt-6 h-12 w-full rounded-md border border-[#cfd8df] bg-white px-3 text-sm text-[#243444] disabled:bg-[#f5f7f8]"
        />
        {question.data.caseSensitive === true ? (
          <p className="mt-2 text-xs text-[#66727f]">
            {copy("lesson.caseSensitive")}
          </p>
        ) : null}
      </section>
    );
  }

  const optionIds = optionIdsFor(question);
  const selected =
    answer && "orderedItemIds" in answer ? answer.orderedItemIds : optionIds;
  const optionById = new Map(
    optionIds.map((id, optionIndex) => [id, options[optionIndex] ?? ""]),
  );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length) return;
    const next = [...selected];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    onAnswer({ blockId: question.blockId, orderedItemIds: next });
  };
  return (
    <section>
      <p className="text-[10px] font-bold uppercase text-[#4f7cac]">{label}</p>
      <h2 className="mt-2 text-lg font-bold leading-7 text-[#243444]">
        {prompt}
      </h2>
      <ol
        className="mt-6 space-y-2.5"
        aria-label={copy("exam.selectedOrder")}
      >
        {selected.map((optionId, position) => (
          <li
            key={optionId}
            className="flex min-h-12 items-center gap-3 rounded-md border border-[#dfe4e8] bg-white p-2 pl-3 text-sm text-[#354555]"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded bg-[#eef3f7] text-[10px] font-bold text-[#365f8d]">
              {position + 1}
            </span>
            <span className="min-w-0 flex-1 break-words">
              {optionById.get(optionId)}
            </span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                disabled={disabled || position === 0}
                onClick={() => move(position, position - 1)}
                className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-30"
                aria-label={copy("exam.moveEntryUp")}
                title={copy("lesson.moveUp")}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                disabled={disabled || position === selected.length - 1}
                onClick={() => move(position, position + 1)}
                className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-30"
                aria-label={copy("exam.moveEntryDown")}
                title={copy("lesson.moveDown")}
              >
                <ArrowDown className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {!answer && optionIds.length ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-4"
          disabled={disabled}
          onClick={() =>
            onAnswer({ blockId: question.blockId, orderedItemIds: optionIds })
          }
        >
          <Check className="size-4" />
          {copy("exam.applyOrder")}
        </Button>
      ) : null}
    </section>
  );
}

function orderingAnswer(
  entry: ExamReviewEntry,
  questions: readonly ExamQuestionPayload[],
  orderedItemIds: readonly string[],
) {
  const question = questions.find(
    (candidate) => candidate.blockId === entry.blockId,
  );
  if (!question) return null;
  const optionIds = optionIdsFor(question);
  const options = optionsFor(question);
  if (!optionIds.length || optionIds.length !== options.length) return null;
  const optionById = new Map(
    optionIds.map((id, index) => [id, options[index]]),
  );
  const labels = orderedItemIds.map((id) => optionById.get(id));
  return labels.every((label): label is string => typeof label === "string")
    ? labels.join(" -> ")
    : null;
}

function reviewAnswer(
  entry: ExamReviewEntry,
  questions: readonly ExamQuestionPayload[],
  copy: LearningUiCopy,
) {
  const answer = entry.answerSnapshot;
  if ("optionText" in answer) return answer.optionText;
  if ("optionTexts" in answer) return answer.optionTexts.join(", ");
  if ("textAnswer" in answer) return answer.textAnswer;
  return (
    orderingAnswer(entry, questions, answer.orderedItemIds) ??
    copy("exam.submittedOrder")
  );
}

function correctAnswer(
  entry: ExamReviewEntry,
  questions: readonly ExamQuestionPayload[],
) {
  const question = entry.questionSnapshot;
  if (
    (question.type === "multiple_choice" || question.type === "true_false") &&
    question.options &&
    typeof question.correctOption === "number"
  ) {
    return question.options[question.correctOption] ?? null;
  }
  if (
    question.type === "multi_select" &&
    question.options &&
    question.correctOptions
  ) {
    return question.correctOptions
      .map((index) => question.options?.[index])
      .filter(Boolean)
      .join(", ");
  }
  if (question.type === "fill_blank") {
    return question.acceptedAnswers?.join(" / ") ?? null;
  }
  return question.correctOrder
    ? orderingAnswer(entry, questions, question.correctOrder)
    : null;
}

function formatCountdown(seconds: number | null, copy: LearningUiCopy) {
  if (seconds === null) return copy("exam.noTimeLimit");
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function releaseMessage(
  mode: ExamLessonSummary["resultReleaseMode"],
  copy: LearningUiCopy,
) {
  if (mode === "immediate") {
    return copy("exam.releaseImmediate");
  }
  if (mode === "after_deadline") {
    return copy("exam.releaseDeadline");
  }
  return copy("exam.releaseManual");
}

function reviewMessage(
  mode: ExamLessonSummary["reviewReleaseMode"],
  copy: LearningUiCopy,
) {
  if (mode === "never") return copy("exam.reviewNever");
  if (mode === "after_result") {
    return copy("exam.reviewWithResult");
  }
  return copy("exam.reviewManual");
}

function accessMessage(
  mode: ExamLessonSummary["contentAccessMode"],
  copy: LearningUiCopy,
) {
  if (mode === "block_academy") {
    return copy("exam.accessAcademy");
  }
  if (mode === "block_course") {
    return copy("exam.accessCourse");
  }
  return copy("exam.accessAllowed");
}

function safePendingAttempt(attempt: ExamAttemptPayload): ExamPendingAttempt {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    deadlineAt: attempt.deadlineAt,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    finalizationReason: attempt.finalizationReason,
    resultReleaseMode: attempt.release.resultMode,
    reviewReleaseMode: attempt.release.reviewMode,
    resultReleasedAt: attempt.release.resultReleasedAt,
    reviewReleasedAt: attempt.release.reviewReleasedAt,
  };
}

function initialVisibleAttempt(summary: ExamLessonSummary) {
  if (summary.pendingAttempt) return summary.pendingAttempt;
  if (!summary.latestAttempt) return null;
  return {
    id: summary.latestAttempt.id,
    attemptNumber: summary.latestAttempt.attemptNumber,
    status: "graded" as const,
    deadlineAt: null,
    submittedAt: summary.latestAttempt.submittedAt,
    resultReleaseMode: summary.resultReleaseMode,
    reviewReleaseMode: summary.reviewReleaseMode,
    resultReleasedAt: summary.latestAttempt.submittedAt,
    reviewReleasedAt: null,
  } satisfies ExamPendingAttempt;
}

function safeResultPayload(payload: ExamResultPayload): ExamResultPayload {
  return {
    attempt: {
      id: payload.attempt.id,
      attemptNumber: payload.attempt.attemptNumber,
      status: payload.attempt.status,
      deadlineAt: payload.attempt.deadlineAt,
      submittedAt: payload.attempt.submittedAt,
      gradedAt: payload.attempt.gradedAt,
      finalizationReason: payload.attempt.finalizationReason,
      release: payload.attempt.release,
      questions: payload.attempt.questions,
    },
    result: payload.result,
    review: payload.review,
  };
}

function submissionBlocks(
  blocks: readonly ExamQuestionPayload[] | undefined,
): Block[] {
  return (blocks ?? [])
    .filter((block) => block.type === "submission")
    .map((block) => ({
      id: block.blockId,
      type: block.type,
      title: block.title,
      required: block.required,
      data: block.data,
    }));
}

export function ExamLesson({
  canInteract,
  completed,
  courseId,
  lessonId,
  lessonSummary,
  locale,
  submissions = [],
  summary,
}: {
  canInteract: boolean;
  completed: boolean;
  courseId: string;
  lessonId: string;
  lessonSummary: string | null;
  locale: AppLocale;
  submissions?: SubmissionAttempt[];
  summary: ExamLessonSummary;
}) {
  const router = useRouter();
  const copy = useMemo(() => getLearningUiCopy(locale), [locale]);
  const [attempt, setAttempt] = useState<ExamAttemptPayload | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState(() =>
    initialVisibleAttempt(summary),
  );
  const [answers, setAnswers] = useState<ExamAnswerMap>({});
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingResult, setRefreshingResult] = useState(false);
  const [result, setResult] = useState<ExamResultPayload | null>(null);
  const [supplementalBlocks, setSupplementalBlocks] = useState<Block[]>([]);
  const [lessonCompleted, setLessonCompleted] = useState(completed);
  const [completing, setCompleting] = useState(false);

  const attemptRef = useRef<ExamAttemptPayload | null>(null);
  const answersRef = useRef<ExamAnswerMap>({});
  const revisionRef = useRef(0);
  const changeSequenceRef = useRef(0);
  const queuedSequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionPanelRef = useRef<HTMLDivElement | null>(null);
  const lastSaveFailedRef = useRef(false);
  const deadlineSettledRef = useRef(false);
  const serverClockOffsetRef = useRef(0);
  const requiredSubmissionsReady = supplementalBlocks
    .filter((block) => block.required)
    .every((block) => {
      const latest = submissions
        .filter((submission) => submission.blockId === block.id)
        .sort(
          (left, right) =>
            left.attemptNumber - right.attemptNumber ||
            left.submittedAt.localeCompare(right.submittedAt),
        )
        .at(-1);
      return Boolean(latest && latest.status !== "revision");
    });
  const activeNavigationLock: ExamNavigationLock | null =
    attempt?.status === "in_progress" &&
    attempt.contentAccessMode !== "allow"
      ? {
          attemptId: attempt.id,
          courseId: attempt.courseId,
          lessonId: attempt.lessonId,
          mode: attempt.contentAccessMode,
        }
      : pendingAttempt?.status === "in_progress" || pendingAttempt === null
        ? summary.navigationLock
        : null;
  useExamNavigationLockController(activeNavigationLock);

  const request = useCallback(async <T,>(url: string, init?: RequestInit) => {
    const envelope = await examEnvelopeRequest<T>(
      url,
      copy("exam.requestError"),
      init,
    );
    if (envelope.serverTimestamp) {
      const serverNow = new Date(envelope.serverTimestamp).getTime();
      if (Number.isFinite(serverNow)) {
        serverClockOffsetRef.current = serverNow - Date.now();
      }
    }
    return envelope.data;
  }, [copy]);

  const applyAttempt = useCallback((next: ExamAttemptPayload) => {
    saveGenerationRef.current += 1;
    attemptRef.current = next;
    revisionRef.current = next.draftRevision;
    const restored = examAnswerMap(next.draftAnswers);
    answersRef.current = restored;
    changeSequenceRef.current = 0;
    queuedSequenceRef.current = 0;
    savedSequenceRef.current = 0;
    lastSaveFailedRef.current = false;
    deadlineSettledRef.current = false;
    setSupplementalBlocks(submissionBlocks(next.supplementalBlocks));
    setAttempt(next.status === "in_progress" ? next : null);
    setRemainingSeconds(
      next.status === "in_progress"
        ? remainingExamSeconds(
            next.deadlineAt,
            Date.now() + serverClockOffsetRef.current,
          )
        : null,
    );
    setAnswers(restored);
    setPendingAttempt(safePendingAttempt(next));
    setSaveStatus(next.lastSavedAt ? "saved" : "idle");
    setMessage(null);
    const firstUnanswered = next.questions
      .filter(isAutomaticExamQuestion)
      .findIndex((question) => !restored[question.blockId]);
    setActiveQuestion(firstUnanswered >= 0 ? firstUnanswered : 0);
  }, []);

  const refreshResult = useCallback(
    async (attemptId: string, quiet = false) => {
      if (!quiet) setRefreshingResult(true);
      try {
        const raw = await request<ExamResultPayload>(
          `/api/v1/me/exam-attempts/${attemptId}/result`,
        );
        if (raw.attempt.supplementalBlocks) {
          setSupplementalBlocks(
            submissionBlocks(raw.attempt.supplementalBlocks),
          );
        }
        const payload = safeResultPayload(raw);
        setResult(payload);
        setPendingAttempt({
          id: payload.attempt.id,
          attemptNumber: payload.attempt.attemptNumber,
          status: payload.attempt.status,
          deadlineAt: payload.attempt.deadlineAt,
          submittedAt: payload.attempt.submittedAt,
          finalizationReason: payload.attempt.finalizationReason,
          resultReleaseMode: payload.attempt.release.resultMode,
          reviewReleaseMode: payload.attempt.release.reviewMode,
          resultReleasedAt: payload.attempt.release.resultReleasedAt,
          reviewReleasedAt: payload.attempt.release.reviewReleasedAt,
        });
        if (!quiet) setMessage(null);
        return payload;
      } catch {
        if (!quiet) {
          setMessage(copy("exam.resultLoadError"));
        }
        return null;
      } finally {
        if (!quiet) setRefreshingResult(false);
      }
    },
    [copy, request],
  );

  const enqueueSave = useCallback(
    (
      snapshot: ExamAnswerMap,
      sequence: number,
      options?: { force?: boolean; keepalive?: boolean },
    ) => {
      if (!options?.force && sequence <= queuedSequenceRef.current) {
        return saveQueueRef.current.then(() => !lastSaveFailedRef.current);
      }
      queuedSequenceRef.current = Math.max(queuedSequenceRef.current, sequence);
      const generation = saveGenerationRef.current;
      let successful = true;
      const run = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== saveGenerationRef.current) return;
          const current = attemptRef.current;
          if (!current || current.status !== "in_progress") return;
          setSaveStatus("saving");
          try {
            const updated = await request<ExamAttemptPayload>(
              `/api/v1/me/exam-attempts/${current.id}`,
              {
                method: "PATCH",
                keepalive: options?.keepalive,
                body: JSON.stringify({
                  expectedRevision: revisionRef.current,
                  answers: examDraftAnswers(current.questions, snapshot),
                }),
              },
            );
            attemptRef.current = updated;
            revisionRef.current = updated.draftRevision;
            savedSequenceRef.current = Math.max(
              savedSequenceRef.current,
              sequence,
            );
            lastSaveFailedRef.current = false;
            setAttempt(updated.status === "in_progress" ? updated : null);
            setPendingAttempt(safePendingAttempt(updated));
            setSaveStatus(
              savedSequenceRef.current >= changeSequenceRef.current
                ? "saved"
                : "dirty",
            );
          } catch (error) {
            successful = false;
            lastSaveFailedRef.current = true;
            if (error instanceof ExamApiError && error.status === 409) {
              try {
                const fresh = await request<ExamAttemptPayload>(
                  `/api/v1/me/exam-attempts/${current.id}`,
                );
                applyAttempt(fresh);
                setSaveStatus("conflict");
                setMessage(copy("exam.draftConflict"));
              } catch {
                setSaveStatus("conflict");
                setMessage(copy("exam.draftConflictError"));
              }
            } else {
              setSaveStatus("error");
              setMessage(copy("exam.draftSaveError"));
            }
          }
        });
      saveQueueRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run.then(() => successful);
    },
    [applyAttempt, copy, request],
  );

  const scheduleAnswer = useCallback(
    (questionId: string, answer: ExamDraftAnswerPayload | null) => {
      const next = { ...answersRef.current };
      if (answer) next[questionId] = answer;
      else delete next[questionId];
      answersRef.current = next;
      setAnswers(next);
      const sequence = changeSequenceRef.current + 1;
      changeSequenceRef.current = sequence;
      lastSaveFailedRef.current = false;
      setSaveStatus("dirty");
      setMessage(null);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void enqueueSave(next, sequence);
      }, 700);
    },
    [enqueueSave],
  );

  const flushSave = useCallback(
    async (keepalive = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const sequence = changeSequenceRef.current;
      if (sequence > queuedSequenceRef.current) {
        return enqueueSave(answersRef.current, sequence, { keepalive });
      }
      await saveQueueRef.current;
      if (changeSequenceRef.current !== sequence) return false;
      if (savedSequenceRef.current >= sequence && !lastSaveFailedRef.current) {
        return true;
      }
      return enqueueSave(answersRef.current, sequence, {
        force: true,
        keepalive,
      });
    },
    [enqueueSave],
  );

  const startExam = useCallback(async () => {
    if (starting || !canInteract) return;
    setStarting(true);
    setMessage(null);
    setResult(null);
    try {
      const started = await request<ExamAttemptPayload>(
        "/api/v1/me/exam-attempts",
        {
          method: "POST",
          body: JSON.stringify({ courseId, lessonId }),
        },
      );
      applyAttempt(started);
      if (started.status !== "in_progress") {
        await refreshResult(started.id);
      }
      router.refresh();
    } catch {
      setMessage(copy("exam.startError"));
    } finally {
      setStarting(false);
    }
  }, [
    applyAttempt,
    canInteract,
    courseId,
    copy,
    lessonId,
    refreshResult,
    request,
    router,
    starting,
  ]);

  const submitExam = useCallback(async () => {
    const current = attemptRef.current;
    if (!current || submitting) return;
    const submittedAnswers = examAnswersForSubmission(
      current.questions,
      answersRef.current,
    );
    if (!submittedAnswers) {
      setMessage(copy("exam.answerAll"));
      return;
    }
    if (!requiredSubmissionsReady) {
      setMessage(copy("exam.submitRequiredFirst"));
      return;
    }
    if (!window.confirm(copy("exam.confirmSubmit"))) return;
    setSubmitting(true);
    setMessage(null);
    try {
      if (!(await flushSave())) return;
      const submitted = await request<ExamAttemptPayload>(
        `/api/v1/me/exam-attempts/${current.id}/submit`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: revisionRef.current,
            answers: submittedAnswers,
          }),
        },
      );
      attemptRef.current = submitted;
      setAttempt(null);
      setRemainingSeconds(null);
      setPendingAttempt(safePendingAttempt(submitted));
      setSaveStatus("saved");
      await refreshResult(submitted.id);
      router.refresh();
    } catch {
      setMessage(copy("exam.submitError"));
    } finally {
      setSubmitting(false);
    }
  }, [
    copy,
    flushSave,
    refreshResult,
    request,
    requiredSubmissionsReady,
    router,
    submitting,
  ]);

  const completeExamLesson = useCallback(async () => {
    if (completing || lessonCompleted) return;
    setCompleting(true);
    try {
      const response = await completeLessonAction(courseId, lessonId);
      if (response.error) setMessage(copy("lesson.completeError"));
      else {
        setLessonCompleted(true);
        setMessage(null);
        router.refresh();
      }
    } catch {
      setMessage(copy("lesson.completeError"));
    } finally {
      setCompleting(false);
    }
  }, [completing, copy, courseId, lessonCompleted, lessonId, router]);

  useEffect(() => {
    const current = attempt;
    if (!current) return;
    const tick = () =>
      setRemainingSeconds(
        remainingExamSeconds(
          current.deadlineAt,
          Date.now() + serverClockOffsetRef.current,
        ),
      );
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [attempt]);

  useEffect(() => {
    if (!attempt || remainingSeconds === null || remainingSeconds > 2) return;
    if (remainingSeconds > 0) {
      void flushSave();
      return;
    }
    if (deadlineSettledRef.current) return;
    deadlineSettledRef.current = true;
    const attemptId = attempt.id;
    void (async () => {
      await flushSave();
      try {
        const settled = await request<ExamAttemptPayload>(
          `/api/v1/me/exam-attempts/${attemptId}`,
        );
        if (settled.status === "in_progress") {
          deadlineSettledRef.current = false;
          applyAttempt(settled);
          return;
        }
        attemptRef.current = settled;
        setAttempt(null);
        setRemainingSeconds(null);
        setPendingAttempt(safePendingAttempt(settled));
        await refreshResult(settled.id);
        router.refresh();
      } catch {
        deadlineSettledRef.current = false;
        setMessage(copy("exam.deadlineSyncError"));
      }
    })();
  }, [
    applyAttempt,
    attempt,
    copy,
    flushSave,
    refreshResult,
    remainingSeconds,
    request,
    router,
  ]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saveStatus === "dirty" || saveStatus === "saving" || submitting) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus, submitting]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") void flushSave(true);
    };
    const flushOnPageHide = () => void flushSave(true);
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, [flushSave]);

  const pendingAttemptId = pendingAttempt?.id;
  const pendingAttemptStatus = pendingAttempt?.status;
  const resultReleasePending = result === null || result.result === null;
  const activeReviewMode =
    result?.attempt.release.reviewMode ??
    pendingAttempt?.reviewReleaseMode ??
    summary.reviewReleaseMode;
  const reviewReleasePending =
    result?.result !== null &&
    result?.review === null &&
    activeReviewMode !== "never";
  useEffect(() => {
    if (
      !pendingAttemptId ||
      pendingAttemptStatus === "in_progress" ||
      (!resultReleasePending && !reviewReleasePending)
    ) {
      return;
    }
    const initial = window.setTimeout(() => {
      void refreshResult(pendingAttemptId, true);
    }, 0);
    const interval = window.setInterval(() => {
      void refreshResult(pendingAttemptId, true);
    }, 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [
    pendingAttemptId,
    pendingAttemptStatus,
    refreshResult,
    resultReleasePending,
    reviewReleasePending,
  ]);

  const automaticQuestions =
    attempt?.questions.filter(isAutomaticExamQuestion) ?? [];
  const currentQuestion = automaticQuestions[activeQuestion] ?? null;
  const completedAnswers = attempt
    ? examDraftAnswers(automaticQuestions, answers).length
    : 0;
  const allAnswered = attempt
    ? examAnswersForSubmission(automaticQuestions, answers) !== null
    : false;
  const locked =
    submitting ||
    (remainingSeconds !== null && remainingSeconds <= 0) ||
    attempt?.status !== "in_progress";
  const currentAttemptWasCounted =
    pendingAttempt !== null &&
    (summary.pendingAttempt?.id === pendingAttempt.id ||
      summary.latestAttempt?.id === pendingAttempt.id);
  const attemptsUsedForView =
    summary.attemptsUsed +
    (pendingAttempt?.status === "graded" && !currentAttemptWasCounted ? 1 : 0);
  const maxAttemptsReachedForView =
    summary.maxAttempts !== null && attemptsUsedForView >= summary.maxAttempts;
  const selectQuestion = (index: number) => {
    setActiveQuestion(index);
    window.requestAnimationFrame(() => questionPanelRef.current?.focus());
  };
  const saveLabel =
    saveStatus === "saving"
      ? copy("exam.saveSaving")
      : saveStatus === "dirty"
        ? copy("exam.saveDirty")
        : saveStatus === "conflict"
          ? copy("exam.saveConflict")
          : saveStatus === "error"
            ? copy("exam.saveError")
            : copy("exam.saveSaved");
  const renderSupplementalContent = (allowInteraction: boolean) =>
    supplementalBlocks.length ? (
      <section className="mt-8 border-t border-[#dfe4e8] pt-6">
        <div className="mb-4 flex items-center gap-2">
          <FileQuestion className="size-5 text-[#b84e42]" />
          <h2 className="text-base font-bold text-[#243444]">
            {copy("submission.manual")}
          </h2>
        </div>
        <div className="space-y-4">
          {supplementalBlocks.map((block) => (
            <SubmissionBlock
              key={block.id}
              block={block}
              courseId={courseId}
              lessonId={lessonId}
              attempts={submissions.filter(
                (entry) => entry.blockId === block.id,
              )}
              canInteract={allowInteraction}
              locale={locale}
            />
          ))}
        </div>
      </section>
    ) : null;

  if (attempt && currentQuestion) {
    return (
      <div className="min-w-0">
        <header className="border-b border-[#dfe4e8] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="coral">
                {copy("common.attempt", { count: attempt.attemptNumber })}
              </Badge>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-[11px] font-semibold",
                  saveStatus === "error" || saveStatus === "conflict"
                    ? "text-[#a2473e]"
                    : "text-[#66727f]",
                )}
                aria-live="polite"
              >
                {saveStatus === "saving" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {saveLabel}
              </span>
            </div>
            <div
              className={cn(
                "inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-md border px-3 font-mono text-sm font-bold",
                remainingSeconds !== null && remainingSeconds <= 60
                  ? "border-[#efc6c1] bg-[#fff7f6] text-[#a2473e]"
                  : "border-[#dfe4e8] bg-[#f7f9fa] text-[#354555]",
              )}
              role="timer"
              aria-live="off"
            >
              <AlarmClock className="size-4" />
              {formatCountdown(remainingSeconds, copy)}
            </div>
            <span className="sr-only" aria-live="polite">
              {remainingSeconds === 60
                ? copy("exam.oneMinute")
                : remainingSeconds === 10
                  ? copy("exam.tenSeconds")
                  : remainingSeconds === 0
                    ? copy("exam.timeExpired")
                    : ""}
            </span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e7ebee]">
            <div
              className="h-full rounded-full bg-[#4f7cac] transition-[width]"
              style={{
                width: `${Math.round((completedAnswers / Math.max(1, automaticQuestions.length)) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[#66727f]">
            {copy("exam.answeredProgress", {
              answered: completedAnswers,
              total: automaticQuestions.length,
            })}
          </p>
        </header>

        <nav
          className="my-5 flex gap-2 overflow-x-auto pb-1"
          aria-label={copy("exam.questionsNavigation")}
        >
          {automaticQuestions.map((question, index) => {
            const answered = Boolean(answers[question.blockId]);
            return (
              <button
                key={question.blockId}
                type="button"
                onClick={() => selectQuestion(index)}
                className={cn(
                  "focus-ring grid size-9 shrink-0 place-items-center rounded-md border text-xs font-bold",
                  index === activeQuestion
                    ? "border-[#17324d] bg-[#17324d] text-white"
                    : answered
                      ? "border-[#b9e8e3] bg-[#edf9f7] text-[#176f68]"
                      : "border-[#dfe4e8] bg-white text-[#66727f] hover:bg-[#f5f7f8]",
                )}
                aria-current={index === activeQuestion ? "step" : undefined}
                aria-label={copy(
                  answered
                    ? "exam.questionAnswered"
                    : "exam.questionUnanswered",
                  { count: index + 1 },
                )}
              >
                {answered ? <Check className="size-4" /> : index + 1}
              </button>
            );
          })}
        </nav>

        <div
          ref={questionPanelRef}
          tabIndex={-1}
          role="group"
          aria-label={copy("exam.questionProgress", {
            current: activeQuestion + 1,
            total: automaticQuestions.length,
          })}
          className="min-h-[360px] py-5 outline-none"
        >
          <ExamQuestion
            copy={copy}
            question={currentQuestion}
            answer={answers[currentQuestion.blockId]}
            disabled={locked}
            index={activeQuestion}
            total={automaticQuestions.length}
            onAnswer={(answer) =>
              scheduleAnswer(currentQuestion.blockId, answer)
            }
          />
        </div>

        {message ? (
          <div
            className="mt-4 flex items-start gap-2 border-l-4 border-[#d3695e] bg-[#fff7f6] px-3 py-2.5 text-xs text-[#8f3d35]"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {message}
          </div>
        ) : null}

        {renderSupplementalContent(canInteract && !locked)}
        {!requiredSubmissionsReady ? (
          <p
            className="mt-4 text-xs font-semibold text-[#9f4037]"
            role="status"
          >
            {copy("exam.requiredSubmissions")}
          </p>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe4e8] pt-5">
          <Button
            type="button"
            variant="secondary"
            disabled={activeQuestion === 0 || locked}
            onClick={() => selectQuestion(Math.max(0, activeQuestion - 1))}
          >
            {copy("common.back")}
          </Button>
          {activeQuestion < automaticQuestions.length - 1 ? (
            <Button
              type="button"
              variant="navy"
              disabled={locked}
              onClick={() =>
                selectQuestion(
                  Math.min(automaticQuestions.length - 1, activeQuestion + 1),
                )
              }
            >
              {copy("common.next")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="navy"
              disabled={
                !allAnswered ||
                !requiredSubmissionsReady ||
                locked ||
                submitting
              }
              onClick={() => void submitExam()}
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {copy("exam.submit")}
            </Button>
          )}
        </footer>
      </div>
    );
  }

  if (pendingAttempt && pendingAttempt.status !== "in_progress") {
    const releasedResult = result?.result ?? null;
    const releasedReview = result?.review ?? null;
    const passed = releasedResult?.passed === true;
    const reviewMode =
      result?.attempt.release.reviewMode ??
      pendingAttempt.reviewReleaseMode ??
      summary.reviewReleaseMode;
    const resultReleaseMode =
      result?.attempt.release.resultMode ??
      pendingAttempt.resultReleaseMode ??
      summary.resultReleaseMode;
    const reviewQuestions = result?.attempt.questions ?? [];
    return (
      <div>
        <section
          className={cn(
            "border-l-4 px-5 py-5",
            releasedResult
              ? passed
                ? "border-[#2bb7a9] bg-[#edf9f7]"
                : "border-[#d3695e] bg-[#fff7f6]"
              : "border-[#4f7cac] bg-[#f4f7fa]",
          )}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {releasedResult ? (
                passed ? (
                  <ShieldCheck className="mt-0.5 size-6 shrink-0 text-[#167e74]" />
                ) : (
                  <CircleAlert className="mt-0.5 size-6 shrink-0 text-[#b84e42]" />
                )
              ) : (
                <Clock3 className="mt-0.5 size-6 shrink-0 text-[#365f8d]" />
              )}
              <div>
                <p className="text-[10px] font-bold uppercase text-[#66727f]">
                  {copy("common.attempt", {
                    count: pendingAttempt.attemptNumber,
                  })}
                </p>
                <h2 className="mt-1 text-lg font-bold text-[#243444]">
                  {releasedResult
                    ? passed
                      ? copy("exam.passed")
                      : copy("exam.failed")
                    : copy("exam.resultPending")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#52606d]">
                  {releasedResult
                    ? copy("exam.resultSummary", {
                        score: releasedResult.score,
                        correct: releasedResult.correctCount,
                        total: releasedResult.questionCount,
                      })
                    : releaseMessage(resultReleaseMode, copy)}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={refreshingResult}
              onClick={() => void refreshResult(pendingAttempt.id)}
            >
              {refreshingResult ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {copy("exam.refresh")}
            </Button>
          </div>
        </section>

        {releasedResult ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {passed && !lessonCompleted ? (
              <Button
                type="button"
                variant="navy"
                disabled={completing}
                onClick={() => void completeExamLesson()}
              >
                {completing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {copy("exam.markComplete")}
              </Button>
            ) : null}
            {!passed && !maxAttemptsReachedForView ? (
              <Button
                type="button"
                variant="navy"
                disabled={starting}
                onClick={() => void startExam()}
              >
                {starting ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {copy("exam.newAttempt")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {message ? (
          <p className="mt-4 text-sm text-[#9f4037]" role="alert">
            {message}
          </p>
        ) : null}

        <section className="mt-8 border-t border-[#dfe4e8] pt-6">
          <div className="flex items-center gap-2">
            <Eye className="size-5 text-[#365f8d]" />
            <h2 className="text-base font-bold text-[#243444]">
              {copy("exam.review")}
            </h2>
          </div>
          {releasedReview ? (
            <div className="mt-5 space-y-4">
              {releasedReview.map((entry, index) => {
                const expected = correctAnswer(entry, reviewQuestions);
                return (
                  <article
                    key={index}
                    className="border-b border-[#e5e8eb] pb-4 last:border-b-0"
                  >
                    <div className="flex items-start gap-3">
                      {entry.correct ? (
                        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#167e74]" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-5 shrink-0 text-[#b84e42]" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#243444]">
                          {entry.questionSnapshot.prompt ||
                            entry.questionSnapshot.title ||
                            copy("exam.questionDefault", { count: index + 1 })}
                        </p>
                        <p className="mt-2 text-xs text-[#52606d]">
                          {copy("exam.yourAnswer", {
                            answer: reviewAnswer(entry, reviewQuestions, copy),
                          })}
                        </p>
                        {!entry.correct && expected ? (
                          <p className="mt-1 text-xs font-semibold text-[#176f68]">
                            {copy("exam.correctAnswer", { answer: expected })}
                          </p>
                        ) : null}
                        {entry.questionSnapshot.feedback ? (
                          <p className="mt-2 text-xs leading-5 text-[#66727f]">
                            {entry.questionSnapshot.feedback}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[#66727f]">
              {reviewMessage(reviewMode, copy)}
            </p>
          )}
        </section>
        {renderSupplementalContent(canInteract)}
      </div>
    );
  }

  const resume = pendingAttempt?.status === "in_progress";
  return (
    <div>
      <section className="border-l-4 border-[#d3695e] bg-[#fff8f7] px-5 py-5">
        <div className="flex items-start gap-3">
          <FileQuestion className="mt-0.5 size-6 shrink-0 text-[#b84e42]" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-[#9f4037]">
              {copy("exam.title")}
            </p>
            <h1 className="mt-1 text-xl font-bold text-[#243444]">
              {resume
                ? copy("exam.resumeTitle")
                : copy("exam.readyTitle")}
            </h1>
            {lessonSummary ? (
              <p className="mt-2 text-sm leading-6 text-[#52606d]">
                {lessonSummary}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <dl className="mt-7 grid grid-cols-2 border-y border-[#dfe4e8] md:grid-cols-4">
        <div className="border-b border-r border-[#e5e8eb] p-4 md:border-b-0">
          <dt className="text-[10px] font-bold uppercase text-[#7d8891]">
            {copy("exam.questions")}
          </dt>
          <dd className="mt-1 text-lg font-bold text-[#243444]">
            {summary.questionCount}
          </dd>
        </div>
        <div className="border-b border-[#e5e8eb] p-4 md:border-b-0 md:border-r">
          <dt className="text-[10px] font-bold uppercase text-[#7d8891]">
            {copy("exam.time")}
          </dt>
          <dd className="mt-1 text-sm font-bold text-[#243444]">
            {formatLearningExamDuration(summary.durationSeconds, locale)}
          </dd>
        </div>
        <div className="border-r border-[#e5e8eb] p-4">
          <dt className="text-[10px] font-bold uppercase text-[#7d8891]">
            {copy("exam.passing")}
          </dt>
          <dd className="mt-1 text-lg font-bold text-[#243444]">
            {summary.passingScore} %
          </dd>
        </div>
        <div className="p-4">
          <dt className="text-[10px] font-bold uppercase text-[#7d8891]">
            {copy("exam.attempts")}
          </dt>
          <dd className="mt-1 text-sm font-bold text-[#243444]">
            {summary.maxAttempts === null
              ? copy("exam.attemptsUnlimited", {
                  used: summary.attemptsUsed,
                })
              : copy("exam.attemptsLimited", {
                  used: summary.attemptsUsed,
                  max: summary.maxAttempts,
                })}
          </dd>
        </div>
      </dl>

      <div className="mt-6 space-y-3 text-sm leading-6 text-[#52606d]">
        <p className="flex items-start gap-2">
          <Clock3 className="mt-1 size-4 shrink-0 text-[#4f7cac]" />
          {releaseMessage(summary.resultReleaseMode, copy)}
        </p>
        <p className="flex items-start gap-2">
          <Eye className="mt-1 size-4 shrink-0 text-[#4f7cac]" />
          {reviewMessage(summary.reviewReleaseMode, copy)}
        </p>
        <p className="flex items-start gap-2">
          <LockKeyhole className="mt-1 size-4 shrink-0 text-[#4f7cac]" />
          {accessMessage(summary.contentAccessMode, copy)}
        </p>
      </div>

      {resume && pendingAttempt?.deadlineAt ? (
        <p className="mt-5 text-xs font-semibold text-[#66727f]">
          {copy("exam.started", {
            date: pendingAttempt.startedAt
              ? formatDateTime(pendingAttempt.startedAt, locale)
              : copy("common.running"),
          })}
          {" | "}
          {copy("exam.deadline", {
            date: formatDateTime(pendingAttempt.deadlineAt, locale),
          })}
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 text-sm text-[#9f4037]" role="alert">
          {message}
        </p>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="navy"
          size="lg"
          disabled={
            starting || !canInteract || (!resume && maxAttemptsReachedForView)
          }
          onClick={() => void startExam()}
        >
          {starting ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : resume ? (
            <RefreshCw className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          {resume ? copy("exam.resume") : copy("exam.start")}
        </Button>
        {!resume && summary.durationSeconds !== null ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[#66727f]">
            <AlarmClock className="size-4" />
            {copy("exam.timerHint")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
