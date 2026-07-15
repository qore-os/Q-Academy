import type { LearningItemAccess } from "@/lib/course-module-access-policy";

export function canSubmitLessonFeedback(
  access: Pick<LearningItemAccess, "canOpen"> | null | undefined,
) {
  return access?.canOpen === true;
}

