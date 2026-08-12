import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  contentBlocks,
  courseMediaAssets,
  mediaAssets,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { CoursePermissionTransaction } from "@/lib/course-permissions";
import { canManageCourseMedia } from "@/lib/media/access-policy";

export type SharedCourseMediaKind = "image" | "video" | "audio" | "document";

type SharedCourseMediaActor = Pick<
  User,
  "id" | "organizationId" | "role"
>;

function uniqueIds(values: readonly string[]) {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}

export async function assertVideoBlockPrimaryAssetContext(
  transaction: CoursePermissionTransaction,
  input: { blockId: string; primaryAssetId: string },
) {
  const [block] = await transaction
    .select({
      title: contentBlocks.title,
      type: contentBlocks.type,
      data: contentBlocks.data,
    })
    .from(contentBlocks)
    .where(eq(contentBlocks.id, input.blockId))
    .limit(1);
  if (!block || block.type !== "video") {
    throw new ApiError(404, "not_found", "Video-Block nicht gefunden.");
  }
  if (block.data.mediaAssetId === input.primaryAssetId) return block;
  throw new ApiError(
    422,
    "validation_error",
    "Das Video gehoert nicht zum ausgewaehlten Block.",
  );
}

export async function assertManageableSharedCourseMedia(
  transaction: CoursePermissionTransaction,
  actor: SharedCourseMediaActor,
  input: {
    referencedCourseIds: readonly string[];
    references: ReadonlyMap<string, SharedCourseMediaKind>;
  },
) {
  const courseIds = uniqueIds(input.referencedCourseIds);
  const references = new Map<string, SharedCourseMediaKind>();
  for (const [assetId, kind] of input.references) {
    const normalizedId = assetId.toLowerCase();
    const previousKind = references.get(normalizedId);
    if (previousKind && previousKind !== kind) {
      throw new ApiError(
        422,
        "validation_error",
        "Das Medium besitzt widerspruechliche Typreferenzen.",
      );
    }
    references.set(normalizedId, kind);
  }
  const assetIds = uniqueIds([...references.keys()]);
  if (!courseIds.length) {
    throw new ApiError(404, "not_found", "Kursinhalt nicht gefunden.");
  }
  if (!assetIds.length) return new Map();

  const [assets, bindings] = await Promise.all([
    transaction
      .select({
        id: mediaAssets.id,
        kind: mediaAssets.kind,
        uploadedById: mediaAssets.uploadedById,
        originalFileName: mediaAssets.originalFileName,
        durationMilliseconds: mediaAssets.durationMilliseconds,
        contentSha256: mediaAssets.contentSha256,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.organizationId, actor.organizationId),
          eq(mediaAssets.purpose, "course_content"),
          eq(mediaAssets.status, "ready"),
          isNull(mediaAssets.deletedAt),
          inArray(mediaAssets.id, assetIds),
        ),
      )
      .orderBy(mediaAssets.id)
      .for("update"),
    transaction
      .select({
        mediaAssetId: courseMediaAssets.mediaAssetId,
        courseId: courseMediaAssets.courseId,
      })
      .from(courseMediaAssets)
      .where(
        and(
          eq(courseMediaAssets.organizationId, actor.organizationId),
          inArray(courseMediaAssets.mediaAssetId, assetIds),
        ),
      ),
  ]);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedCourses = new Set(courseIds);
  for (const assetId of assetIds) {
    const asset = assetsById.get(assetId);
    const assetBindings = bindings.filter(
      (binding) => binding.mediaAssetId === assetId,
    );
    const boundToReferencedCourse = assetBindings.some((binding) =>
      referencedCourses.has(binding.courseId),
    );
    if (
      !asset ||
      asset.kind !== references.get(assetId) ||
      !canManageCourseMedia({
        role: actor.role,
        uploadedByActor: asset.uploadedById === actor.id,
        isBound: assetBindings.length > 0,
        hasViewGrant: boundToReferencedCourse,
        hasEditGrant: boundToReferencedCourse,
      })
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Das Medium gehoert nicht zum gemeinsamen Kursinhalt oder ist nicht bearbeitbar.",
      );
    }
  }
  return assetsById;
}

export async function bindSharedCourseMedia(
  transaction: CoursePermissionTransaction,
  actor: SharedCourseMediaActor,
  input: {
    referencedCourseIds: readonly string[];
    mediaAssetIds: readonly string[];
  },
) {
  const courseIds = uniqueIds(input.referencedCourseIds);
  const mediaAssetIds = uniqueIds(input.mediaAssetIds);
  if (!courseIds.length || !mediaAssetIds.length) return;
  await transaction
    .insert(courseMediaAssets)
    .values(
      courseIds.flatMap((courseId) =>
        mediaAssetIds.map((mediaAssetId) => ({
          organizationId: actor.organizationId,
          courseId,
          mediaAssetId,
          attachedById: actor.id,
        })),
      ),
    )
    .onConflictDoNothing();
}
