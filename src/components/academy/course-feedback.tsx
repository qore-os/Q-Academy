"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitCourseFeedbackAction, type FeedbackActionState } from "@/lib/feedback-actions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

const initialState: FeedbackActionState = {};

export function CourseFeedback({ courseId, locale }: { courseId: string; locale: AppLocale }) {
  const copy = getMainPageDictionary(locale).academy.courseDetail;
  const [rating, setRating] = useState(5);
  const [state, action, pending] = useActionState(submitCourseFeedbackAction, initialState);
  return <section className="panel p-5"><div className="flex items-center gap-2 text-sm font-bold text-[#243444]"><Star className="size-5 text-[#d6a536]" />{copy.feedbackTitle}</div><p className="mt-2 text-xs leading-5 text-[#71808b]">{copy.feedbackPrompt}</p><form action={action} className="mt-4 space-y-3"><input type="hidden" name="courseId" value={courseId} /><input type="hidden" name="rating" value={rating} /><div className="flex gap-1" role="radiogroup" aria-label={copy.rating}>{[1,2,3,4,5].map((value) => <button key={value} type="button" onClick={() => setRating(value)} className="focus-ring grid size-8 place-items-center rounded-md hover:bg-[#fbf6e7]" aria-label={copy.stars(value)} aria-checked={value === rating} role="radio"><Star className={cn("size-5", value <= rating ? "fill-[#d6a536] text-[#d6a536]" : "text-[#c9d0d5]")} /></button>)}</div><textarea name="content" className="focus-ring min-h-24 w-full rounded-md border border-[#dfe4e8] p-3 text-xs leading-5" placeholder={copy.feedbackPlaceholder} required /><label className="flex items-start gap-2 text-[10px] leading-4 text-[#71808b]"><input name="testimonialConsent" type="checkbox" className="mt-0.5" />{copy.testimonialConsent}</label>{state.error ? <p className="text-xs text-[#a94339]">{copy.feedbackError}</p> : null}{state.success ? <p className="rounded-md bg-[#e9f8f6] p-2.5 text-xs text-[#167e74]">{copy.feedbackSuccess}</p> : null}<Button type="submit" size="sm" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{pending ? copy.sending : copy.sendFeedback}</Button></form></section>;
}
