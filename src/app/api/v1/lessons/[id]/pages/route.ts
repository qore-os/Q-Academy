import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lessonPages, lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { lessonPageCreateSchema } from "@/lib/api/schemas";
import { createLessonPageWithTitleSync } from "@/lib/lesson-page-title-sync-service";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertLesson(id: string, organizationId: string) {
  const [lesson] = await db.select({ id: lessons.id }).from(lessons).innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, organizationId))).where(eq(lessons.id, id)).limit(1);
  if (!lesson) throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "page.list", resourceType: "page" }, async (context) => {
    await assertLesson(id, context.organizationId);
    return { data: await db.select().from(lessonPages).where(eq(lessonPages.lessonId, id)).orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id)) };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["modules:write"],
      action: "page.create",
      resourceType: "page",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, lessonPageCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const page = await createLessonPageWithTitleSync(tx, {
          organizationId: context.organizationId,
          lessonId: id,
          page: {
            title: input.title,
            titleSyncedWithLesson: input.titleSyncedWithLesson,
            slug: (input.slug ?? slugify(input.title)) || "seite",
            sortOrder: input.sortOrder,
            status: input.status,
          },
        });
        await activity({
          type: "lesson.page.created",
          entityType: "page",
          entityId: page.id,
          metadata: {
            lessonId: id,
            titleSyncedWithLesson: page.titleSyncedWithLesson,
          },
        });
        return { data: page, status: 201, resourceId: page.id };
      },
    },
  );
}
