import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { apiIdempotencyKeys } from "@/db/schema";
import type { ApiContext } from "@/lib/api/auth";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { logServerError } from "@/lib/server-error-logging";

const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
const PROCESSING_LEASE_MS = 60 * 1000;
const PROCESSING_HEARTBEAT_MS = 15 * 1000;
const REPLAY_WAIT_MS = 15 * 1000;
const INITIAL_POLL_MS = 40;
const MAX_POLL_MS = 400;

type RequestIdentity = {
  organizationId: string;
  apiKeyId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
};

type IdempotencyTransaction = Pick<typeof db, "select" | "update">;

export type IdempotencyClaim = RequestIdentity & {
  id: string;
  claimToken: string;
};

export type IdempotencyDecision =
  | { kind: "bypass" }
  | { kind: "claimed"; claim: IdempotencyClaim }
  | { kind: "replay"; status: number; bodyText: string };

function encryptionContext(identity: RequestIdentity) {
  return [
    "q-academy:api-idempotency:v1",
    identity.organizationId,
    identity.apiKeyId,
    identity.key,
    identity.method,
    identity.path,
    identity.requestHash,
  ].join("\n");
}

function conflict() {
  return new ApiError(
    409,
    "idempotency_conflict",
    "Dieser Idempotency-Key wurde bereits fuer eine andere Anfrage verwendet.",
  );
}

function invalidCompletedRecord(_recordId: string, cause?: unknown) {
  logServerError(cause, { action: "api.idempotency.replay" });
  return new ApiError(
    500,
    "internal_error",
    "Die gespeicherte idempotente Antwort konnte nicht verifiziert werden.",
  );
}

function assertMatchingRequest(
  existing: typeof apiIdempotencyKeys.$inferSelect,
  identity: RequestIdentity,
) {
  if (
    existing.organizationId !== identity.organizationId ||
    existing.apiKeyId !== identity.apiKeyId ||
    existing.key !== identity.key ||
    existing.method !== identity.method ||
    existing.path !== identity.path ||
    existing.requestHash !== identity.requestHash
  ) {
    throw conflict();
  }
}

function replayCompleted(
  existing: typeof apiIdempotencyKeys.$inferSelect,
  identity: RequestIdentity,
): IdempotencyDecision {
  if (
    existing.status !== "completed" ||
    existing.responseStatus === null ||
    !existing.responseBody
  ) {
    throw invalidCompletedRecord(existing.id);
  }

  try {
    const bodyText = decryptPayload(
      existing.responseBody,
      encryptionContext(identity),
    );
    JSON.parse(bodyText);
    return {
      kind: "replay",
      status: existing.responseStatus,
      bodyText,
    };
  } catch (error) {
    throw invalidCompletedRecord(existing.id, error);
  }
}

async function removeExpiredRows() {
  await db
    .delete(apiIdempotencyKeys)
    .where(lte(apiIdempotencyKeys.expiresAt, new Date()));
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function acquireIdempotencyClaim(
  request: Request,
  context: ApiContext,
  requestHash: string,
): Promise<IdempotencyDecision> {
  const key = request.headers.get("idempotency-key");
  if (!key) return { kind: "bypass" };
  if (key.length < 8 || key.length > 180) {
    throw new ApiError(
      400,
      "bad_request",
      "Idempotency-Key muss zwischen 8 und 180 Zeichen lang sein.",
    );
  }

  const identity: RequestIdentity = {
    organizationId: context.organizationId,
    apiKeyId: context.apiKeyId,
    key,
    method: request.method,
    path: new URL(request.url).pathname,
    requestHash,
  };
  const deadline = Date.now() + REPLAY_WAIT_MS;
  let pollMs = INITIAL_POLL_MS;

  while (true) {
    await removeExpiredRows();

    const claimToken = randomUUID();
    const [claimed] = await db
      .insert(apiIdempotencyKeys)
      .values({
        ...identity,
        claimToken,
        status: "processing",
        responseStatus: null,
        responseBody: null,
        expiresAt: new Date(Date.now() + PROCESSING_LEASE_MS),
      })
      .onConflictDoNothing({
        target: [
          apiIdempotencyKeys.organizationId,
          apiIdempotencyKeys.apiKeyId,
          apiIdempotencyKeys.key,
        ],
      })
      .returning({ id: apiIdempotencyKeys.id });

    if (claimed) {
      return {
        kind: "claimed",
        claim: { ...identity, id: claimed.id, claimToken },
      };
    }

    const [existing] = await db
      .select()
      .from(apiIdempotencyKeys)
      .where(
        and(
          eq(apiIdempotencyKeys.organizationId, identity.organizationId),
          eq(apiIdempotencyKeys.apiKeyId, identity.apiKeyId),
          eq(apiIdempotencyKeys.key, identity.key),
        ),
      )
      .limit(1);

    if (!existing) continue;
    assertMatchingRequest(existing, identity);
    if (existing.status === "completed") {
      return replayCompleted(existing, identity);
    }
    if (existing.status !== "processing") {
      throw invalidCompletedRecord(existing.id);
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await db
        .delete(apiIdempotencyKeys)
        .where(
          and(
            eq(apiIdempotencyKeys.id, existing.id),
            eq(apiIdempotencyKeys.status, "processing"),
            eq(apiIdempotencyKeys.claimToken, existing.claimToken),
            lte(apiIdempotencyKeys.expiresAt, new Date()),
          ),
        );
      continue;
    }

    if (Date.now() >= deadline) {
      throw new ApiError(
        409,
        "idempotency_conflict",
        "Eine identische Anfrage wird noch verarbeitet. Bitte erneut versuchen.",
        { retryAfterMs: 1000 },
      );
    }

    await wait(pollMs);
    pollMs = Math.min(MAX_POLL_MS, Math.round(pollMs * 1.5));
  }
}

export function startIdempotencyLease(claim: IdempotencyClaim) {
  let refreshing = false;
  const timer = setInterval(async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await db
        .update(apiIdempotencyKeys)
        .set({ expiresAt: new Date(Date.now() + PROCESSING_LEASE_MS) })
        .where(
          and(
            eq(apiIdempotencyKeys.id, claim.id),
            eq(apiIdempotencyKeys.claimToken, claim.claimToken),
            eq(apiIdempotencyKeys.status, "processing"),
          ),
        );
    } catch (error) {
      logServerError(error, { action: "api.idempotency.lease" });
    } finally {
      refreshing = false;
    }
  }, PROCESSING_HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export async function lockIdempotencyClaim(
  executor: IdempotencyTransaction,
  claim: IdempotencyClaim,
) {
  const [locked] = await executor
    .select({ id: apiIdempotencyKeys.id })
    .from(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.id, claim.id),
        eq(apiIdempotencyKeys.claimToken, claim.claimToken),
        eq(apiIdempotencyKeys.status, "processing"),
      ),
    )
    .limit(1)
    .for("update");

  if (!locked) {
    throw new ApiError(
      500,
      "internal_error",
      "Der idempotente Auftrag konnte nicht sicher gesperrt werden.",
    );
  }
}

export async function releaseIdempotencyClaim(claim: IdempotencyClaim) {
  await db
    .delete(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.id, claim.id),
        eq(apiIdempotencyKeys.claimToken, claim.claimToken),
        eq(apiIdempotencyKeys.status, "processing"),
      ),
    );
}

export async function completeIdempotencyClaim(
  claim: IdempotencyClaim,
  responseStatus: number,
  bodyText: string,
  executor: Pick<typeof db, "update"> = db,
) {
  const responseBody = encryptPayload(
    bodyText,
    encryptionContext(claim),
  );
  const [completed] = await executor
    .update(apiIdempotencyKeys)
    .set({
      status: "completed",
      responseStatus,
      responseBody,
      expiresAt: new Date(Date.now() + COMPLETED_TTL_MS),
    })
    .where(
      and(
        eq(apiIdempotencyKeys.id, claim.id),
        eq(apiIdempotencyKeys.claimToken, claim.claimToken),
        eq(apiIdempotencyKeys.status, "processing"),
      ),
    )
    .returning({ id: apiIdempotencyKeys.id });

  if (!completed) {
    throw new ApiError(
      500,
      "internal_error",
      "Die idempotente Antwort konnte nicht sicher gespeichert werden.",
    );
  }
}
