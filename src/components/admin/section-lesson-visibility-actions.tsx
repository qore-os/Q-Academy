"use client";

import { useTransition } from "react";
import { Clock3, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setSectionLessonsVisibilityAction } from "@/lib/section-lesson-visibility-actions";
import type { SectionLessonVisibility } from "@/lib/section-lesson-visibility";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";

type SectionLessonVisibilityActionsProps = {
  courseId: string;
  sectionId: string;
  sectionTitle: string;
  lessonVisibilities: SectionLessonVisibility[];
  locale: AppLocale;
};

const actionIcons = [
  {
    visibility: "visible",
    Icon: Eye,
  },
  {
    visibility: "draft",
    Icon: EyeOff,
  },
  {
    visibility: "coming_soon",
    Icon: Clock3,
  },
] satisfies Array<{
  visibility: SectionLessonVisibility;
  Icon: typeof Eye;
}>;

export function SectionLessonVisibilityActions({
  courseId,
  sectionId,
  sectionTitle,
  lessonVisibilities,
  locale,
}: SectionLessonVisibilityActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const copy = getCourseParityCopy(locale).visibility;
  const currentVisibility = actionIcons.find(({ visibility }) =>
    lessonVisibilities.length > 0 &&
    lessonVisibilities.every((current) => current === visibility),
  )?.visibility;

  function applyVisibility(visibility: SectionLessonVisibility) {
    startTransition(async () => {
      try {
        const result = await setSectionLessonsVisibilityAction(
          courseId,
          sectionId,
          visibility,
          locale,
        );
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(result.message);
        router.refresh();
      } catch {
        toast.error(copy.genericFailure);
      }
    });
  }

  return (
    <div
      role="group"
      aria-label={copy.group(sectionTitle)}
      className="flex h-8 items-center gap-1"
    >
      {actionIcons.map(({ visibility, Icon }) => {
        const label = copy.actions[visibility];
        return (
        <Button
          key={visibility}
          type="button"
          size="sm"
          variant={currentVisibility === visibility ? "primary" : "secondary"}
          className="w-8 px-0"
          aria-label={label}
          aria-pressed={currentVisibility === visibility}
          title={label}
          disabled={pending || lessonVisibilities.length === 0}
          onClick={() => applyVisibility(visibility)}
        >
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </Button>
        );
      })}
    </div>
  );
}
