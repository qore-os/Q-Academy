import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { apiKeyPublicFields, generateApiKey } from "@/lib/api/api-keys";
import { hashApiSecret } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import {
  assertOwnerBoundApiKeyControl,
  assertScopesDelegable,
} from "@/lib/api/scope-delegation";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["api_keys:write"], action: "api_key.rotate", resourceType: "api_key", idempotent: true }, async (context) => {
    const secret = generateApiKey();
    const key = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: apiKeys.id,
          scopes: apiKeys.scopes,
          status: apiKeys.status,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.organizationId, context.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) {
        throw new ApiError(404, "not_found", "API-Schluessel nicht gefunden.");
      }
      if (current.id === context.apiKeyId) {
        throw new ApiError(
          403,
          "forbidden",
          "Der aktuell verwendete API-Schluessel kann sich nicht selbst rotieren.",
        );
      }
      if (current.status !== "active") {
        throw new ApiError(
          409,
          "conflict",
          "Nur aktive API-Schluessel koennen rotiert werden.",
        );
      }
      assertOwnerBoundApiKeyControl({
        callerScopes: context.scopes,
        ownerBoundEligible: context.ownerBoundEligible,
        targetScopes: current.scopes,
      });
      assertScopesDelegable(context.scopes, current.scopes);
      const [rotated] = await tx
        .update(apiKeys)
        .set({
          prefix: secret.slice(0, 17),
          keyHash: hashApiSecret(secret),
          lastUsedAt: null,
        })
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.organizationId, context.organizationId),
            eq(apiKeys.status, "active"),
          ),
        )
        .returning(apiKeyPublicFields);
      if (!rotated) {
        throw new ApiError(
          409,
          "conflict",
          "Nur aktive API-Schluessel koennen rotiert werden.",
        );
      }
      return rotated;
    });
    return { data: { ...key, secret }, resourceId: id, meta: { secretShownOnce: true } };
  });
}
