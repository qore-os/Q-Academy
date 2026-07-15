import "server-only";

import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import type { User } from "@/db/schema";
import { ApiError, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth";
import { logServerError } from "@/lib/server-error-logging";
import { trustProxyHeaders } from "@/lib/server-environment";

const statusTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};
const MAX_SESSION_JSON_BYTES = 16 * 1024;

function requestId(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[0-9a-f-]{36}$/i.test(supplied)
    ? supplied
    : randomUUID();
}

function trustedMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const supplied = new URL(origin);
      const requestUrl = new URL(request.url);
      if (supplied.origin === requestUrl.origin) return true;
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
  return request.headers.get("sec-fetch-site") === "same-origin";
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
    { status: error.status, headers },
  );
}

export function sessionMediaData(
  request: Request,
  data: unknown,
  status = 200,
) {
  const id = requestId(request);
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

export async function parseSessionMediaJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(
      400,
      "bad_request",
      "Content-Type muss application/json sein.",
    );
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_SESSION_JSON_BYTES)
  ) {
    throw new ApiError(
      413,
      "bad_request",
      "Der Request-Body ist zu gross.",
    );
  }
  if (!request.body) {
    throw new ApiError(400, "bad_request", "Der Request-Body fehlt.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      if (request.signal.aborted) {
        throw new ApiError(400, "bad_request", "Die Anfrage wurde abgebrochen.");
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_SESSION_JSON_BYTES) {
        throw new ApiError(
          413,
          "bad_request",
          "Der Request-Body ist zu gross.",
        );
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "bad_request",
      "Der Request-Body muss gueltiges JSON enthalten.",
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function handleSessionMediaRequest(
  request: Request,
  options: { mutation?: boolean; action: string },
  handler: (user: User) => Promise<Response>,
) {
  const id = requestId(request);
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
              "Die Media-Anfrage konnte nicht verarbeitet werden.",
            );
    if (!(unknownError instanceof ApiError || unknownError instanceof ZodError)) {
      logServerError(unknownError, { action: options.action, requestId: id });
    }
    return problemResponse(request, id, error);
  }
}
