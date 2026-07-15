import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lessons, moduleSections, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { lessonCreateSchema } from "@/lib/api/schemas";
import { assertLearningModuleStructureMutation } from "@/lib/module-structure-service";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function sectionForOrganization(id: string, organizationId: string) {
  const [section] = await db.select({ id: moduleSections.id, moduleId: moduleSections.moduleId }).from(moduleSections).innerJoin(modules, and(eq(modules.id, moduleSections.moduleId), eq(modules.organizationId, organizationId))).where(eq(moduleSections.id, id)).limit(1);
  if (!section) throw new ApiError(404, "not_found", "Sektion nicht gefunden.");
  return section;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "section.lesson.list", resourceType: "lesson" }, async (context) => {
    await sectionForOrganization(id, context.organizationId);
    return { data: await db.select().from(lessons).where(eq(lessons.sectionId, id)).orderBy(asc(lessons.sortOrder)) };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    { scopes: ["modules:write"], action: "section.lesson.create", resourceType: "lesson", idempotent: true },
    {
      prepare: () => parseJson(request, lessonCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const [section] = await tx.select({ id: moduleSections.id, moduleId: moduleSections.moduleId }).from(moduleSections).innerJoin(modules, and(eq(modules.id, moduleSections.moduleId), eq(modules.organizationId, context.organizationId))).where(eq(moduleSections.id, id)).limit(1);
        if (!section) throw new ApiError(404, "not_found", "Sektion nicht gefunden.");
        await assertLearningModuleStructureMutation(tx, {
          organizationId: context.organizationId,
          moduleId: section.moduleId,
        });
        const slug = input.slug ?? slugify(input.title);
        const [duplicate] = await tx.select({ id: lessons.id }).from(lessons).where(and(eq(lessons.moduleId, section.moduleId), eq(lessons.slug, slug))).limit(1);
        if (duplicate) throw new ApiError(409, "conflict", "Eine Lektion mit diesem Slug existiert bereits im Modul.");
        const [lesson] = await tx.insert(lessons).values({
          ...input,
          organizationId: context.organizationId,
          moduleId: section.moduleId,
          sectionId: id,
          slug,
        }).returning();
        await activity({ type: "lesson.created", entityType: "lesson", entityId: lesson.id, metadata: { moduleId: section.moduleId, sectionId: id } });
        return { data: lesson, status: 201, resourceId: lesson.id };
      },
    },
  );
}
