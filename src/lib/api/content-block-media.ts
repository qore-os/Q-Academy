import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  apiKeys,
  courseMediaAssets,
  courseModules,
  lessons,
  mediaAssets,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { sanitizeDownloadDocument } from "@/lib/content-blocks/layout-documents";

export type ContentBlockMediaTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function assertContentBlockMedia(input: {
  transaction: ContentBlockMediaTransaction;
  organizationId: string;
  type: string;
  data: unknown;
  lessonId: string;
  apiKeyId: string;
}) {
  if (input.type !== "download") return;
  const data =
    input.data && typeof input.data === "object"
      ? (input.data as Record<string, unknown>)
      : null;
  const download = sanitizeDownloadDocument(data?.download);
  if (!download) {
    throw new ApiError(422, "validation_error", "Der Download ist ungueltig.");
  }
  const [asset] = await input.transaction
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, download.mediaAssetId),
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.kind, "document"),
        eq(mediaAssets.status, "ready"),
      ),
    )
    .limit(1)
    .for("share");
  if (!asset) {
    throw new ApiError(
      422,
      "validation_error",
      "Das Download-Asset ist nicht geprueft oder gehoert nicht zur Organisation.",
    );
  }
  const [actor] = await input.transaction
    .select({ id: users.id })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      422,
      "validation_error",
      "Download-Bloecke erfordern einen API-Schluessel mit aktivem Ersteller.",
    );
  }
  const courseRows = await input.transaction
    .select({ courseId: courseModules.courseId })
    .from(lessons)
    .innerJoin(courseModules, eq(courseModules.moduleId, lessons.moduleId))
    .where(eq(lessons.id, input.lessonId));
  if (!courseRows.length) {
    throw new ApiError(422, "validation_error", "Der Download kann keinem Kurs zugeordnet werden.");
  }
  await input.transaction
    .insert(courseMediaAssets)
    .values(
      courseRows.map((course) => ({
        organizationId: input.organizationId,
        courseId: course.courseId,
        mediaAssetId: download.mediaAssetId,
        attachedById: actor.id,
      })),
    )
    .onConflictDoNothing();
}
