import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { apiKeyPublicFields, generateApiKey } from "@/lib/api/api-keys";
import { hashApiSecret } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { apiKeyCreateSchema } from "@/lib/api/schemas";
import { assertScopesDelegable } from "@/lib/api/scope-delegation";
import {
  apiScopeIsGranted,
  OWNER_BOUND_API_SCOPES,
} from "@/lib/api/scopes";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["api_keys:read"], action: "api_key.list", resourceType: "api_key" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(apiKeys.organizationId, context.organizationId)];
    for (const scope of OWNER_BOUND_API_SCOPES) {
      if (
        !context.ownerBoundEligible ||
        !apiScopeIsGranted(context.scopes, scope)
      ) {
        conditions.push(sql`not (${scope} = any(${apiKeys.scopes}))`);
      }
    }
    const search = url.searchParams.get("search")?.trim();
    const status = url.searchParams.get("status");
    if (search) conditions.push(ilike(apiKeys.name, `%${search}%`));
    if (status === "active" || status === "revoked") conditions.push(eq(apiKeys.status, status));
    const rows = await db.select(apiKeyPublicFields).from(apiKeys).where(and(...conditions)).orderBy(desc(apiKeys.createdAt)).limit(pagination.limit + 1).offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["api_keys:write"], action: "api_key.create", resourceType: "api_key", idempotent: true }, async (context) => {
    const input = await parseJson(request, apiKeyCreateSchema);
    if (input.expiresAt && input.expiresAt <= new Date()) throw new ApiError(422, "validation_error", "expiresAt muss in der Zukunft liegen.");
    assertScopesDelegable(context.scopes, input.scopes);
    const secret = generateApiKey();
    const [key] = await db.insert(apiKeys).values({
      organizationId: context.organizationId,
      name: input.name,
      prefix: secret.slice(0, 17),
      keyHash: hashApiSecret(secret),
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    }).returning(apiKeyPublicFields);
    return { data: { ...key, secret }, status: 201, resourceId: key.id, meta: { secretShownOnce: true } };
  });
}
