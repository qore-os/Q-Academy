import { sanitizeGalleryDocument } from "@/lib/content-blocks/interactive-documents";
import { sanitizeDownloadDocument } from "@/lib/content-blocks/layout-documents";
import { sanitizeVideoComposition } from "@/lib/media/video-composition";
import type {
  ContentBlockData,
  ExamQuestionPoolConfiguration,
} from "@/db/schema";

export type CourseContentMediaKind = "image" | "audio" | "video" | "document";

type CopyableBlockReference = {
  id: string;
  type: string;
  data: ContentBlockData;
};

export class CourseContentCopyReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseContentCopyReferenceError";
  }
}

export function courseContentDataForCopy(
  data: ContentBlockData,
): ContentBlockData {
  if (!data.videoComposition) return data;
  const composition = sanitizeVideoComposition(data.videoComposition);
  if (!composition) {
    throw new CourseContentCopyReferenceError(
      "A video block contains an invalid audio composition.",
    );
  }
  return {
    ...data,
    videoComposition: {
      version: composition.version,
      audioTracks: composition.audioTracks,
    },
  };
}

export function collectCourseContentMediaReferences(
  blocks: readonly CopyableBlockReference[],
) {
  const references = new Map<string, CourseContentMediaKind>();
  const register = (id: string, kind: CourseContentMediaKind) => {
    const previous = references.get(id);
    if (previous && previous !== kind) {
      throw new CourseContentCopyReferenceError(
        "A media asset is referenced with conflicting kinds.",
      );
    }
    references.set(id, kind);
  };

  for (const block of blocks) {
    if (block.type === "gallery") {
      for (const item of sanitizeGalleryDocument(block.data.gallery).items) {
        if (item.mediaAssetId) register(item.mediaAssetId, "image");
      }
      continue;
    }
    if (block.type === "download") {
      const download = sanitizeDownloadDocument(block.data.download);
      if (download) register(download.mediaAssetId, "document");
      continue;
    }
    const mediaAssetId = block.data.mediaAssetId;
    const kind =
      block.type === "file"
        ? "document"
        : block.type === "image" ||
            block.type === "audio" ||
            block.type === "video"
          ? block.type
          : null;
    if (mediaAssetId && kind) register(mediaAssetId, kind);
    if (block.type === "video" && block.data.videoComposition) {
      const composition = sanitizeVideoComposition(block.data.videoComposition);
      if (!composition) {
        throw new CourseContentCopyReferenceError(
          "A video block contains an invalid audio composition.",
        );
      }
      for (const track of composition.audioTracks) {
        register(track.mediaAssetId, "audio");
      }
    }
  }
  return references;
}

export function remapCopiedExamQuestionPools(
  pools: readonly ExamQuestionPoolConfiguration[],
  blockIds: ReadonlyMap<string, string>,
) {
  return pools.map((pool) => ({
    ...pool,
    questionIds: pool.questionIds.map((questionId) => {
      const copiedId = blockIds.get(questionId);
      if (!copiedId) {
        throw new CourseContentCopyReferenceError(
          "An assessment pool points to a block outside the copied lesson.",
        );
      }
      return copiedId;
    }),
  }));
}

export function copiedLessonSlug(sourceSlug: string, copiedLessonId: string) {
  const suffix = `-${copiedLessonId.slice(0, 8).toLowerCase()}`;
  const base = sourceSlug
    .trim()
    .toLowerCase()
    .slice(0, 180 - suffix.length);
  return `${base || "lesson"}${suffix}`;
}
