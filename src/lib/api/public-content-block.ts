import type { contentBlocks } from "@/db/schema";
import { publicAssessmentBlockData } from "@/lib/assessment-engine";

export function publicApiContentBlock(
  block: typeof contentBlocks.$inferSelect,
) {
  return {
    ...block,
    data: publicAssessmentBlockData(block),
  };
}
