import "server-only";

import { inArray, lte } from "drizzle-orm";

import { db } from "@/db";
import { editorPresences, stockImageSelections } from "@/db/schema";

export async function cleanupExpiredAuthoringData(input: {
  now?: Date;
  batchSize?: number;
  dryRun?: boolean;
} = {}) {
  const now = input.now ?? new Date();
  const batchSize = Math.max(1, Math.min(2_000, Math.floor(input.batchSize ?? 500)));
  return db.transaction(async (tx) => {
    const [presence, selections] = await Promise.all([
      tx
        .select({ id: editorPresences.id })
        .from(editorPresences)
        .where(lte(editorPresences.expiresAt, now))
        .limit(batchSize)
        .for("update", { skipLocked: true }),
      tx
        .select({ id: stockImageSelections.id })
        .from(stockImageSelections)
        .where(lte(stockImageSelections.expiresAt, now))
        .limit(batchSize)
        .for("update", { skipLocked: true }),
    ]);
    if (input.dryRun) {
      return {
        mode: "dry-run" as const,
        expiredEditorPresences: presence.length,
        expiredStockImageSelections: selections.length,
      };
    }
    const deletedPresence = presence.length
      ? await tx
          .delete(editorPresences)
          .where(inArray(editorPresences.id, presence.map(({ id }) => id)))
          .returning({ id: editorPresences.id })
      : [];
    const deletedSelections = selections.length
      ? await tx
          .delete(stockImageSelections)
          .where(inArray(stockImageSelections.id, selections.map(({ id }) => id)))
          .returning({ id: stockImageSelections.id })
      : [];
    return {
      mode: "delete" as const,
      expiredEditorPresences: deletedPresence.length,
      expiredStockImageSelections: deletedSelections.length,
    };
  });
}
