export type SharedModuleCoursePermission = "view" | "edit" | "manage";

export function canMutateSharedModuleContent(input: {
  actorRole: "owner" | "admin" | "trainer" | "member";
  referencedCoursePermissions: readonly (
    | SharedModuleCoursePermission
    | null
  )[];
}) {
  if (input.actorRole === "owner" || input.actorRole === "admin") return true;
  if (input.actorRole !== "trainer") return false;
  return input.referencedCoursePermissions.every(
    (permission) => permission === "edit" || permission === "manage",
  );
}

export function canUseLinkModuleTarget(input: {
  actorRole: "owner" | "admin" | "trainer" | "member";
  targetCoursePermission: SharedModuleCoursePermission | null;
}) {
  if (input.actorRole === "owner" || input.actorRole === "admin") return true;
  return input.actorRole === "trainer" && input.targetCoursePermission !== null;
}
