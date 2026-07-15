export type ActiveExamAttemptForStartPolicy = {
  id: string;
  courseId: string;
  lessonId: string;
  contentAccessMode: "allow" | "block_course" | "block_academy";
};

export function conflictingExamAttemptForStart(
  activeAttempts: readonly ActiveExamAttemptForStartPolicy[],
  target: {
    courseId: string;
    lessonId: string;
    contentAccessMode: "allow" | "block_course" | "block_academy";
  },
) {
  const otherAttempts = activeAttempts.filter(
    (attempt) =>
      attempt.courseId !== target.courseId ||
      attempt.lessonId !== target.lessonId,
  );
  return (
    otherAttempts.find(
      (attempt) =>
        attempt.contentAccessMode === "block_academy" ||
        (attempt.contentAccessMode === "block_course" &&
          attempt.courseId === target.courseId),
    ) ??
    (target.contentAccessMode === "block_academy"
      ? otherAttempts[0]
      : target.contentAccessMode === "block_course"
        ? otherAttempts.find(
            (attempt) =>
              attempt.courseId === target.courseId ||
              attempt.contentAccessMode !== "allow",
          )
        : undefined)
  );
}
