import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentBlocks, lessonPages, lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { contentBlockCreateSchema } from "@/lib/api/schemas";
import { assertActiveDataFormBlock } from "@/lib/api/content-block-forms";
import { assertPublishedAiAgentContentBlock } from "@/lib/api/content-block-ai-agent";
import { publicApiContentBlock } from "@/lib/api/public-content-block";
import { assertContentBlockMedia } from "@/lib/api/content-block-media";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function pageForOrganization(id: string, organizationId: string) {
  const [page] = await db.select({ id: lessonPages.id, lessonId: lessonPages.lessonId }).from(lessonPages).innerJoin(lessons, eq(lessons.id, lessonPages.lessonId)).innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, organizationId))).where(eq(lessonPages.id, id)).limit(1);
  if (!page) throw new ApiError(404, "not_found", "Seite nicht gefunden.");
  return page;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "page.block.list", resourceType: "block" }, async (context) => {
    await pageForOrganization(id, context.organizationId);
    const blocks = await db.select().from(contentBlocks).where(eq(contentBlocks.pageId, id)).orderBy(asc(contentBlocks.sortOrder));
    return { data: blocks.map(publicApiContentBlock) };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:write"], action: "page.block.create", resourceType: "block", idempotent: true }, async (context) => {
    const page = await pageForOrganization(id, context.organizationId);
    const input = await parseJson(request, contentBlockCreateSchema);
    const block = await db.transaction(async (tx) => {
      await assertActiveDataFormBlock({
        transaction: tx,
        organizationId: context.organizationId,
        type: input.type,
        data: input.data,
      });
      await assertPublishedAiAgentContentBlock({
        transaction: tx,
        organizationId: context.organizationId,
        type: input.type,
        data: input.data,
      });
      await assertContentBlockMedia({
        transaction: tx,
        organizationId: context.organizationId,
        type: input.type,
        data: input.data,
        lessonId: page.lessonId,
        apiKeyId: context.apiKeyId,
      });
      const [created] = await tx
        .insert(contentBlocks)
        .values({
          ...input,
          lessonId: page.lessonId,
          pageId: id,
        })
        .returning();
      return created;
    });
    return { data: publicApiContentBlock(block), status: 201, resourceId: block.id };
  });
}
