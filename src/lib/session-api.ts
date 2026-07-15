import "server-only";

import { ZodError } from "zod";

import type { User } from "@/db/schema";
import { ApiError, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth";
import { getPublicAppUrl, trustProxyHeaders } from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";
import { sessionRequestId } from "@/lib/session-request-id";

export { parseSessionJson } from "@/lib/session-json";

const statusTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  422: "Unprocessable Content",
  428: "Precondition Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

function trustedMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    const supplied = new URL(origin);
    const requestUrl = new URL(request.url);
    if (supplied.origin === requestUrl.origin) return true;
    if (supplied.origin === getPublicAppUrl()) return true;
    const host = request.headers.get("host")?.trim().toLowerCase();
    const forwardedProtocol = trustProxyHeaders()
      ? request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim()
      : null;
    const protocol = `${forwardedProtocol || requestUrl.protocol.replace(":", "")}:`;
    return supplied.host.toLowerCase() === host && supplied.protocol === protocol;
  } catch {
    return false;
  }
}

function problemResponse(request: Request, id: string, error: ApiError) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/problem+json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": id,
  });
  if (
    error.status === 429 &&
    error.details &&
    typeof error.details === "object" &&
    "resetAt" in error.details
  ) {
    const resetAt = Date.parse(
      String((error.details as { resetAt: unknown }).resetAt),
    );
    if (Number.isFinite(resetAt)) {
      headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
      );
    }
  }
  return Response.json(
    {
      type: `https://q-academy.local/problems/${error.code}`,
      title: statusTitles[error.status] ?? "Request Error",
      status: error.status,
      detail: error.message,
      code: error.code,
      instance: new URL(request.url).pathname,
      requestId: id,
      errors: error.details ?? null,
    },
    {
      status: error.status,
      headers,
    },
  );
}

export function sessionData(request: Request, data: unknown, status = 200) {
  const id = sessionRequestId(request);
  return Response.json(
    { data, meta: { requestId: id, timestamp: new Date().toISOString() } },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": id,
      },
    },
  );
}

export async function handleSessionRequest(
  request: Request,
  options: { mutation?: boolean; action: string },
  handler: (user: User) => Promise<Response>,
) {
  const id = sessionRequestId(request);
  try {
    if (options.mutation && !trustedMutationOrigin(request)) {
      throw new ApiError(
        403,
        "forbidden",
        "Die Anfrage muss von der konfigurierten Anwendung stammen.",
      );
    }
    const user = await getCurrentUser();
    if (!user) {
      throw new ApiError(
        401,
        "authentication_required",
        "Eine aktive Browser-Sitzung ist erforderlich.",
      );
    }
    const response = await handler(user);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (!response.headers.has("X-Request-Id")) {
      response.headers.set("X-Request-Id", id);
    }
    return response;
  } catch (unknownError) {
    const error =
      unknownError instanceof ApiError
        ? unknownError
        : unknownError instanceof ZodError
          ? validationError(unknownError)
          : new ApiError(
              500,
              "internal_error",
              "Die Anfrage konnte nicht verarbeitet werden.",
            );
    if (!(unknownError instanceof ApiError || unknownError instanceof ZodError)) {
      logServerError(unknownError, { action: options.action, requestId: id });
    }
    return problemResponse(request, id, error);
  }
}
