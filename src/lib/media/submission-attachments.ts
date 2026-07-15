import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { mediaAssets, submissionAttachments } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

export const MAX_SUBMISSION_ATTACHMENTS = 10;

export function validateAttachmentIds(input: readonly string[]) {
  if (input.length > MAX_SUBMISSION_ATTACHMENTS) {
    throw new ApiError(
      422,
      "validation_error",
      `Eine Abgabe darf hoechstens ${MAX_SUBMISSION_ATTACHMENTS} Dateien enthalten.`,
    );
  }
  const parsed = z.array(z.string().uuid()).safeParse(input);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Dateianhaenge sind ungueltig oder doppelt vorhanden.",
    );
  }
  return parsed.data;
}

export async function bindSubmissionAttachments(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    organizationId: string;
    userId: string;
    submissionId: string;
    attachmentIds: readonly string[];
  },
) {
  const attachmentIds = validateAttachmentIds(input.attachmentIds);
  if (!attachmentIds.length) return [];

  // Every writer takes asset locks in the same order, serializing reuse/delete races.
  const lockOrder = [...attachmentIds].sort();
  const assets = await tx
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, input.organizationId),
        inArray(mediaAssets.id, lockOrder),
      ),
    )
    .orderBy(mediaAssets.id)
    .for("update", { of: mediaAssets });
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  if (
    assets.length !== attachmentIds.length ||
    attachmentIds.some((id) => {
      const asset = assetsById.get(id);
      return (
        !asset ||
        asset.purpose !== "submission" ||
        asset.ownerUserId !== input.userId ||
        asset.status !== "ready" ||
        asset.deletedAt !== null
      );
    })
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Alle Dateianhaenge muessen geprueft, bereit und dem einreichenden Mitglied zugeordnet sein.",
    );
  }
  const reused = await tx
    .select({ id: submissionAttachments.id })
    .from(submissionAttachments)
    .where(inArray(submissionAttachments.mediaAssetId, attachmentIds))
    .limit(1);
  if (reused.length) {
    throw new ApiError(
      409,
      "conflict",
      "Mindestens ein Dateianhang wurde bereits eingereicht.",
    );
  }
  return tx
    .insert(submissionAttachments)
    .values(
      attachmentIds.map((mediaAssetId, sortOrder) => ({
        organizationId: input.organizationId,
        submissionId: input.submissionId,
        mediaAssetId,
        sortOrder,
      })),
    )
    .returning({
      id: submissionAttachments.id,
      mediaAssetId: submissionAttachments.mediaAssetId,
    });
}
