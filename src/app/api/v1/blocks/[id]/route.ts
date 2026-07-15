import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentBlocks, lessons, modules } from "@/db/schema";
import { ApiError, validationError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import {
  contentBlockUpdateSchema,
  validateAssessmentContentBlock,
} from "@/lib/api/schemas";
import { assertActiveDataFormBlock } from "@/lib/api/content-block-forms";
import { assertPublishedAiAgentContentBlock } from "@/lib/api/content-block-ai-agent";
import { publicApiContentBlock } from "@/lib/api/public-content-block";
import { assertContentBlockMedia } from "@/lib/api/content-block-media";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function blockForOrganization(id: string, organizationId: string) {
  const [row] = await db
    .select({ block: contentBlocks })
    .from(contentBlocks)
    .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
    .innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, organizationId)))
    .where(eq(contentBlocks.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "Inhaltsblock nicht gefunden.");
  return row.block;
}

function requiredRevisionHeader(request: Request) {
  const value = request.headers.get("if-match")?.trim() ?? "";
  const match = /^(?:"([1-9]\d*)"|([1-9]\d*))$/.exec(value);
  const revision = Number(match?.[1] ?? match?.[2]);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ApiError(
      400,
      "validation_error",
      'If-Match muss die aktuelle Blockrevision enthalten, zum Beispiel "3".',
    );
  }
  return revision;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "block.read", resourceType: "block" }, async (context) => ({ data: publicApiContentBlock(await blockForOrganization(id, context.organizationId)), resourceId: id }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:write"], action: "block.update", resourceType: "block", idempotent: true }, async (context) => {
    const current = await blockForOrganization(id, context.organizationId);
    const input = await parseJson(request, contentBlockUpdateSchema);
    const { revision, ...changes } = input;
    const validation = validateAssessmentContentBlock({
      type: changes.type ?? current.type,
      data: changes.data ?? current.data,
    });
    if (!validation.success) throw validationError(validation.error);
    const block = await db.transaction(async (tx) => {
      await assertActiveDataFormBlock({
        transaction: tx,
        organizationId: context.organizationId,
        type: changes.type ?? current.type,
        data: changes.data ?? current.data,
      });
      await assertPublishedAiAgentContentBlock({
        transaction: tx,
        organizationId: context.organizationId,
        type: changes.type ?? current.type,
        data: changes.data ?? current.data,
      });
      await assertContentBlockMedia({
        transaction: tx,
        organizationId: context.organizationId,
        type: changes.type ?? current.type,
        data: changes.data ?? current.data,
        lessonId: current.lessonId,
        apiKeyId: context.apiKeyId,
      });
      const [updated] = await tx
        .update(contentBlocks)
        .set({
          ...changes,
          revision: sql`${contentBlocks.revision} + 1`,
        })
        .where(
          and(
            eq(contentBlocks.id, id),
            eq(contentBlocks.revision, revision),
          ),
        )
        .returning();
      if (!updated) {
        const [existing] = await tx
          .select({ id: contentBlocks.id, revision: contentBlocks.revision })
          .from(contentBlocks)
          .where(eq(contentBlocks.id, id))
          .limit(1);
        if (!existing) {
          throw new ApiError(404, "not_found", "Inhaltsblock nicht gefunden.");
        }
        throw new ApiError(
          409,
          "conflict",
          "Der Inhaltsblock wurde zwischenzeitlich geaendert. Lesen Sie die aktuelle Revision und wiederholen Sie die Aenderung.",
          {
            resourceType: "block",
            resourceId: id,
            expectedRevision: revision,
            currentRevision: existing.revision,
          },
        );
      }
      return updated;
    });
    return { data: publicApiContentBlock(block), resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:write"], action: "block.delete", resourceType: "block", idempotent: true }, async (context) => {
    await blockForOrganization(id, context.organizationId);
    const revision = requiredRevisionHeader(request);
    const [deleted] = await db
      .delete(contentBlocks)
      .where(
        and(
          eq(contentBlocks.id, id),
          eq(contentBlocks.revision, revision),
        ),
      )
      .returning({ id: contentBlocks.id });
    if (!deleted) {
      const [existing] = await db
        .select({ id: contentBlocks.id, revision: contentBlocks.revision })
        .from(contentBlocks)
        .where(eq(contentBlocks.id, id))
        .limit(1);
      if (!existing) {
        throw new ApiError(404, "not_found", "Inhaltsblock nicht gefunden.");
      }
      throw new ApiError(
        409,
        "conflict",
        "Der Inhaltsblock wurde zwischenzeitlich geaendert. Lesen Sie die aktuelle Revision und wiederholen Sie das Loeschen.",
        {
          resourceType: "block",
          resourceId: id,
          expectedRevision: revision,
          currentRevision: existing.revision,
        },
      );
    }
    return { data: { id, deleted: true }, resourceId: id };
  });
}
