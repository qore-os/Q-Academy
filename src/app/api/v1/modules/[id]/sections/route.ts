import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { moduleSections, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { sectionCreateSchema } from "@/lib/api/schemas";
import { assertLearningModuleStructureMutation } from "@/lib/module-structure-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertModule(id: string, organizationId: string) {
  const [learningModule] = await db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, id), eq(modules.organizationId, organizationId))).limit(1);
  if (!learningModule) throw new ApiError(404, "not_found", "Modul nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "section.list", resourceType: "section" }, async (context) => {
    await assertModule(id, context.organizationId);
    const data = await db.select().from(moduleSections).where(eq(moduleSections.moduleId, id)).orderBy(asc(moduleSections.sortOrder), asc(moduleSections.id));
    return { data };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    { scopes: ["modules:write"], action: "section.create", resourceType: "section", idempotent: true },
    {
      prepare: () => parseJson(request, sectionCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        await assertLearningModuleStructureMutation(tx, {
          organizationId: context.organizationId,
          moduleId: id,
        });
        const [section] = await tx.insert(moduleSections).values({
          ...input,
          organizationId: context.organizationId,
          moduleId: id,
        }).returning();
        await activity({ type: "section.created", entityType: "section", entityId: section.id, metadata: { moduleId: id } });
        return { data: section, status: 201, resourceId: section.id };
      },
    },
  );
}
