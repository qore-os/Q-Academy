import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, organizations, users } from "@/db/schema";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import { ApiError } from "@/lib/api/errors";
import {
  isEligibleOwnerBoundApiKeyOwner,
  isOwnerBoundApiScope,
  missingApiScopes,
  type ApiScope,
} from "@/lib/api/scopes";

export type ApiRateLimit = { limit: number; remaining: number; resetAt: number };

export type ApiContext = {
  requestId: string;
  organizationId: string;
  apiKeyId: string;
  apiKeyName: string;
  scopes: string[];
  ownerBoundEligible: boolean;
  rateLimit: ApiRateLimit;
};

export function hashApiSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestIdFrom(request: Request) {
  const value = request.headers.get("x-request-id");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

async function consumeRateLimit(
  organizationId: string,
  apiKeyId: string,
  method: string,
): Promise<ApiRateLimit> {
  const read = method === "GET" || method === "HEAD";
  const result = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: read ? "api_read_tenant" : "api_write_tenant",
        identifier: organizationId,
      },
    ],
    primary: {
      action: read ? "api_read" : "api_write",
      identifier: apiKeyId,
    },
  });
  if (result.limited) {
    throw new ApiError(429, "rate_limit_exceeded", "Das Ratenlimit fuer diesen API-Schluessel wurde erreicht.", {
      limit: result.limit,
      resetAt: result.resetAt.toISOString(),
    });
  }
  return {
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.resetAt.getTime(),
  };
}

export async function authenticateApiRequest(request: Request, requiredScopes: ApiScope[]): Promise<ApiContext> {
  const requestId = requestIdFrom(request);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "authentication_required", "Authorization: Bearer <api-key> ist erforderlich.");
  }
  const token = authorization.slice(7).trim();
  if (token.length < 24) throw new ApiError(401, "invalid_api_key", "Der API-Schluessel ist ungueltig.");

  const [key] = await db
    .select({
      apiKey: apiKeys,
      creatorOrganizationId: users.organizationId,
      creatorRole: users.role,
      creatorStatus: users.status,
    })
    .from(apiKeys)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, apiKeys.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .leftJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
      ),
    )
    .where(and(eq(apiKeys.keyHash, hashApiSecret(token)), eq(apiKeys.status, "active")))
    .limit(1);
  const knownProductionDemoKey =
    process.env.NODE_ENV === "production" &&
    token === "qak_demo_qacademy_2026_local_development";
  if (!key || knownProductionDemoKey) throw new ApiError(401, "invalid_api_key", "Der API-Schluessel ist ungueltig oder widerrufen.");
  const apiKey = key.apiKey;
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, "api_key_expired", "Der API-Schluessel ist abgelaufen.");
  }
  const missing = missingApiScopes(apiKey.scopes, requiredScopes);
  if (missing.length) {
    throw new ApiError(403, "insufficient_scope", "Dem API-Schluessel fehlen erforderliche Scopes.", { missing });
  }
  const requiredOwnerBoundScopes = requiredScopes.filter(isOwnerBoundApiScope);
  const ownerBoundEligible = isEligibleOwnerBoundApiKeyOwner(
    apiKey.organizationId,
    {
      organizationId: key.creatorOrganizationId,
      role: key.creatorRole,
      status: key.creatorStatus,
    },
  );
  if (
    requiredOwnerBoundScopes.length > 0 &&
    !ownerBoundEligible
  ) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "Owner-gebundene Scopes stehen diesem API-Schluessel nicht zur Verfuegung.",
      { missing: requiredOwnerBoundScopes },
    );
  }
  const rateLimit = await consumeRateLimit(
    apiKey.organizationId,
    apiKey.id,
    request.method,
  );
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, apiKey.id));
  return {
    requestId,
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.name,
    scopes: apiKey.scopes,
    ownerBoundEligible,
    rateLimit,
  };
}
