import "server-only";

import { and, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  stockImageSelections,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  coursePermissionAllows,
  coursePermissionForUser,
  requireCoursePermissionInTransaction,
} from "@/lib/course-permissions";
import { STOCK_IMAGE_LIMITS } from "@/lib/stock-image-model";
import {
  downloadStockImage,
  getStockImageForSelection,
  searchStockImages,
} from "@/lib/stock-image-provider";

type StockActor = Pick<User, "id" | "organizationId" | "role">;
type StockSelectionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function publicResult(
  image: Awaited<ReturnType<typeof searchStockImages>>["results"][number],
) {
  return {
    id: image.id,
    previewUrl: image.previewUrl,
    width: image.width,
    height: image.height,
    alt: image.alt,
    author: image.author,
    authorUrl: image.authorUrl,
    sourceUrl: image.sourceUrl,
    attribution: image.attribution,
  };
}

async function assertApiCourse(organizationId: string, courseId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
}

export async function searchStockImagesForSession(
  actor: StockActor,
  courseId: string,
  input: { query: string; page: number; perPage: number },
) {
  const permission = await coursePermissionForUser(actor, courseId);
  if (!coursePermissionAllows(permission, "edit")) {
    throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  }
  const result = await searchStockImages(input);
  return { ...result, results: result.results.map(publicResult) };
}

export async function searchStockImagesForApi(
  organizationId: string,
  courseId: string,
  input: { query: string; page: number; perPage: number },
) {
  await assertApiCourse(organizationId, courseId);
  const result = await searchStockImages(input);
  return { ...result, results: result.results.map(publicResult) };
}

async function insertSelection(
  input: {
    organizationId: string;
    courseId: string;
    selectedById: string | null;
    externalId: string;
  },
  transaction?: StockSelectionTransaction,
) {
  const selected = await getStockImageForSelection(input.externalId);
  const now = new Date();
  const executor = transaction ?? db;
  const [record] = await executor
    .insert(stockImageSelections)
    .values({
      organizationId: input.organizationId,
      courseId: input.courseId,
      selectedById: input.selectedById,
      provider: selected.provider,
      externalId: selected.image.id,
      imageUrl: selected.image.imageUrl,
      previewUrl: selected.image.previewUrl,
      width: selected.image.width,
      height: selected.image.height,
      altText: selected.image.alt,
      author: selected.image.author,
      authorUrl: selected.image.authorUrl,
      sourceUrl: selected.image.sourceUrl,
      attribution: selected.image.attribution,
      downloadTrackedAt: now,
      expiresAt: new Date(now.getTime() + STOCK_IMAGE_LIMITS.selectionRetentionMs),
      createdAt: now,
    })
    .returning();
  return record;
}

export async function selectStockImageForSession(
  actor: StockActor,
  input: { courseId: string; externalId: string },
) {
  const permission = await coursePermissionForUser(actor, input.courseId);
  if (!coursePermissionAllows(permission, "edit")) {
    throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  }
  const selected = await getStockImageForSelection(input.externalId);
  const now = new Date();
  return db.transaction(async (tx) => {
    await requireCoursePermissionInTransaction(tx, actor, input.courseId, "edit");
    const [record] = await tx
      .insert(stockImageSelections)
      .values({
        organizationId: actor.organizationId,
        courseId: input.courseId,
        selectedById: actor.id,
        provider: selected.provider,
        externalId: selected.image.id,
        imageUrl: selected.image.imageUrl,
        previewUrl: selected.image.previewUrl,
        width: selected.image.width,
        height: selected.image.height,
        altText: selected.image.alt,
        author: selected.image.author,
        authorUrl: selected.image.authorUrl,
        sourceUrl: selected.image.sourceUrl,
        attribution: selected.image.attribution,
        downloadTrackedAt: now,
        expiresAt: new Date(now.getTime() + STOCK_IMAGE_LIMITS.selectionRetentionMs),
        createdAt: now,
      })
      .returning();
    return {
      selectionId: record.id,
      imageUrl: record.imageUrl,
      previewUrl: record.previewUrl,
      alt: record.altText,
      attribution: record.attribution,
      author: record.author,
    };
  });
}

export async function downloadStockImageSelectionForSession(
  actor: StockActor,
  input: { courseId: string; selectionId: string },
) {
  const permission = await coursePermissionForUser(actor, input.courseId);
  if (!coursePermissionAllows(permission, "edit")) {
    throw new ApiError(404, "not_found", "Stockbildauswahl nicht gefunden.");
  }
  const [selection] = await db
    .select({
      imageUrl: stockImageSelections.imageUrl,
      expiresAt: stockImageSelections.expiresAt,
      selectedById: stockImageSelections.selectedById,
    })
    .from(stockImageSelections)
    .where(
      and(
        eq(stockImageSelections.id, input.selectionId),
        eq(stockImageSelections.organizationId, actor.organizationId),
        eq(stockImageSelections.courseId, input.courseId),
      ),
    )
    .limit(1);
  if (
    !selection ||
    selection.expiresAt <= new Date() ||
    (selection.selectedById !== actor.id && actor.role === "trainer")
  ) {
    throw new ApiError(404, "not_found", "Stockbildauswahl nicht gefunden.");
  }
  return downloadStockImage(selection.imageUrl);
}

export async function selectStockImageForApi(
  organizationId: string,
  input: { courseId: string; externalId: string },
) {
  await assertApiCourse(organizationId, input.courseId);
  const record = await insertSelection({
    organizationId,
    courseId: input.courseId,
    selectedById: null,
    externalId: input.externalId,
  });
  return {
    selectionId: record.id,
    imageUrl: record.imageUrl,
    previewUrl: record.previewUrl,
    alt: record.altText,
    attribution: record.attribution,
    author: record.author,
  };
}

export async function consumeStockImageSelection(
  tx: StockSelectionTransaction,
  input: {
    organizationId: string;
    courseId: string;
    selectionId: string;
  },
) {
  const now = new Date();
  const [selection] = await tx
    .select()
    .from(stockImageSelections)
    .where(
      and(
        eq(stockImageSelections.id, input.selectionId),
        eq(stockImageSelections.organizationId, input.organizationId),
        eq(stockImageSelections.courseId, input.courseId),
      ),
    )
    .limit(1)
    .for("update");
  if (!selection || selection.expiresAt <= now) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Stockbildauswahl ist abgelaufen oder gehoert nicht zu diesem Kurs.",
    );
  }
  await tx
    .update(stockImageSelections)
    .set({ usedAt: selection.usedAt ?? now })
    .where(eq(stockImageSelections.id, selection.id));
  return selection;
}

export async function cleanupExpiredStockImageSelections(
  now = new Date(),
  limit = 500,
) {
  const candidates = await db
    .select({ id: stockImageSelections.id })
    .from(stockImageSelections)
    .where(lte(stockImageSelections.expiresAt, now))
    .limit(Math.max(1, Math.min(2_000, Math.floor(limit))));
  if (!candidates.length) return 0;
  let deleted = 0;
  for (const candidate of candidates) {
    const rows = await db
      .delete(stockImageSelections)
      .where(
        and(
          eq(stockImageSelections.id, candidate.id),
          lte(stockImageSelections.expiresAt, now),
        ),
      )
      .returning({ id: stockImageSelections.id });
    deleted += rows.length;
  }
  return deleted;
}
