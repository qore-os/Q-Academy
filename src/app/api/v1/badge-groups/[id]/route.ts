import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { badgeGroups } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { badgeGroupUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function group(id: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(badgeGroups)
    .where(and(eq(badgeGroups.id, id), eq(badgeGroups.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "Badge-Gruppe nicht gefunden.");
  return row;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["community:read"], action: "badge_group.read", resourceType: "badge_group" },
    async (context) => ({ data: await group(id, context.organizationId), resourceId: id }),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "badge_group.update",
      resourceType: "badge_group",
      idempotent: true,
    },
    async (context) => {
      await group(id, context.organizationId);
      const input = await parseJson(request, badgeGroupUpdateSchema);
      const [updated] = await db
        .update(badgeGroups)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(badgeGroups.id, id), eq(badgeGroups.organizationId, context.organizationId)))
        .returning();
      return { data: updated, resourceId: id };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "badge_group.disable",
      resourceType: "badge_group",
      idempotent: true,
    },
    async (context) => {
      await group(id, context.organizationId);
      const [updated] = await db
        .update(badgeGroups)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(badgeGroups.id, id), eq(badgeGroups.organizationId, context.organizationId)))
        .returning();
      return { data: updated, resourceId: id };
    },
  );
}
