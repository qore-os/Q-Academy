import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { apiAuditLogs } from "@/db/schema";
import {
  authenticateApiRequest,
  type ApiContext,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { getApiAllowedOrigin } from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";

function responseHeaders(context: ApiContext) {
  return new Headers({
    "Access-Control-Allow-Origin": getApiAllowedOrigin(),
    "Access-Control-Expose-Headers":
      "Location, Accept-Ranges, Content-Range, Content-Disposition, X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
    "X-Request-Id": context.requestId,
    "X-RateLimit-Limit": String(context.rateLimit.limit),
    "X-RateLimit-Remaining": String(context.rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(context.rateLimit.resetAt / 1000)),
  });
}

async function audit(
  request: Request,
  context: ApiContext,
  action: string,
  status: number,
  started: number,
  resourceId?: string,
) {
  try {
    await db.insert(apiAuditLogs).values({
      organizationId: context.organizationId,
      apiKeyId: context.apiKeyId,
      requestId: context.requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      action,
      resourceType: "media_asset",
      resourceId,
      responseStatus: status,
      durationMs: Math.round(performance.now() - started),
      ipAddress:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      metadata: { apiKeyName: context.apiKeyName },
    });
  } catch (error) {
    logServerError(error, {
      action: "api.audit.persist",
      requestId: context.requestId,
    });
  }
}

export async function handleMediaRawResponse(
  request: Request,
  action: string,
  resourceId: string,
  handler: (context: ApiContext) => Promise<Response>,
) {
  const started = performance.now();
  let context: ApiContext | undefined;
  try {
    context = await authenticateApiRequest(request, []);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resourceId)) {
      throw new ApiError(
        400,
        "bad_request",
        "Ungueltige Media-Asset-ID im Pfad.",
      );
    }
    const response = await handler(context);
    const headers = new Headers(response.headers);
    responseHeaders(context).forEach((value, name) => {
      if (!headers.has(name)) headers.set(name, value);
    });
    await audit(request, context, action, response.status, started, resourceId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (unknownError) {
    const error =
      unknownError instanceof ApiError
        ? unknownError
        : new ApiError(
            500,
            "internal_error",
            "Die Anfrage konnte nicht verarbeitet werden.",
          );
    const requestId = context?.requestId ?? randomUUID();
    if (!(unknownError instanceof ApiError)) {
      logServerError(unknownError, { action, requestId });
    }
    if (context) {
      await audit(request, context, action, error.status, started, resourceId);
    }
    const headers = context
      ? responseHeaders(context)
      : new Headers({
          "Access-Control-Allow-Origin": getApiAllowedOrigin(),
          "Cache-Control": "private, no-store",
          Vary: "Origin",
          "X-Request-Id": requestId,
        });
    headers.set("Content-Type", "application/problem+json; charset=utf-8");
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
        title:
          ({
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            409: "Conflict",
            422: "Unprocessable Content",
            429: "Too Many Requests",
            500: "Internal Server Error",
          } as Record<number, string>)[error.status] ?? "API Error",
        status: error.status,
        detail: error.message,
        code: error.code,
        instance: new URL(request.url).pathname,
        requestId,
        errors: error.details ?? null,
      },
      { status: error.status, headers },
    );
  }
}
