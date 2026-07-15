"use client";

import { useActionState } from "react";
import { Bell, BellOff, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  toggleLessonAvailabilityAction,
  type LessonAvailabilityActionState,
} from "@/lib/lesson-availability-actions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import { getLearningUiCopy } from "@/lib/i18n/learning";

export function LessonAvailabilitySubscription({
  courseId,
  courseSlug,
  lessonId,
  initialSubscribed,
  locale,
}: {
  courseId: string;
  courseSlug: string;
  lessonId: string;
  initialSubscribed: boolean;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.courseDetail;
  const learningCopy = getLearningUiCopy(locale);
  const initialState: LessonAvailabilityActionState = {
    ok: null,
    message: "",
    subscribed: initialSubscribed,
  };
  const toggleAction = toggleLessonAvailabilityAction.bind(
    null,
    courseId,
    lessonId,
    courseSlug,
  );
  const [state, submitToggle, pending] = useActionState(
    toggleAction,
    initialState,
  );
  const subscribed = state.subscribed;

  return (
    <div className="ml-10 flex min-w-0 flex-wrap items-center gap-2 pb-2.5 pr-3 md:ml-12">
      <form
        action={submitToggle}
        className="scroll-mt-20 scroll-mb-[calc(5rem+env(safe-area-inset-bottom))]"
      >
        <Button
          type="submit"
          size="sm"
          variant={subscribed ? "secondary" : "ghost"}
          disabled={pending}
          aria-label={
            subscribed
              ? copy.disableLessonNotification
              : copy.enableLessonNotification
          }
        >
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : subscribed ? (
            <BellOff className="size-3.5" />
          ) : (
            <Bell className="size-3.5" />
          )}
          {subscribed ? copy.doNotNotify : copy.notify}
        </Button>
      </form>
      {state.message ? (
        <p
          role="status"
          className={`min-w-0 text-[10px] leading-4 ${state.ok ? "text-[#167e74]" : "text-[#b8493e]"}`}
        >
          {state.ok
            ? state.subscribed
              ? learningCopy("availability.enabled")
              : learningCopy("availability.disabled")
            : learningCopy("availability.error")}
        </p>
      ) : null}
    </div>
  );
}
