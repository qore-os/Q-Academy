import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentBlocks, lessonPages, lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { lessonPageUpdateSchema } from "@/lib/api/schemas";
import {
  deleteLessonPageWithTitleSync,
  updateLessonPageWithTitleSync,
} from "@/lib/lesson-page-title-sync-service";
import { publicApiContentBlock } from "@/lib/api/public-content-block";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function requiredRevisionHeader(request: Request) {
  const value = request.headers.get("if-match")?.trim() ?? "";
  const match = /^(?:"([1-9]\d*)"|([1-9]\d*))$/.exec(value);
  const revision = Number(match?.[1] ?? match?.[2]);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ApiError(
      400,
      "validation_error",
      'If-Match muss die aktuelle Seitenrevision enthalten, zum Beispiel "3".',
    );
  }
  return revision;
}

async function pageForOrganization(id: string, organizationId: string) {
  const [row] = await db.select({ page: lessonPages }).from(lessonPages).innerJoin(lessons, eq(lessons.id, lessonPages.lessonId)).innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, organizationId))).where(eq(lessonPages.id, id)).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Seite nicht gefunden.");
  return row.page;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "page.read", resourceType: "page" }, async (context) => {
    const page = await pageForOrganization(id, context.organizationId);
    const blocks = await db.select().from(contentBlocks).where(eq(contentBlocks.pageId, id)).orderBy(asc(contentBlocks.sortOrder));
    return { data: { ...page, blocks: blocks.map(publicApiContentBlock) }, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["modules:write"],
      action: "page.update",
      resourceType: "page",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, lessonPageUpdateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const { revision, ...changes } = input;
        const page = await updateLessonPageWithTitleSync(tx, {
          organizationId: context.organizationId,
          pageId: id,
          page: changes,
          expectedRevision: revision,
        });
        await activity({
          type: "lesson.page.updated",
          entityType: "page",
          entityId: page.id,
          metadata: {
            lessonId: page.lessonId,
            titleSyncedWithLesson: page.titleSyncedWithLesson,
            changedFields: Object.keys(changes).sort(),
          },
        });
        return { data: page, resourceId: page.id };
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
      action: "page.delete",
      resourceType: "page",
      idempotent: true,
    },
    {
      prepare: async () => null,
      execute: async ({ context, tx, activity }) => {
        const page = await deleteLessonPageWithTitleSync(tx, {
          organizationId: context.organizationId,
          pageId: id,
          expectedRevision: requiredRevisionHeader(request),
        });
        await activity({
          type: "lesson.page.deleted",
          entityType: "page",
          entityId: page.id,
          metadata: { lessonId: page.lessonId },
        });
        return { data: { id, deleted: true }, resourceId: id };
      },
    },
  );
}
