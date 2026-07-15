import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contentBlocks, lessonPages, lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { lessonUpdateSchema } from "@/lib/api/schemas";
import {
  deleteLessonWithTitleSync,
  updateLessonWithTitleSync,
} from "@/lib/lesson-page-title-sync-service";
import { publicApiContentBlock } from "@/lib/api/public-content-block";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function lessonForOrganization(id: string, organizationId: string) {
  const [row] = await db
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, organizationId)))
    .where(eq(lessons.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
  return row.lesson;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "lesson.read", resourceType: "lesson" }, async (context) => {
    const lesson = await lessonForOrganization(id, context.organizationId);
    const blocks = await db.select().from(contentBlocks).where(and(eq(contentBlocks.lessonId, id), isNull(contentBlocks.pageId))).orderBy(asc(contentBlocks.sortOrder));
    const pages = await Promise.all((await db.select().from(lessonPages).where(eq(lessonPages.lessonId, id)).orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id))).map(async (page) => ({ ...page, blocks: await db.select().from(contentBlocks).where(eq(contentBlocks.pageId, page.id)).orderBy(asc(contentBlocks.sortOrder)) })));
    return { data: { ...lesson, blocks: blocks.map(publicApiContentBlock), pages: pages.map((page) => ({ ...page, blocks: page.blocks.map(publicApiContentBlock) })) }, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["modules:write"],
      action: "lesson.update",
      resourceType: "lesson",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, lessonUpdateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const lesson = await updateLessonWithTitleSync(tx, {
          organizationId: context.organizationId,
          lessonId: id,
          lesson: input,
        });
        await activity({
          type: "lesson.updated",
          entityType: "lesson",
          entityId: lesson.id,
          metadata: { changedFields: Object.keys(input).sort() },
        });
        return { data: lesson, resourceId: lesson.id };
      },
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["modules:write"],
      action: "lesson.delete",
      resourceType: "lesson",
      idempotent: true,
    },
    {
      prepare: async () => null,
      execute: async ({ context, tx, activity }) => {
        const lesson = await deleteLessonWithTitleSync(tx, {
          organizationId: context.organizationId,
          lessonId: id,
        });
        await activity({
          type: "lesson.deleted",
          entityType: "lesson",
          entityId: lesson.id,
          metadata: { moduleId: lesson.moduleId },
        });
        return { data: { id, deleted: true }, resourceId: id };
      },
    },
  );
}
