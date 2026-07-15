import { ZodError } from "zod";

export type ApiErrorCode =
  | "bad_request"
  | "validation_error"
  | "authentication_required"
  | "invalid_api_key"
  | "api_key_expired"
  | "insufficient_scope"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "idempotency_conflict"
  | "profile_incomplete"
  | "rate_limit_exceeded"
  | "precondition_required"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function validationError(error: ZodError) {
  return new ApiError(
    422,
    "validation_error",
    "Die Anfrage enthaelt ungueltige Felder.",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    })),
  );
}
