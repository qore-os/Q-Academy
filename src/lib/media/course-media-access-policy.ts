import type { CourseVersionSnapshot } from "@/db/schema";
import { sanitizeGalleryDocument } from "@/lib/content-blocks/interactive-documents";
import { sanitizeVideoPoster } from "@/lib/media/video-poster";
import { sanitizeVideoComposition } from "@/lib/media/video-composition";

type SnapshotLesson =
  CourseVersionSnapshot["modules"][number]["lessons"][number];

type AccessibleSnapshotLesson = {
  lesson: SnapshotLesson;
  access: { accessible: boolean };
};

function lessonBlocks(lesson: SnapshotLesson) {
  return [
    ...lesson.blocks,
    ...lesson.pages
      .filter((page) => page.status === "published")
      .flatMap((page) => page.blocks),
  ];
}

export function lessonReferencesMediaAsset(
  lesson: SnapshotLesson,
  mediaAssetId: string,
) {
  return lessonBlocks(lesson).some((block) => {
    if (block.type === "gallery") {
      return sanitizeGalleryDocument(block.data.gallery).items.some(
        (item) => item.mediaAssetId === mediaAssetId,
      );
    }
    if (block.type === "video" && block.data.videoPoster) {
      const poster = sanitizeVideoPoster(block.data.videoPoster);
      if (poster?.source === "upload" && poster.mediaAssetId === mediaAssetId) {
        return true;
      }
    }
    return (
      ["image", "audio", "video", "file"].includes(block.type) &&
      block.data.mediaAssetId === mediaAssetId
    );
  });
}

export function accessibleLessonsReferenceMediaAsset(
  lessons: Iterable<AccessibleSnapshotLesson>,
  mediaAssetId: string,
) {
  for (const lesson of lessons) {
    if (
      lesson.access.accessible &&
      lessonReferencesMediaAsset(lesson.lesson, mediaAssetId)
    ) {
      return true;
    }
  }
  return false;
}

export function accessibleLessonsReferenceVideoComposition(
  lessons: Iterable<AccessibleSnapshotLesson>,
  input: {
    renderJobId: string;
    primaryAssetId: string;
    blockId?: string;
  },
) {
  for (const resolved of lessons) {
    if (!resolved.access.accessible) continue;
    for (const block of lessonBlocks(resolved.lesson)) {
      if (
        block.type !== "video" ||
        (input.blockId !== undefined && block.id !== input.blockId) ||
        block.data.mediaAssetId !== input.primaryAssetId
      ) {
        continue;
      }
      const composition = sanitizeVideoComposition(
        block.data.videoComposition,
      );
      if (composition?.renderJobId === input.renderJobId) return true;
    }
  }
  return false;
}
