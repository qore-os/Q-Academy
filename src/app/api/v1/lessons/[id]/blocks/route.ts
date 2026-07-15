import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentBlocks, lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { contentBlockCreateSchema } from "@/lib/api/schemas";
import { assertActiveDataFormBlock } from "@/lib/api/content-block-forms";
import { assertPublishedAiAgentContentBlock } from "@/lib/api/content-block-ai-agent";
import { publicApiContentBlock } from "@/lib/api/public-content-block";
import { assertContentBlockMedia } from "@/lib/api/content-block-media";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertLesson(id: string, organizationId: string) {
  const [lesson] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, organizationId)))
    .where(eq(lessons.id, id))
    .limit(1);
  if (!lesson) throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "block.list", resourceType: "block" }, async (context) => {
    await assertLesson(id, context.organizationId);
    const data = await db.select().from(contentBlocks).where(eq(contentBlocks.lessonId, id)).orderBy(asc(contentBlocks.sortOrder));
    return { data: data.map(publicApiContentBlock) };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:write"], action: "block.create", resourceType: "block", idempotent: true }, async (context) => {
    await assertLesson(id, context.organizationId);
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
        lessonId: id,
        apiKeyId: context.apiKeyId,
      });
      const [created] = await tx
        .insert(contentBlocks)
        .values({ ...input, lessonId: id })
        .returning();
      return created;
    });
    return { data: publicApiContentBlock(block), status: 201, resourceId: block.id };
  });
}
