import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { getPublicBrandingForRequest } from "@/lib/branding";
import {
  BRANDING_MEDIA_ASSET_FIELDS,
  brandingMediaAssetField,
  isBrandingMediaMimeAllowed,
  type BrandingMediaAssetField,
  type BrandingMediaSlot,
} from "@/lib/branding-media-policy";

type BrandingMediaIds = Partial<
  Record<BrandingMediaAssetField, string | null | undefined>
>;

export class BrandingMediaBindingError extends Error {
  constructor(message = "Das Branding-Bild ist nicht geprueft oder gehoert zu einer anderen Academy.") {
    super(message);
    this.name = "BrandingMediaBindingError";
  }
}

export async function assertReadyBrandingMediaAssets(
  reader: Pick<typeof db, "select">,
  organizationId: string,
  requested: BrandingMediaIds,
) {
  const entries = (Object.entries(BRANDING_MEDIA_ASSET_FIELDS) as Array<
    [BrandingMediaAssetField, BrandingMediaSlot]
  >).filter(([field]) => Boolean(requested[field]));
  const ids = [...new Set(entries.map(([field]) => requested[field]!))];
  if (!ids.length) return;

  const rows = await reader
    .select({
      id: mediaAssets.id,
      declaredMimeType: mediaAssets.declaredMimeType,
      detectedMimeType: mediaAssets.detectedMimeType,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, organizationId),
        inArray(mediaAssets.id, ids),
        eq(mediaAssets.purpose, "branding"),
        eq(mediaAssets.kind, "image"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .for("share");
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [field, slot] of entries) {
    const row = byId.get(requested[field]!);
    if (
      !row ||
      !isBrandingMediaMimeAllowed(
        slot,
        row.detectedMimeType ?? row.declaredMimeType,
      )
    ) {
      throw new BrandingMediaBindingError();
    }
  }
}

export async function getPublicBrandingMediaAsset(
  requestHeaders: Pick<Headers, "get">,
  slot: BrandingMediaSlot,
) {
  const branding = await getPublicBrandingForRequest(requestHeaders);
  const field = brandingMediaAssetField(slot);
  const id = field ? branding[field] : null;
  if (!branding.organizationId || !id) return null;

  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, branding.organizationId),
        eq(mediaAssets.purpose, "branding"),
        eq(mediaAssets.kind, "image"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .limit(1);
  if (
    !asset ||
    !isBrandingMediaMimeAllowed(
      slot,
      asset.detectedMimeType ?? asset.declaredMimeType,
    )
  ) {
    return null;
  }
  return asset;
}
