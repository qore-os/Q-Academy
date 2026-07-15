export type ActiveExamContentLock = {
  attemptId: string;
  courseId: string;
  lessonId: string;
  mode: "block_course" | "block_academy";
  deadlineAt: Date | null;
};

export function activeExamBlocksContent(
  lock: ActiveExamContentLock,
  target: { courseId: string; lessonId: string },
) {
  if (
    target.courseId === lock.courseId &&
    target.lessonId === lock.lessonId
  ) {
    return false;
  }
  return (
    lock.mode === "block_academy" || target.courseId === lock.courseId
  );
}
