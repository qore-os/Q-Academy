import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { apiKeyPublicFields } from "@/lib/api/api-keys";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { apiKeyUpdateSchema } from "@/lib/api/schemas";
import {
  assertScopesDelegable,
  assertOwnerBoundApiKeyControl,
  forbidPrivilegeRelevantSelfPatch,
} from "@/lib/api/scope-delegation";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function keyForOrganization(id: string, organizationId: string) {
  const [key] = await db.select(apiKeyPublicFields).from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, organizationId))).limit(1);
  if (!key) throw new ApiError(404, "not_found", "API-Schluessel nicht gefunden.");
  return key;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["api_keys:read"], action: "api_key.read", resourceType: "api_key" }, async (context) => {
    const key = await keyForOrganization(id, context.organizationId);
    assertOwnerBoundApiKeyControl({
      callerScopes: context.scopes,
      ownerBoundEligible: context.ownerBoundEligible,
      targetScopes: key.scopes,
    });
    return { data: key, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["api_keys:write"], action: "api_key.update", resourceType: "api_key", idempotent: true }, async (context) => {
    const input = await parseJson(request, apiKeyUpdateSchema);
    if (input.expiresAt && input.expiresAt <= new Date()) throw new ApiError(422, "validation_error", "expiresAt muss in der Zukunft liegen.");
    const key = await db.transaction(async (tx) => {
      const [current] = await tx
        .select(apiKeyPublicFields)
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
      assertOwnerBoundApiKeyControl({
        callerScopes: context.scopes,
        ownerBoundEligible: context.ownerBoundEligible,
        targetScopes: current.scopes,
      });
      forbidPrivilegeRelevantSelfPatch(context.apiKeyId, current.id, input);
      if (input.scopes !== undefined || input.expiresAt !== undefined) {
        assertScopesDelegable(context.scopes, input.scopes ?? current.scopes);
      }
      const [updated] = await tx
        .update(apiKeys)
        .set(input)
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.organizationId, context.organizationId),
          ),
        )
        .returning(apiKeyPublicFields);
      if (!updated) {
        throw new ApiError(404, "not_found", "API-Schluessel nicht gefunden.");
      }
      return updated;
    });
    return { data: key, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["api_keys:write"], action: "api_key.revoke", resourceType: "api_key", idempotent: true }, async (context) => {
    const key = await keyForOrganization(id, context.organizationId);
    assertOwnerBoundApiKeyControl({
      callerScopes: context.scopes,
      ownerBoundEligible: context.ownerBoundEligible,
      targetScopes: key.scopes,
    });
    if (key.id === context.apiKeyId) {
      throw new ApiError(
        403,
        "forbidden",
        "Der aktuell verwendete API-Schluessel kann sich nicht selbst widerrufen.",
      );
    }
    const [revoked] = await db
      .update(apiKeys)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.organizationId, context.organizationId),
        ),
      )
      .returning(apiKeyPublicFields);
    if (!revoked) throw new ApiError(404, "not_found", "API-Schluessel nicht gefunden.");
    return { data: revoked, resourceId: id };
  });
}
