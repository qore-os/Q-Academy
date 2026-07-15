"use client";

import { useActionState, useEffect, useState } from "react";
import {
  BookOpen,
  LoaderCircle,
  Plus,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCourseAction, type ActionState } from "@/lib/actions";
import {
  createAiCourseAction,
  type AiCourseActionState,
} from "@/lib/admin/ai-course-actions";
import { cn } from "@/lib/utils";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import type { AppLocale } from "@/lib/i18n/model";

type Category = { id: string; name: string };
type CreationMode = "manual" | "ai";
type AiBriefValues = {
  topic: string;
  targetAudience: string;
  learningGoal: string;
  level: "beginner" | "intermediate" | "advanced" | "mixed";
  tone: "practical" | "professional" | "motivating" | "concise";
  scope: "compact" | "standard" | "intensive";
  categoryId: string;
};

const inputClassName =
  "focus-ring h-10 min-w-0 w-full max-w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";
const textareaClassName =
  "focus-ring min-w-0 w-full max-w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#243444]";
const labelClassName = "mb-1.5 block text-xs font-semibold text-[#354555]";

function CategorySelect({ categories, locale }: { categories: Category[]; locale: AppLocale }) {
  const copy = getCourseSupportCopy(locale).creation;
  return (
    <label className="block">
      <span className={labelClassName}>{copy.category}</span>
      <select name="categoryId" className={inputClassName} defaultValue="">
        <option value="">{copy.noCategory}</option>
        {categories.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionError({ message }: { message?: string }) {
  return message ? (
    <p
      className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2 text-xs text-[#a94339]"
      role="alert"
      aria-live="polite"
    >
      {message}
    </p>
  ) : null;
}

export function CourseCreationDialog({
  categories,
  locale,
  onClose,
}: {
  categories: Category[];
  locale: AppLocale;
  onClose: () => void;
}) {
  const copy = getCourseSupportCopy(locale).creation;
  const [mode, setMode] = useState<CreationMode>("manual");
  const [aiBrief, setAiBrief] = useState<AiBriefValues>({
    topic: "",
    targetAudience: "",
    learningGoal: "",
    level: "beginner",
    tone: "practical",
    scope: "standard",
    categoryId: "",
  });
  const [manualState, manualAction, manualPending] = useActionState(
    createCourseAction,
    {} as ActionState,
  );
  const [aiState, aiAction, aiPending] = useActionState(
    createAiCourseAction,
    {} as AiCourseActionState,
  );
  const pending = manualPending || aiPending;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-[#0f263c]/45 p-3 sm:p-4">
      <div
        className="grid max-h-[calc(100dvh-1.5rem)] min-w-0 w-full max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-md border border-[#dce1e5] bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-course-title"
      >
        <div className="flex items-center justify-between border-b border-[#e8ebee] bg-white px-4 py-4 sm:px-5">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.eyebrow}
            </p>
            <h2
              id="new-course-title"
              className="mt-0.5 text-lg font-bold text-[#243444]"
            >
              {copy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.close}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="border-b border-[#edf0f2] px-4 py-3 sm:px-5">
          <div
            className="grid grid-cols-2 rounded-md border border-[#dfe4e8] bg-[#f4f6f7] p-1"
            role="group"
            aria-label={copy.mode}
          >
            <button
              type="button"
              onClick={() => setMode("manual")}
              disabled={pending}
              aria-pressed={mode === "manual"}
              className={cn(
                "focus-ring flex h-9 items-center justify-center gap-2 rounded text-xs font-semibold",
                mode === "manual"
                  ? "bg-white text-[#17324d] shadow-sm"
                  : "text-[#66727f] hover:text-[#243444]",
              )}
            >
              <BookOpen className="size-4" />
              {copy.manual}
            </button>
            <button
              type="button"
              onClick={() => setMode("ai")}
              disabled={pending}
              aria-pressed={mode === "ai"}
              className={cn(
                "focus-ring flex h-9 items-center justify-center gap-2 rounded text-xs font-semibold",
                mode === "ai"
                  ? "bg-white text-[#17324d] shadow-sm"
                  : "text-[#66727f] hover:text-[#243444]",
              )}
            >
              <WandSparkles className="size-4" />
              {copy.aiAssistant}
            </button>
          </div>
        </div>

        {mode === "manual" ? (
          <form
            key="manual"
            action={manualAction}
            className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]"
          >
            <input type="hidden" name="locale" value={locale} />
            <div className="min-w-0 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:p-5">
              <label className="block min-w-0">
                <span className={labelClassName}>{copy.courseTitle}</span>
                <input
                  name="title"
                  className={inputClassName}
                  placeholder={copy.courseTitlePlaceholder}
                  minLength={3}
                  maxLength={220}
                  autoFocus
                  required
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClassName}>{copy.description}</span>
                <textarea
                  name="description"
                  className={cn(textareaClassName, "min-h-24")}
                  placeholder={copy.descriptionPlaceholder}
                  minLength={10}
                  maxLength={500}
                  required
                />
              </label>
              <CategorySelect categories={categories} locale={locale} />
              <ActionError message={manualState.error} />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] p-4 sm:flex-row sm:justify-end sm:px-5">
              <Button
                variant="secondary"
                type="button"
                onClick={onClose}
                disabled={manualPending}
                className="w-full sm:w-auto"
              >
                {getCourseSupportCopy(locale).common.cancel}
              </Button>
              <Button
                type="submit"
                disabled={manualPending}
                className="w-full sm:w-auto"
              >
                {manualPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {manualPending ? copy.creating : copy.createCourse}
              </Button>
            </div>
          </form>
        ) : (
          <form
            key="ai"
            action={aiAction}
            onReset={(event) => event.preventDefault()}
            className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]"
          >
            <input type="hidden" name="locale" value={locale} />
            <div className="grid min-w-0 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:grid-cols-2 sm:p-5">
              <label className="block min-w-0 sm:col-span-2">
                <span className={labelClassName}>{copy.topic}</span>
                <input
                  name="topic"
                  className={inputClassName}
                  placeholder={copy.topicPlaceholder}
                  value={aiBrief.topic}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      topic: event.target.value,
                    }))
                  }
                  minLength={3}
                  maxLength={180}
                  autoFocus
                  required
                />
              </label>
              <label className="block min-w-0 sm:col-span-2">
                <span className={labelClassName}>{copy.audience}</span>
                <textarea
                  name="targetAudience"
                  className={cn(textareaClassName, "min-h-20")}
                  placeholder={copy.audiencePlaceholder}
                  value={aiBrief.targetAudience}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      targetAudience: event.target.value,
                    }))
                  }
                  minLength={3}
                  maxLength={300}
                  required
                />
              </label>
              <label className="block min-w-0 sm:col-span-2">
                <span className={labelClassName}>{copy.learningGoal}</span>
                <textarea
                  name="learningGoal"
                  className={cn(textareaClassName, "min-h-24")}
                  placeholder={copy.learningGoalPlaceholder}
                  value={aiBrief.learningGoal}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      learningGoal: event.target.value,
                    }))
                  }
                  minLength={10}
                  maxLength={500}
                  required
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClassName}>{copy.level}</span>
                <select
                  name="level"
                  className={inputClassName}
                  value={aiBrief.level}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      level: event.target.value as AiBriefValues["level"],
                    }))
                  }
                >
                  <option value="beginner">{copy.levels.beginner}</option>
                  <option value="intermediate">{copy.levels.intermediate}</option>
                  <option value="advanced">{copy.levels.advanced}</option>
                  <option value="mixed">{copy.levels.mixed}</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className={labelClassName}>{copy.tone}</span>
                <select
                  name="tone"
                  className={inputClassName}
                  value={aiBrief.tone}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      tone: event.target.value as AiBriefValues["tone"],
                    }))
                  }
                >
                  <option value="practical">{copy.tones.practical}</option>
                  <option value="professional">{copy.tones.professional}</option>
                  <option value="motivating">{copy.tones.motivating}</option>
                  <option value="concise">{copy.tones.concise}</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className={labelClassName}>{copy.scope}</span>
                <select
                  name="scope"
                  className={inputClassName}
                  value={aiBrief.scope}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      scope: event.target.value as AiBriefValues["scope"],
                    }))
                  }
                >
                  <option value="compact">{copy.scopes.compact}</option>
                  <option value="standard">{copy.scopes.standard}</option>
                  <option value="intensive">{copy.scopes.intensive}</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className={labelClassName}>{copy.category}</span>
                <select
                  name="categoryId"
                  className={inputClassName}
                  value={aiBrief.categoryId}
                  onChange={(event) =>
                    setAiBrief((current) => ({
                      ...current,
                      categoryId: event.target.value,
                    }))
                  }
                >
                  <option value="">{copy.noCategory}</option>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {aiState.error ? (
                <div className="sm:col-span-2">
                  <ActionError message={aiState.error} />
                </div>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] p-4 sm:flex-row sm:justify-end sm:px-5">
              <Button
                variant="secondary"
                type="button"
                onClick={onClose}
                disabled={aiPending}
                className="w-full sm:w-auto"
              >
                {getCourseSupportCopy(locale).common.cancel}
              </Button>
              <Button
                type="submit"
                disabled={aiPending}
                className="w-full sm:w-auto"
              >
                {aiPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <WandSparkles className="size-4" />
                )}
                {aiPending ? copy.generating : copy.generate}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
