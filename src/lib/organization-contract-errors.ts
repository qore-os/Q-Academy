import { ApiError } from "@/lib/api/errors";

function databaseConstraint(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("constraint" in error && typeof error.constraint === "string") {
    return error.constraint;
  }
  if (
    "constraint_name" in error &&
    typeof error.constraint_name === "string"
  ) {
    return error.constraint_name;
  }
  return "cause" in error ? databaseConstraint(error.cause) : undefined;
}

export function organizationContractDatabaseError(error: unknown) {
  const constraint = databaseConstraint(error);
  const messages: Record<string, string> = {
    organization_seat_limit_enforced:
      "Das vertragliche Seat-Limit dieser Academy ist erreicht.",
    organization_course_limit_enforced:
      "Das vertragliche Kurslimit dieser Academy ist erreicht.",
    organization_storage_limit_enforced:
      "Das vertragliche Media-Speicherlimit dieser Academy ist erreicht.",
  };
  return constraint && messages[constraint]
    ? new ApiError(409, "conflict", messages[constraint])
    : null;
}
