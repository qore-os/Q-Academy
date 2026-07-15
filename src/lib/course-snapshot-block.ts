import { randomInt } from "node:crypto";

import { contentBlocks } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { orderingItemId } from "@/lib/assessment-engine";
import {
  parseVideoPlaybackPolicy,
  sanitizeVideoPlaybackPolicy,
} from "@/lib/media/video-playback-policy";
import { sanitizeVideoComposition } from "@/lib/media/video-composition";

export function contentBlockForSnapshot(
  block: typeof contentBlocks.$inferSelect,
  randomizeOrdering: boolean,
) {
  let snapshotBlock = block;
  if (block.type === "video") {
    const policy =
      block.data.videoPlayback === undefined
        ? sanitizeVideoPlaybackPolicy(undefined)
        : parseVideoPlaybackPolicy(block.data.videoPlayback);
    if (!policy) {
      throw new ApiError(
        409,
        "conflict",
        "Das Video enthaelt ungueltige Wiedergabe- oder Schnittregeln.",
      );
    }
    const composition = block.data.videoComposition
      ? sanitizeVideoComposition(block.data.videoComposition)
      : undefined;
    if (block.data.videoComposition && !composition) {
      throw new ApiError(
        409,
        "conflict",
        "Das Video enthaelt eine ungueltige Mehrspur-Komposition.",
      );
    }
    snapshotBlock = {
      ...block,
      data: {
        ...block.data,
        videoPlayback: policy,
        ...(composition ? { videoComposition: composition } : {}),
      },
    };
  }
  if (
    !randomizeOrdering ||
    snapshotBlock.type !== "ordering" ||
    !Array.isArray(snapshotBlock.data.options) ||
    snapshotBlock.data.options.length < 2
  ) {
    return snapshotBlock;
  }
  const correctOrder = snapshotBlock.data.options.map((option) =>
    orderingItemId(snapshotBlock.id, option),
  );
  const presentationOrder = [...correctOrder];
  for (let index = presentationOrder.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [presentationOrder[index], presentationOrder[target]] = [
      presentationOrder[target],
      presentationOrder[index],
    ];
  }
  if (presentationOrder.every((id, index) => id === correctOrder[index])) {
    presentationOrder.push(presentationOrder.shift()!);
  }
  return {
    ...snapshotBlock,
    data: { ...snapshotBlock.data, presentationOrder },
  };
}
