export type MediaAccessRole = "owner" | "admin" | "trainer" | "member";

type CourseMediaAccessFacts = Readonly<{
  role: MediaAccessRole;
  uploadedByActor: boolean;
  isBound: boolean;
  hasViewGrant: boolean;
  hasEditGrant?: boolean;
}>;

type SubmissionMediaAccessFacts = Readonly<{
  role: MediaAccessRole;
  uploadedByActor: boolean;
  ownedByActor: boolean;
  isBound: boolean;
  ownsSubmission: boolean;
  hasEditGrant: boolean;
}>;

function isTenantMediaAdmin(role: MediaAccessRole) {
  return role === "owner" || role === "admin";
}

export function canReadCourseMedia(input: CourseMediaAccessFacts) {
  if (isTenantMediaAdmin(input.role)) return true;
  if (input.role !== "trainer") return false;
  return input.hasViewGrant || (!input.isBound && input.uploadedByActor);
}

export function canManageCourseMedia(input: CourseMediaAccessFacts) {
  if (isTenantMediaAdmin(input.role)) return true;
  if (input.role !== "trainer") return false;
  return Boolean(input.hasEditGrant) ||
    (!input.isBound && input.uploadedByActor);
}

export function canReadSubmissionMedia(input: SubmissionMediaAccessFacts) {
  if (isTenantMediaAdmin(input.role)) return true;
  if (!input.isBound) {
    return input.uploadedByActor || input.ownedByActor;
  }
  if (input.role === "trainer") return input.hasEditGrant;
  return input.role === "member" && input.ownsSubmission;
}
