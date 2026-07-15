export function resolveMemberCourseModuleLink(input: {
  moduleKind: "learning" | "exam" | "link";
  linkedCourseId: string | null | undefined;
  accessibleCourseSlugsById: ReadonlyMap<string, string>;
}) {
  if (input.moduleKind !== "link") {
    return { visible: true, targetCourseSlug: null } as const;
  }
  const targetCourseSlug = input.linkedCourseId
    ? input.accessibleCourseSlugsById.get(input.linkedCourseId)
    : null;
  return targetCourseSlug
    ? { visible: true, targetCourseSlug }
    : { visible: false, targetCourseSlug: null };
}
