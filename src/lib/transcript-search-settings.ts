import "server-only";

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  organizations,
  platformSettings,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import {
  sanitizeTranscriptSearchSettings,
  transcriptSearchSettingsInputSchema,
  type TranscriptSearchSettings,
} from "@/lib/transcript-search-settings-model";

export const TRANSCRIPT_PLATFORM_SETTINGS_KEY = "transcripts";

export type TranscriptSearchSettingsView = TranscriptSearchSettings & {
  updatedAt: Date | null;
};

export type TranscriptSearchSettingsMutationResult =
  TranscriptSearchSettingsView & { changed: boolean };

function sameTerms(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function getTranscriptSearchSettings(
  organizationId: string,
): Promise<TranscriptSearchSettingsView> {
  const [row] = await db
    .select({ value: platformSettings.value, updatedAt: platformSettings.updatedAt })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, organizationId),
        eq(platformSettings.key, TRANSCRIPT_PLATFORM_SETTINGS_KEY),
      ),
    )
    .limit(1);
  return {
    ...sanitizeTranscriptSearchSettings(row?.value),
    updatedAt: row?.updatedAt ?? null,
  };
}

async function lockTranscriptSearchSettings(
  tx: ApiTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`transcript-search:${organizationId}`}, 0))`,
  );
}

export async function updateTranscriptSearchSettings(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    source: "admin_ui" | "api";
    settings: TranscriptSearchSettings;
  },
): Promise<TranscriptSearchSettingsMutationResult> {
  await lockTranscriptSearchSettings(tx, input.organizationId);
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, input.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!organization) {
    throw new ApiError(404, "not_found", "Academy nicht gefunden.");
  }

  if (input.actorUserId) {
    const [actor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorUserId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
          sql`${users.role} in ('owner', 'admin')`,
        ),
      )
      .limit(1)
      .for("share");
    if (!actor) {
      throw new ApiError(
        403,
        "forbidden",
        "Die Transkript-Sucheinstellungen duerfen nicht geaendert werden.",
      );
    }
  }

  const [currentRow] = await tx
    .select({ value: platformSettings.value, updatedAt: platformSettings.updatedAt })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, input.organizationId),
        eq(platformSettings.key, TRANSCRIPT_PLATFORM_SETTINGS_KEY),
      ),
    )
    .limit(1)
    .for("update");
  const current = sanitizeTranscriptSearchSettings(currentRow?.value);
  const next = transcriptSearchSettingsInputSchema.parse(input.settings);
  if (sameTerms(current.excludedSearchTerms, next.excludedSearchTerms)) {
    return {
      ...current,
      updatedAt: currentRow?.updatedAt ?? null,
      changed: false,
    };
  }

  const currentSet = new Set(current.excludedSearchTerms);
  const nextSet = new Set(next.excludedSearchTerms);
  const configurationHash = createHash("sha256")
    .update(JSON.stringify(next.excludedSearchTerms))
    .digest("hex");
  const now = new Date();
  const [saved] = await tx
    .insert(platformSettings)
    .values({
      organizationId: input.organizationId,
      key: TRANSCRIPT_PLATFORM_SETTINGS_KEY,
      value: next,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [platformSettings.organizationId, platformSettings.key],
      set: { value: next, updatedAt: now },
    })
    .returning({ updatedAt: platformSettings.updatedAt });
  if (!saved) {
    throw new ApiError(
      409,
      "conflict",
      "Die Transkript-Sucheinstellungen wurden parallel geaendert.",
    );
  }

  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorUserId ?? null,
    type: "platform.transcript_search.updated",
    entityType: "organization",
    entityId: input.organizationId,
    metadata: {
      source: input.source,
      configurationHash,
      excludedTermCount: next.excludedSearchTerms.length,
      addedCount: next.excludedSearchTerms.filter((term) => !currentSet.has(term))
        .length,
      removedCount: current.excludedSearchTerms.filter((term) => !nextSet.has(term))
        .length,
    },
  });
  return { ...next, updatedAt: saved.updatedAt, changed: true };
}
