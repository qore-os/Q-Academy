export const COURSE_LIFECYCLE_PRESERVED_DATA = [
  "course_versions",
  "enrollments",
  "assessment_attempts",
  "submissions",
] as const;

export function courseLifecycleTransition(
  currentStatus: "draft" | "published" | "archived",
  operation: "archive" | "restore",
) {
  if (operation === "archive") {
    return currentStatus === "archived" ? null : ("archived" as const);
  }
  return currentStatus === "archived" ? ("draft" as const) : null;
}
