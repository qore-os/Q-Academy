import { and, asc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customFieldDefinitions, dataProfileFields } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { customFieldCreateSchema } from "@/lib/api/schemas";
import { ensureDefaultDataProfileDefinition } from "@/lib/data-profiles";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["custom_fields:read"], action: "custom_field.list", resourceType: "custom_field" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(customFieldDefinitions.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const category = url.searchParams.get("category");
    const active = url.searchParams.get("active");
    if (search) conditions.push(ilike(customFieldDefinitions.label, `%${search}%`));
    if (category) conditions.push(eq(customFieldDefinitions.category, category));
    if (active === "true" || active === "false") conditions.push(eq(customFieldDefinitions.active, active === "true"));
    const rows = await db.select().from(customFieldDefinitions).where(and(...conditions)).orderBy(asc(customFieldDefinitions.category), asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label)).limit(pagination.limit + 1).offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["custom_fields:write"], action: "custom_field.create", resourceType: "custom_field", idempotent: true }, async (context) => {
    const input = await parseJson(request, customFieldCreateSchema);
    const [duplicate] = await db.select({ id: customFieldDefinitions.id }).from(customFieldDefinitions).where(and(eq(customFieldDefinitions.organizationId, context.organizationId), eq(customFieldDefinitions.key, input.key))).limit(1);
    if (duplicate) throw new ApiError(409, "conflict", "Ein Profilfeld mit diesem Key existiert bereits.");
    const defaultDefinition = await ensureDefaultDataProfileDefinition(
      context.organizationId,
    );
    const field = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customFieldDefinitions)
        .values({ ...input, organizationId: context.organizationId })
        .returning();
      await tx.insert(dataProfileFields).values({
        organizationId: context.organizationId,
        profileDefinitionId: defaultDefinition.id,
        fieldId: created.id,
        sortOrder: created.sortOrder,
      });
      return created;
    });
    return { data: field, status: 201, resourceId: field.id };
  });
}
