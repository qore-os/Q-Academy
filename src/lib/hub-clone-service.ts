import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { hubs } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { lockHubLayoutFormsForMutation } from "@/lib/data-form-embedding";
import { assertPublishedAiAgentHubLayout } from "@/lib/hub-ai-agent-embedding";
import { publicHubLayout } from "@/lib/hub-layout";
import { slugify } from "@/lib/utils";

export type HubCloneTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

function cloneTitle(sourceTitle: string, requestedTitle?: string) {
  const requested = requestedTitle?.trim();
  if (requested) return requested.slice(0, 180).trim();

  const suffix = " (Kopie)";
  return `${sourceTitle.slice(0, 180 - suffix.length).trimEnd()}${suffix}`;
}

function slugCandidates(title: string) {
  const base = (slugify(title) || "hub-kopie").slice(0, 130);
  return Array.from({ length: 999 }, (_, index) =>
    index === 0 ? base : `${base}-${index + 1}`,
  );
}

export async function cloneHub(
  tx: HubCloneTransaction,
  input: {
    organizationId: string;
    sourceHubId: string;
    title?: string;
  },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`hub-clone:${input.organizationId}`}))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`hub-layout:${input.organizationId}:${input.sourceHubId}`}))`,
  );
  const [source] = await tx
    .select()
    .from(hubs)
    .where(
      and(
        eq(hubs.id, input.sourceHubId),
        eq(hubs.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!source) return null;

  const layout = publicHubLayout(source.layout);
  if (
    !(await lockHubLayoutFormsForMutation(
      layout,
      input.organizationId,
      tx,
    ))
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Der Hub enthaelt ein nicht mehr aktives Formular.",
    );
  }
  await assertPublishedAiAgentHubLayout({
    transaction: tx,
    organizationId: input.organizationId,
    layout,
  });
  const title = cloneTitle(source.title, input.title);
  for (const slug of slugCandidates(title)) {
    const [clone] = await tx
      .insert(hubs)
      .values({
        organizationId: input.organizationId,
        title,
        slug,
        description: source.description,
        status: "draft",
        layout,
      })
      .onConflictDoNothing({ target: [hubs.organizationId, hubs.slug] })
      .returning();
    if (clone) return clone;
  }

  throw new ApiError(
    409,
    "conflict",
    "Fuer die Hub-Kopie konnte kein freier Slug vergeben werden.",
  );
}
