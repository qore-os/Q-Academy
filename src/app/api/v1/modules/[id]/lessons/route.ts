import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { lessonCreateSchema } from "@/lib/api/schemas";
import { assertLearningModuleStructureMutation } from "@/lib/module-structure-service";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertModule(id: string, organizationId: string) {
  const [learningModule] = await db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, id), eq(modules.organizationId, organizationId))).limit(1);
  if (!learningModule) throw new ApiError(404, "not_found", "Modul nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "lesson.list", resourceType: "lesson" }, async (context) => {
    await assertModule(id, context.organizationId);
    const data = await db.select().from(lessons).where(eq(lessons.moduleId, id)).orderBy(asc(lessons.sortOrder));
    return { data };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    { scopes: ["modules:write"], action: "lesson.create", resourceType: "lesson", idempotent: true },
    {
      prepare: () => parseJson(request, lessonCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        await assertLearningModuleStructureMutation(tx, {
          organizationId: context.organizationId,
          moduleId: id,
        });
        const slug = input.slug ?? slugify(input.title);
        const [duplicate] = await tx.select({ id: lessons.id }).from(lessons).where(and(eq(lessons.moduleId, id), eq(lessons.slug, slug))).limit(1);
        if (duplicate) throw new ApiError(409, "conflict", "Eine Lektion mit diesem Slug existiert bereits im Modul.");
        const [lesson] = await tx.insert(lessons).values({
          ...input,
          organizationId: context.organizationId,
          moduleId: id,
          slug,
        }).returning();
        await activity({ type: "lesson.created", entityType: "lesson", entityId: lesson.id, metadata: { moduleId: id } });
        return { data: lesson, status: 201, resourceId: lesson.id };
      },
    },
  );
}
