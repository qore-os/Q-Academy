import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import {
  courseCollaborators,
  courseMediaAssets,
  mediaAssets,
  users,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { sanitizeGalleryDocument } from "@/lib/content-blocks/interactive-documents";
import { courseCoverMediaAssetId } from "@/lib/course-cover";
import { sanitizeVideoComposition } from "@/lib/media/video-composition";
import { sanitizeVideoPoster } from "@/lib/media/video-poster";
import {
  canManageCourseMedia,
  canReadCourseMedia,
} from "@/lib/media/access-policy";

export type ExpectedCourseMediaKind = "image" | "audio" | "video" | "document";

function snapshotBlocks(snapshot: CourseVersionSnapshot) {
  return snapshot.modules.flatMap((learningModule) => {
    return learningModule.lessons.flatMap((lesson) => [
      ...lesson.blocks,
      ...lesson.pages.flatMap((page) => page.blocks),
    ]);
  });
}

export function courseSnapshotMediaAssets(snapshot: CourseVersionSnapshot) {
  const assets = new Map<string, ExpectedCourseMediaKind>();
  const registerAsset = (
    mediaAssetId: string,
    expectedKind: ExpectedCourseMediaKind,
  ) => {
    const previous = assets.get(mediaAssetId);
    if (previous && previous !== expectedKind) {
      throw new ApiError(
        409,
        "conflict",
        "Ein Kursmedium wird mit widerspruechlichen Blocktypen verwendet.",
      );
    }
    assets.set(mediaAssetId, expectedKind);
  };

  const coverMediaAssetId = courseCoverMediaAssetId(snapshot.course.coverImage);
  if (coverMediaAssetId) registerAsset(coverMediaAssetId, "image");

  for (const widget of snapshot.widgets ?? []) {
    if (widget.type === "image_link" && widget.mediaAssetId) {
      registerAsset(widget.mediaAssetId, "image");
    }
  }

  for (const block of snapshotBlocks(snapshot)) {
    if (block.type === "gallery") {
      const gallery = sanitizeGalleryDocument(block.data.gallery);
      for (const item of gallery.items) {
        if (item.mediaAssetId) registerAsset(item.mediaAssetId, "image");
      }
      continue;
    }
    const mediaAssetId = block.data.mediaAssetId;
    const expectedKind =
      block.type === "file"
        ? "document"
        : block.type === "image" ||
            block.type === "audio" ||
            block.type === "video"
          ? block.type
          : null;
    if (block.type === "video" && block.data.videoPoster) {
      const poster = sanitizeVideoPoster(block.data.videoPoster);
      if (!poster) {
        throw new ApiError(
          409,
          "conflict",
          "Ein Videoblock enthaelt eine ungueltige Vorschaubild-Auswahl.",
        );
      }
      if (poster.source === "upload") {
        registerAsset(poster.mediaAssetId, "image");
      }
    }
    if (!mediaAssetId || !expectedKind) continue;
    registerAsset(mediaAssetId, expectedKind);
    if (block.type === "video" && block.data.videoComposition) {
      const composition = sanitizeVideoComposition(block.data.videoComposition);
      if (!composition) {
        throw new ApiError(
          409,
          "conflict",
          "Ein Videoblock enthaelt eine ungueltige Mehrspur-Komposition.",
        );
      }
      for (const track of composition.audioTracks) {
        registerAsset(track.mediaAssetId, "audio");
      }
    }
  }
  return assets;
}

export function courseSnapshotReferencesMediaAsset(
  snapshot: CourseVersionSnapshot,
  mediaAssetId: string,
) {
  return courseSnapshotMediaAssets(snapshot).has(mediaAssetId);
}

export function courseSnapshotHasVideoComposition(
  snapshot: CourseVersionSnapshot,
) {
  return snapshotBlocks(snapshot).some(
    (block) => block.type === "video" && Boolean(block.data.videoComposition),
  );
}

export function courseSnapshotHasFramePoster(snapshot: CourseVersionSnapshot) {
  return snapshotBlocks(snapshot).some((block) => {
    if (block.type !== "video" || !block.data.videoPoster) return false;
    return sanitizeVideoPoster(block.data.videoPoster)?.source === "frame";
  });
}

export function courseSnapshotWidgetsReferenceMediaAsset(
  snapshot: CourseVersionSnapshot,
  mediaAssetId: string,
) {
  return Boolean(
    snapshot.widgets?.some(
      (widget) =>
        widget.type === "image_link" && widget.mediaAssetId === mediaAssetId,
    ),
  );
}

export async function bindReadyCourseMediaAssets(
  transaction: ApiTransaction,
  input: {
    organizationId: string;
    courseId: string;
    attachedById: string;
    expectedAssets: ReadonlyMap<string, ExpectedCourseMediaKind>;
    access: "read" | "manage";
  },
) {
  const expectedAssets = input.expectedAssets;
  const assetIds = [...expectedAssets.keys()];
  if (!assetIds.length) return;
  const [actor] = await transaction
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, input.attachedById),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor || actor.role === "member") {
    throw new ApiError(
      409,
      "conflict",
      "Kursmedien koennen nicht durch diesen Publisher gebunden werden.",
      { reason: "course_media_publisher_invalid" },
    );
  }
  const rows = await transaction
    .select({
      id: mediaAssets.id,
      kind: mediaAssets.kind,
      uploadedById: mediaAssets.uploadedById,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.status, "ready"),
        inArray(mediaAssets.id, assetIds),
      ),
    )
    .orderBy(mediaAssets.id)
    .for("update", { of: mediaAssets });
  const bindings =
    actor.role === "trainer"
      ? await transaction
          .select({
            mediaAssetId: courseMediaAssets.mediaAssetId,
            courseId: courseMediaAssets.courseId,
          })
          .from(courseMediaAssets)
          .where(
            and(
              eq(courseMediaAssets.organizationId, input.organizationId),
              inArray(courseMediaAssets.mediaAssetId, assetIds),
            ),
          )
      : [];
  const boundCourseIds = [
    ...new Set(bindings.map((binding) => binding.courseId)),
  ].sort();
  const grants = boundCourseIds.length
    ? await transaction
        .select({
          courseId: courseCollaborators.courseId,
          permission: courseCollaborators.permission,
        })
        .from(courseCollaborators)
        .where(
          and(
            eq(courseCollaborators.organizationId, input.organizationId),
            eq(courseCollaborators.userId, actor.id),
            inArray(courseCollaborators.courseId, boundCourseIds),
          ),
        )
        .orderBy(courseCollaborators.courseId)
        .for("share", { of: courseCollaborators })
    : [];
  const permissionByCourse = new Map(
    grants.map((grant) => [grant.courseId, grant.permission]),
  );
  const bindingsByAsset = new Map<
    string,
    Array<"view" | "edit" | "manage" | null>
  >();
  for (const binding of bindings) {
    const current = bindingsByAsset.get(binding.mediaAssetId) ?? [];
    current.push(permissionByCourse.get(binding.courseId) ?? null);
    bindingsByAsset.set(binding.mediaAssetId, current);
  }
  const validAssets = new Map(rows.map((row) => [row.id, row]));
  const invalid = assetIds.find((assetId) => {
    const asset = validAssets.get(assetId);
    if (!asset || asset.kind !== expectedAssets.get(assetId)) return true;
    const permissions = bindingsByAsset.get(assetId) ?? [];
    const accessFacts = {
      role: actor.role,
      uploadedByActor: asset.uploadedById === actor.id,
      isBound: permissions.length > 0,
      hasViewGrant: permissions.some(Boolean),
      hasEditGrant: permissions.some(
        (permission) => permission === "edit" || permission === "manage",
      ),
    };
    return !(input.access === "manage"
      ? canManageCourseMedia(accessFacts)
      : canReadCourseMedia(accessFacts));
  });
  if (invalid) {
    throw new ApiError(
      409,
      "conflict",
      "Der Kurs enthaelt ein nicht bereites oder ungueltiges Kursmedium.",
      { reason: "course_media_not_ready" },
    );
  }
  await transaction
    .insert(courseMediaAssets)
    .values(
      assetIds.map((mediaAssetId) => ({
        organizationId: input.organizationId,
        courseId: input.courseId,
        mediaAssetId,
        attachedById: input.attachedById,
      })),
    )
    .onConflictDoNothing();
}

export async function bindPublishedCourseMediaAssets(
  transaction: ApiTransaction,
  input: {
    organizationId: string;
    courseId: string;
    attachedById: string;
    snapshot: CourseVersionSnapshot;
  },
) {
  return bindReadyCourseMediaAssets(transaction, {
    organizationId: input.organizationId,
    courseId: input.courseId,
    attachedById: input.attachedById,
    expectedAssets: courseSnapshotMediaAssets(input.snapshot),
    access: "read",
  });
}
