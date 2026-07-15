import type { User } from "@/db/schema";

export const customFieldVisibilities = [
  "member",
  "trainer",
  "admin",
] as const;

export type CustomFieldVisibility = (typeof customFieldVisibilities)[number];

export const customFieldVisibilityLabels: Record<
  CustomFieldVisibility,
  string
> = {
  member: "Mitglied",
  trainer: "Trainer",
  admin: "Admin",
};

const visibilityRank: Record<CustomFieldVisibility, number> = {
  member: 0,
  trainer: 1,
  admin: 2,
};

function roleRank(role: User["role"]) {
  if (role === "owner" || role === "admin") return 2;
  if (role === "trainer") return 1;
  return 0;
}

export function canViewCustomField({
  viewerRole,
  viewerId,
  subjectUserId,
  visibility,
}: {
  viewerRole: User["role"];
  viewerId: string;
  subjectUserId: string;
  visibility: CustomFieldVisibility;
}) {
  if (viewerRole === "member" && viewerId !== subjectUserId) return false;
  return roleRank(viewerRole) >= visibilityRank[visibility];
}

export function canEditCustomField(input: {
  viewerRole: User["role"];
  viewerId: string;
  subjectUserId: string;
  visibility: CustomFieldVisibility;
}) {
  return canViewCustomField(input);
}
