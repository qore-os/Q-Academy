import {
  resolveTeamPermissions,
  teamPermissionAllows,
  type TeamBaseRole,
} from "@/lib/team-permission-policy";

export function canManageCourseCategories(input: Readonly<{
  role: TeamBaseRole;
  assignmentExists: boolean;
  customRoleActive?: boolean | null;
  customPermissions?: readonly unknown[] | null;
}>) {
  if (input.role === "member") return false;
  const permissions = resolveTeamPermissions({
    baseRole: input.role,
    assignmentExists: input.assignmentExists,
    customRoleActive: input.customRoleActive,
    customPermissions: input.customPermissions,
  });
  if (!teamPermissionAllows(permissions, "courses.manage")) return false;
  return (
    input.role === "owner" ||
    input.role === "admin" ||
    input.assignmentExists
  );
}
