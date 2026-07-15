import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contentBlocks, lessonPages, lessons, moduleSections, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { moduleUpdateSchema } from "@/lib/api/schemas";
import { publicApiContentBlock } from "@/lib/api/public-content-block";
import { lockModuleStructure } from "@/lib/module-structure-service";
import {
  getTenantLinkTarget,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function moduleForOrganization(id: string, organizationId: string) {
  const [learningModule] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, id), eq(modules.organizationId, organizationId)))
    .limit(1);
  if (!learningModule) throw new ApiError(404, "not_found", "Modul nicht gefunden.");
  return learningModule;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "module.read", resourceType: "module" }, async (context) => {
    const learningModule = await moduleForOrganization(id, context.organizationId);
    const lessonRows = await db.select().from(lessons).where(eq(lessons.moduleId, id)).orderBy(asc(lessons.sortOrder));
    const structure = await Promise.all(
      lessonRows.map(async (lesson) => ({
        ...lesson,
        blocks: (await db.select().from(contentBlocks).where(and(eq(contentBlocks.lessonId, lesson.id), isNull(contentBlocks.pageId))).orderBy(asc(contentBlocks.sortOrder))).map(publicApiContentBlock),
        pages: await Promise.all((await db.select().from(lessonPages).where(eq(lessonPages.lessonId, lesson.id)).orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id))).map(async (page) => ({ ...page, blocks: (await db.select().from(contentBlocks).where(eq(contentBlocks.pageId, page.id)).orderBy(asc(contentBlocks.sortOrder))).map(publicApiContentBlock) }))),
      })),
    );
    const sections = await db.select().from(moduleSections).where(eq(moduleSections.moduleId, id)).orderBy(asc(moduleSections.sortOrder));
    return { data: { ...learningModule, lessons: structure, sections: sections.map((section) => ({ ...section, lessons: structure.filter((lesson) => lesson.sectionId === section.id) })) }, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    { scopes: ["modules:write"], action: "module.update", resourceType: "module", idempotent: true },
    {
      prepare: () => parseJson(request, moduleUpdateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const [candidate] = await tx
          .select({
            kind: modules.kind,
            linkedCourseId: modules.linkedCourseId,
          })
          .from(modules)
          .where(
            and(
              eq(modules.id, id),
              eq(modules.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        if (!candidate) {
          throw new ApiError(404, "not_found", "Modul nicht gefunden.");
        }
        if (candidate.kind === "link") {
          await lockCourseLinkGraph(tx, context.organizationId);
          const targetCourseId =
            input.linkedCourseId ?? candidate.linkedCourseId;
          if (!targetCourseId) {
            throw new ApiError(
              422,
              "validation_error",
              "Ein Link-Modul benoetigt einen Zielkurs.",
            );
          }
          await getTenantLinkTarget(tx, {
            organizationId: context.organizationId,
            targetCourseId,
          });
        } else if (input.linkedCourseId !== undefined) {
          throw new ApiError(
            422,
            "validation_error",
            "Nur Link-Module duerfen einen Zielkurs besitzen.",
          );
        }
        await lockModuleStructure(tx, { organizationId: context.organizationId, moduleId: id });
        const [learningModule] = await tx.update(modules).set({ ...input, updatedAt: new Date() }).where(and(eq(modules.id, id), eq(modules.organizationId, context.organizationId))).returning();
        await activity({ type: "module.updated", entityType: "module", entityId: id, metadata: { changedFields: Object.keys(input).sort() } });
        return { data: learningModule, resourceId: id };
      },
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    { scopes: ["modules:write"], action: "module.delete", resourceType: "module", idempotent: true },
    {
      prepare: async () => null,
      execute: async ({ context, tx, activity }) => {
        const [candidate] = await tx
          .select({ kind: modules.kind })
          .from(modules)
          .where(
            and(
              eq(modules.id, id),
              eq(modules.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        if (!candidate) {
          throw new ApiError(404, "not_found", "Modul nicht gefunden.");
        }
        if (candidate.kind === "link") {
          await lockCourseLinkGraph(tx, context.organizationId);
        }
        const current = await lockModuleStructure(tx, { organizationId: context.organizationId, moduleId: id });
        const [deleted] = await tx.delete(modules).where(and(eq(modules.id, id), eq(modules.organizationId, context.organizationId))).returning({ id: modules.id });
        await activity({ type: "module.deleted", entityType: "module", entityId: id, metadata: { kind: current.kind } });
        return { data: { id: deleted.id, deleted: true }, resourceId: id };
      },
    },
  );
}
