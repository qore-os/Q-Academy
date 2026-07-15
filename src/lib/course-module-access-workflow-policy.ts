import type { LearningItemAccess } from "@/lib/course-module-access-policy";

export type ModuleAccessWorkflowTarget = Pick<
  LearningItemAccess,
  "state" | "listed" | "requestable" | "requestStatus"
>;

export function canCreateModuleAccessRequest(
  access: ModuleAccessWorkflowTarget,
) {
  return (
    access.state === "locked" &&
    access.listed &&
    access.requestable &&
    access.requestStatus !== "pending"
  );
}

export function canDecideModuleAccessRequest(
  access: ModuleAccessWorkflowTarget,
  requestAccessEnabled: boolean,
) {
  return (
    access.state === "locked" &&
    access.listed &&
    requestAccessEnabled &&
    access.requestStatus === "pending"
  );
}

export function isRepublishedAccessRequest(input: {
  requestedAt: Date;
  publishedAt: Date;
}) {
  return input.publishedAt.getTime() > input.requestedAt.getTime();
}

export function isFutureWorkflowExpiry(
  expiresAt: Date | null | undefined,
  now: Date,
) {
  return !expiresAt || expiresAt.getTime() > now.getTime();
}
