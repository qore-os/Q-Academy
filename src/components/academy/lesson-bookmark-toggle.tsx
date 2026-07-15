"use client";

import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import {
  setLessonBookmarkAction,
  type LessonBookmarkActionState,
} from "@/lib/lesson-bookmark-actions";
import { getLearningUiCopy } from "@/lib/i18n/learning";
import type { AppLocale } from "@/lib/i18n/model";

export function LessonBookmarkToggle({
  courseId,
  moduleId,
  lessonId,
  initialBookmarked,
  locale,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  initialBookmarked: boolean;
  locale: AppLocale;
}) {
  const copy = getLearningUiCopy(locale);
  const initialState: LessonBookmarkActionState = {
    status: "idle",
    bookmarked: initialBookmarked,
    message: "",
  };
  const [state, action, pending] = useActionState(
    (previousState: LessonBookmarkActionState) =>
      setLessonBookmarkAction(
        {
          courseId,
          moduleId,
          lessonId,
          bookmarked: !previousState.bookmarked,
        },
        previousState,
      ),
    initialState,
  );
  const bookmarked = state.status === "idle" ? initialBookmarked : state.bookmarked;

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        aria-pressed={bookmarked}
        aria-label={
          bookmarked ? copy("bookmark.remove") : copy("bookmark.add")
        }
        title={bookmarked ? copy("bookmark.remove") : copy("bookmark.add")}
        className="focus-ring flex h-8 items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-2.5 text-[11px] font-semibold text-[#52606d] hover:bg-[#f1f5f7] disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : bookmarked ? (
          <BookmarkCheck className="size-3.5 text-[#2b9188]" />
        ) : (
          <Bookmark className="size-3.5" />
        )}
        <span className="hidden sm:inline">
          {bookmarked
            ? copy("bookmark.shortRemove")
            : copy("bookmark.shortAdd")}
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {state.status === "saved"
          ? state.bookmarked
            ? copy("bookmark.saved")
            : copy("bookmark.removed")
          : state.status === "error"
            ? copy("bookmark.error")
            : ""}
      </span>
    </form>
  );
}
