export type CoursePermission = "view" | "edit" | "manage";
export type CoursePermissionRole = "owner" | "admin" | "trainer" | "member";
export type CoursePermissionRequirement = {
  courseId: string;
  required: CoursePermission;
};

const permissionRank: Record<CoursePermission, number> = {
  view: 1,
  edit: 2,
  manage: 3,
};

export function resolveCoursePermission(
  role: CoursePermissionRole,
  explicitPermission: CoursePermission | null,
): CoursePermission | null {
  if (role === "owner" || role === "admin") return "manage";
  return role === "trainer" ? explicitPermission : null;
}

export function coursePermissionAllows(
  actual: CoursePermission | null,
  required: CoursePermission,
): actual is CoursePermission {
  return Boolean(actual && permissionRank[actual] >= permissionRank[required]);
}

export function consolidateCoursePermissionRequirements(
  requirements: readonly CoursePermissionRequirement[],
) {
  const strongestByCourseId = new Map<string, CoursePermission>();
  for (const requirement of requirements) {
    const courseId = requirement.courseId.toLowerCase();
    const current = strongestByCourseId.get(courseId);
    if (
      !current ||
      permissionRank[requirement.required] > permissionRank[current]
    ) {
      strongestByCourseId.set(courseId, requirement.required);
    }
  }
  return [...strongestByCourseId]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([courseId, required]) => ({ courseId, required }));
}
