import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import type { CustomFieldType, CustomFieldValue } from "@/lib/custom-fields";

type ProfileMediaReader = Pick<typeof db, "select">;

export class ProfileMediaFieldBindingError extends Error {
  constructor() {
    super("A profile media field references an unavailable media asset.");
    this.name = "ProfileMediaFieldBindingError";
  }
}

export async function assertProfileMediaFieldAssets(input: {
  reader: ProfileMediaReader;
  organizationId: string;
  userId: string;
  entries: readonly {
    field: { type: CustomFieldType };
    value: CustomFieldValue;
  }[];
}) {
  const ids = [
    ...new Set(
      input.entries.flatMap(({ field, value }) =>
        field.type === "media" && typeof value === "string" ? [value] : [],
      ),
    ),
  ];
  if (!ids.length) return;
  const assets = await input.reader
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.ownerUserId, input.userId),
        eq(mediaAssets.purpose, "profile"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
        inArray(mediaAssets.id, ids),
      ),
    );
  if (assets.length !== ids.length) throw new ProfileMediaFieldBindingError();
}
