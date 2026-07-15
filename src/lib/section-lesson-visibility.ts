import { z } from "zod";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";

export const sectionLessonVisibilityValues = [
  "visible",
  "draft",
  "coming_soon",
] as const;

export const sectionLessonVisibilitySchema = z.enum(
  sectionLessonVisibilityValues,
);

export const sectionLessonVisibilityUpdateSchema = z
  .object({
    visibility: sectionLessonVisibilitySchema,
  })
  .strict();

export type SectionLessonVisibility = z.infer<
  typeof sectionLessonVisibilitySchema
>;

export const sectionLessonVisibilityLabels = {
  visible: "Sichtbar",
  draft: "Entwurf",
  coming_soon: "Erscheint bald",
} satisfies Record<SectionLessonVisibility, string>;

export function sectionLessonVisibilitySuccessMessage(
  visibility: SectionLessonVisibility,
  updatedLessonCount: number,
  locale: AppLocale = "de",
) {
  const copy = getCourseParityCopy(locale).visibility;
  if (updatedLessonCount === 0) {
    return copy.empty;
  }
  return copy.updated(updatedLessonCount, copy.labels[visibility]);
}
