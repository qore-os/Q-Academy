import type { User } from "@/db/schema";

export const MFA_PROTECTED_ROLES = [
  "owner",
  "admin",
  "trainer",
] as const satisfies readonly User["role"][];

export function isMfaProtectedRole(role: User["role"]) {
  return MFA_PROTECTED_ROLES.some((protectedRole) => protectedRole === role);
}
