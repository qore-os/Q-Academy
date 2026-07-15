import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import { db } from "@/db";
import { activityEvents, apiAuditLogs } from "@/db/schema";
import { authenticateApiRequest, type ApiContext } from "@/lib/api/auth";
import { ApiError, validationError } from "@/lib/api/errors";
import {
  BoundedJsonRequestError,
  parseBoundedJsonRequest,
  readBoundedRequestBody,
} from "@/lib/bounded-json-request";
import {
  acquireIdempotencyClaim,
  completeIdempotencyClaim,
  lockIdempotencyClaim,
  releaseIdempotencyClaim,
  startIdempotencyLease,
  type IdempotencyClaim,
} from "@/lib/api/idempotency";
import type { ApiScope, WebhookEvent } from "@/lib/api/scopes";
import { enqueueWebhook } from "@/lib/api/webhooks";
import {
  getApiAllowedOrigin,
  getPrivacySubjectHmacSecret,
} from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";
import { organizationContractDatabaseError } from "@/lib/organization-contract-errors";
import {
  assertOrganizationFeatureAvailable,
  organizationFeatureForApiAction,
} from "@/lib/organization-contracts";

export type ApiResult = {
  data: unknown;
  status?: number;
  meta?: Record<string, unknown>;
  resourceId?: string;
};

type ApiHandlerConfig = {
  scopes: ApiScope[];
  action: string;
  resourceType?: string;
  idempotent?: boolean;
};

export const API_JSON_MAX_BYTES = 1024 * 1024;

export type ApiTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ApiCommandStage =
  | "before_mutation"
  | "after_mutation"
  | "before_commit";

type ApiCommandActivity = {
  type: string;
  entityType?: string;
  entityId?: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

export type ApiCommandTools = {
  context: ApiContext;
  tx: ApiTransaction;
  activity: (input: ApiCommandActivity) => Promise<{ id: string }>;
  webhook: (
    event: WebhookEvent,
    resource: Record<string, unknown>,
  ) => Promise<Array<{ id: string }>>;
};

type TransactionalApiCommand<Prepared> = {
  prepare: (context: ApiContext) => Promise<Prepared>;
  execute: (
    tools: ApiCommandTools,
    prepared: Prepared,
  ) => Promise<ApiResult>;
  onStage?: (
    stage: ApiCommandStage,
    tools: ApiCommandTools,
  ) => void | Promise<void>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifierCollections = new Set([
  "agents",
  "agent-actions",
  "access-overrides",
  "access-requests",
  "announcements",
  "api-keys",
  "areas",
  "assessment-attempts",
  "attempts",
  "attendees",
  "audit-log",
  "badges",
  "blocks",
  "bundles",
  "chats",
  "comments",
  "course-categories",
  "courses",
  "custom-fields",
  "deliveries",
  "dismissals",
  "email-deliveries",
  "email-suppressions",
  "enrollments",
  "exam-attempts",
  "events",
  "feedback",
  "groups",
  "hubs",
  "lessons",
  "members",
  "media-assets",
  "messages",
  "modules",
  "notifications",
  "pages",
  "posts",
  "privacy-requests",
  "profiles",
  "progress",
  "reactions",
  "reorder",
  "sections",
  "spaces",
  "submissions",
  "team-roles",
  "assignments",
  "versions",
  "webhooks",
  "widgets",
]);
const staticCollectionChildren = new Set([
  "activity",
  "by-email",
  "deliveries",
  "live",
  "mark-read",
  "overview",
  "ready",
  "reorder",
  "stock-images",
  "upsert",
]);

function idempotencyRequestHash(request: Request, bodyText: string) {
  const requestMaterial = JSON.stringify([
    new URL(request.url).search,
    bodyText,
  ]);
  return createHmac("sha256", getPrivacySubjectHmacSecret())
    .update("q-academy:api-idempotency-request:v1\0")
    .update(requestMaterial)
    .digest("hex");
}

function validateIdentifiers(request: Request) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (
      identifierCollections.has(previous) &&
      !staticCollectionChildren.has(current) &&
      !uuidPattern.test(current)
    ) {
      throw new ApiError(
        400,
        "bad_request",
        `Ungueltige Ressourcen-ID im Pfad: ${current}`,
      );
    }
  }
  for (const [name, value] of url.searchParams) {
    if (
      name.toLowerCase().endsWith("id") &&
      value &&
      !uuidPattern.test(value)
    ) {
      throw new ApiError(
        400,
        "bad_request",
        `${name} muss eine gueltige UUID sein.`,
      );
    }
  }
}

function commonHeaders(context?: ApiContext) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": getApiAllowedOrigin(),
    "Access-Control-Expose-Headers":
      "X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Idempotent-Replayed",
    Vary: "Origin",
  });
  if (context) {
    headers.set("X-Request-Id", context.requestId);
    headers.set("X-RateLimit-Limit", String(context.rateLimit.limit));
    headers.set("X-RateLimit-Remaining", String(context.rateLimit.remaining));
    headers.set(
      "X-RateLimit-Reset",
      String(Math.ceil(context.rateLimit.resetAt / 1000)),
    );
  }
  return headers;
}

function envelope(context: ApiContext, result: ApiResult) {
  return {
    data: result.data,
    meta: {
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
      ...result.meta,
    },
  };
}

const statusTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Content",
  428: "Precondition Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

function throwApiRequestBodyError(error: unknown): never {
  if (!(error instanceof BoundedJsonRequestError)) throw error;
  if (error.reason === "too_large") {
    throw new ApiError(
      413,
      "bad_request",
      "Der Request-Body ist zu gross.",
    );
  }
  throw new ApiError(
    400,
    "bad_request",
    "Der Request-Body muss gueltiges JSON enthalten.",
  );
}

async function readApiRequestBodyText(request: Request) {
  try {
    const body = await readBoundedRequestBody(request, {
      maxBytes: API_JSON_MAX_BYTES,
    });
    return body.text;
  } catch (error) {
    throwApiRequestBodyError(error);
  }
}

function problemDetails(request: Request, requestId: string, error: ApiError) {
  return {
    type: `https://q-academy.local/problems/${error.code}`,
    title: statusTitles[error.status] ?? "API Error",
    status: error.status,
    detail: error.message,
    code: error.code,
    instance: new URL(request.url).pathname,
    requestId,
    errors: error.details ?? null,
  };
}

type AuditExecutor = Pick<typeof db, "insert">;

async function persistAudit(
  executor: AuditExecutor,
  request: Request,
  context: ApiContext,
  config: ApiHandlerConfig,
  status: number,
  durationMs: number,
  resourceId?: string,
) {
  await executor.insert(apiAuditLogs).values({
    organizationId: context.organizationId,
    apiKeyId: context.apiKeyId,
    requestId: context.requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    action: config.action,
    resourceType: config.resourceType,
    resourceId,
    responseStatus: status,
    durationMs,
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
    metadata: { apiKeyName: context.apiKeyName },
  });
}

async function writeAudit(
  request: Request,
  context: ApiContext,
  config: ApiHandlerConfig,
  status: number,
  durationMs: number,
  resourceId?: string,
) {
  try {
    await persistAudit(
      db,
      request,
      context,
      config,
      status,
      durationMs,
      resourceId,
    );
  } catch (error) {
    logServerError(error, {
      action: "api.audit.persist",
      requestId: context.requestId,
    });
  }
}

function commandTools(context: ApiContext, tx: ApiTransaction): ApiCommandTools {
  return {
    context,
    tx,
    async activity(input) {
      const [event] = await tx
        .insert(activityEvents)
        .values({
          organizationId: context.organizationId,
          userId: input.userId ?? null,
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: {
            ...(input.metadata ?? {}),
            source: "api",
            apiKeyId: context.apiKeyId,
          },
        })
        .returning({ id: activityEvents.id });
      return event;
    },
    webhook(event, resource) {
      return enqueueWebhook(context.organizationId, event, resource, tx);
    },
  };
}

export async function handleApi(
  request: Request,
  config: ApiHandlerConfig,
  handler: (context: ApiContext) => Promise<ApiResult>,
) {
  const started = performance.now();
  let context: ApiContext | undefined;
  try {
    context = await authenticateApiRequest(request, config.scopes);
    const contractFeature = organizationFeatureForApiAction(config.action);
    if (contractFeature) {
      await assertOrganizationFeatureAvailable(
        db,
        context.organizationId,
        contractFeature,
      );
    }
    validateIdentifiers(request);
    const bodyText = config.idempotent
      ? await readApiRequestBodyText(request)
      : "";
    const requestHash = idempotencyRequestHash(request, bodyText);
    const idempotency = config.idempotent
      ? await acquireIdempotencyClaim(request, context, requestHash)
      : { kind: "bypass" as const };
    if (idempotency.kind === "replay") {
        const headers = commonHeaders(context);
        headers.set("Idempotent-Replayed", "true");
        await writeAudit(
          request,
          context,
          config,
          idempotency.status,
          Math.round(performance.now() - started),
        );
        return new Response(idempotency.bodyText, {
          status: idempotency.status,
          headers,
        });
    }

    const claim = idempotency.kind === "claimed" ? idempotency.claim : null;
    const stopLease = claim ? startIdempotencyLease(claim) : null;
    let result: ApiResult;
    try {
      result = await handler(context);
    } catch (error) {
      stopLease?.();
      if (claim) {
        try {
          await releaseIdempotencyClaim(claim);
        } catch (releaseError) {
          logServerError(releaseError, {
            action: "api.idempotency.release",
            requestId: context.requestId,
          });
        }
      }
      throw error;
    }
    stopLease?.();
    const status = result.status ?? 200;
    const body = envelope(context, result);
    const serializedBody = JSON.stringify(body);
    if (claim) {
      await completeIdempotencyClaim(claim, status, serializedBody);
    }
    await writeAudit(
      request,
      context,
      config,
      status,
      Math.round(performance.now() - started),
      result.resourceId,
    );
    return new Response(serializedBody, {
      status,
      headers: commonHeaders(context),
    });
  } catch (unknownError) {
    const contractError = organizationContractDatabaseError(unknownError);
    const error =
      contractError ?? (unknownError instanceof ApiError
        ? unknownError
        : unknownError instanceof ZodError
          ? validationError(unknownError)
          : new ApiError(
              500,
              "internal_error",
              "Die Anfrage konnte nicht verarbeitet werden.",
            ));
    const requestId = context?.requestId ?? randomUUID();
    if (
      !contractError &&
      !(unknownError instanceof ApiError || unknownError instanceof ZodError)
    ) {
      logServerError(unknownError, {
        action: config.action,
        requestId,
      });
    }
    if (context)
      await writeAudit(
        request,
        context,
        config,
        error.status,
        Math.round(performance.now() - started),
      );
    const headers = commonHeaders(context);
    headers.set("X-Request-Id", requestId);
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
      if (Number.isFinite(resetAt))
        headers.set(
          "Retry-After",
          String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
        );
    }
    return Response.json(problemDetails(request, requestId, error), {
      status: error.status,
      headers,
    });
  }
}

export async function handleTransactionalApiCommand<Prepared>(
  request: Request,
  config: ApiHandlerConfig,
  command: TransactionalApiCommand<Prepared>,
) {
  const started = performance.now();
  let context: ApiContext | undefined;
  let claim: IdempotencyClaim | null = null;
  let stopLease: (() => void) | null = null;

  try {
    context = await authenticateApiRequest(request, config.scopes);
    const contractFeature = organizationFeatureForApiAction(config.action);
    if (contractFeature) {
      await assertOrganizationFeatureAvailable(
        db,
        context.organizationId,
        contractFeature,
      );
    }
    validateIdentifiers(request);
    const bodyText = await readApiRequestBodyText(request);
    const requestHash = idempotencyRequestHash(request, bodyText);
    const idempotency = await acquireIdempotencyClaim(
      request,
      context,
      requestHash,
    );

    if (idempotency.kind === "replay") {
      const headers = commonHeaders(context);
      headers.set("Idempotent-Replayed", "true");
      await writeAudit(
        request,
        context,
        config,
        idempotency.status,
        Math.round(performance.now() - started),
      );
      return new Response(idempotency.bodyText, {
        status: idempotency.status,
        headers,
      });
    }

    claim = idempotency.kind === "claimed" ? idempotency.claim : null;
    stopLease = claim ? startIdempotencyLease(claim) : null;
    const prepared = await command.prepare(context);
    const headers = commonHeaders(context);

    const completed = await db.transaction(async (tx) => {
      if (claim) await lockIdempotencyClaim(tx, claim);
      const tools = commandTools(context!, tx);
      await command.onStage?.("before_mutation", tools);
      const result = await command.execute(tools, prepared);
      await command.onStage?.("after_mutation", tools);

      const status = result.status ?? 200;
      const serializedBody = JSON.stringify(envelope(context!, result));
      await persistAudit(
        tx,
        request,
        context!,
        config,
        status,
        Math.round(performance.now() - started),
        result.resourceId,
      );
      if (claim) {
        await completeIdempotencyClaim(claim, status, serializedBody, tx);
      }
      await command.onStage?.("before_commit", tools);
      return { serializedBody, status };
    });

    stopLease?.();
    return new Response(completed.serializedBody, {
      status: completed.status,
      headers,
    });
  } catch (unknownError) {
    stopLease?.();
    if (claim) {
      try {
        await releaseIdempotencyClaim(claim);
      } catch (releaseError) {
        logServerError(releaseError, {
          action: "api.idempotency.release",
          requestId: context?.requestId,
        });
      }
    }

    const contractError = organizationContractDatabaseError(unknownError);
    const error =
      contractError ?? (unknownError instanceof ApiError
        ? unknownError
        : unknownError instanceof ZodError
          ? validationError(unknownError)
          : new ApiError(
              500,
              "internal_error",
              "Die Anfrage konnte nicht verarbeitet werden.",
            ));
    const requestId = context?.requestId ?? randomUUID();
    if (
      !contractError &&
      !(unknownError instanceof ApiError || unknownError instanceof ZodError)
    ) {
      logServerError(unknownError, {
        action: config.action,
        requestId,
      });
    }
    if (context) {
      await writeAudit(
        request,
        context,
        config,
        error.status,
        Math.round(performance.now() - started),
      );
    }
    const headers = commonHeaders(context);
    headers.set("X-Request-Id", requestId);
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
    return Response.json(problemDetails(request, requestId, error), {
      status: error.status,
      headers,
    });
  }
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let input: unknown;
  try {
    input = await parseBoundedJsonRequest(request, {
      maxBytes: API_JSON_MAX_BYTES,
    });
  } catch (error) {
    throwApiRequestBodyError(error);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function apiOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": getApiAllowedOrigin(),
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Idempotency-Key, Range, X-Request-Id",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
