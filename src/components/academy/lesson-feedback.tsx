"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  submitLessonFeedbackAction,
  type FeedbackActionState,
} from "@/lib/feedback-actions";
import { cn } from "@/lib/utils";
import { getLearningUiCopy } from "@/lib/i18n/learning";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: FeedbackActionState = {};

export function LessonFeedback({
  courseId,
  lessonId,
  locale,
}: {
  courseId: string;
  lessonId: string;
  locale: AppLocale;
}) {
  const copy = getLearningUiCopy(locale);
  const [rating, setRating] = useState(0);
  const [state, action, pending] = useActionState(
    submitLessonFeedbackAction,
    initialState,
  );

  return (
    <section
      className="mt-10 border-t border-[#e8ebee] pt-6"
      aria-labelledby="lesson-feedback-title"
    >
      <h2
        id="lesson-feedback-title"
        className="text-sm font-bold text-[#243444]"
      >
        {copy("feedback.title")}
      </h2>
      <form action={action} className="mt-3 max-w-xl space-y-3">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="lessonId" value={lessonId} />
        <input type="hidden" name="rating" value={rating} />
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-[#52606d]">
            {copy("feedback.helpful")}
          </legend>
          <div
            className="flex gap-1"
            role="radiogroup"
            aria-label={copy("feedback.rating")}
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                disabled={pending || Boolean(state.success)}
                className="focus-ring grid size-9 place-items-center rounded-md hover:bg-[#fbf6e7]"
                aria-label={copy("feedback.stars", { value })}
                aria-checked={value === rating}
                role="radio"
              >
                <Star
                  className={cn(
                    "size-5",
                    value <= rating
                      ? "fill-[#d6a536] text-[#d6a536]"
                      : "text-[#c9d0d5]",
                  )}
                />
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#52606d]">
            {copy("feedback.comment")}{" "}
            <span className="font-normal text-[#8a949d]">
              {copy("feedback.optional")}
            </span>
          </span>
          <textarea
            name="content"
            className="focus-ring min-h-24 w-full rounded-md border border-[#dfe4e8] p-3 text-sm leading-6"
            placeholder={copy("feedback.placeholder")}
            maxLength={10_000}
            disabled={pending || Boolean(state.success)}
          />
        </label>
        <div aria-live="polite">
          {state.error ? (
            <p className="text-xs text-[#a94339]">
              {copy("feedback.error")}
            </p>
          ) : null}
          {state.success ? (
            <p className="rounded-md bg-[#e9f8f6] p-2.5 text-xs text-[#167e74]">
              {copy("feedback.success")}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={pending || rating === 0 || Boolean(state.success)}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {pending
            ? copy("feedback.sending")
            : state.success
              ? copy("feedback.sent")
              : copy("feedback.submit")}
        </Button>
      </form>
    </section>
  );
}
