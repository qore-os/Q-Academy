import type { CourseVersionSnapshot } from "@/db/schema";
import { sanitizeGalleryDocument } from "@/lib/content-blocks/interactive-documents";

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
