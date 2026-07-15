import { z } from "zod";

export const BRANDING_MEDIA_SLOTS = [
  "logo",
  "logo-light",
  "logo-dark",
  "favicon",
  "social-preview",
  "login-background",
] as const;

export type BrandingMediaSlot = (typeof BRANDING_MEDIA_SLOTS)[number];

export const BRANDING_MEDIA_ASSET_FIELDS = {
  logoAssetId: "logo",
  logoLightAssetId: "logo-light",
  logoDarkAssetId: "logo-dark",
  faviconAssetId: "favicon",
  socialPreviewImageAssetId: "social-preview",
  loginBackgroundAssetId: "login-background",
} as const satisfies Record<string, BrandingMediaSlot>;

export type BrandingMediaAssetField = keyof typeof BRANDING_MEDIA_ASSET_FIELDS;

export const brandingMediaAssetIdShape = Object.fromEntries(
  Object.keys(BRANDING_MEDIA_ASSET_FIELDS).map((field) => [
    field,
    z.string().uuid().nullable(),
  ]),
) as Record<BrandingMediaAssetField, z.ZodNullable<z.ZodString>>;

export function brandingMediaPath(slot: BrandingMediaSlot) {
  return `/api/tenant-branding/assets/${slot}`;
}

export function brandingMediaAssetField(slot: BrandingMediaSlot) {
  return (Object.entries(BRANDING_MEDIA_ASSET_FIELDS) as Array<
    [BrandingMediaAssetField, BrandingMediaSlot]
  >).find(([, candidate]) => candidate === slot)?.[0] ?? null;
}

export function isBrandingMediaSlot(value: string): value is BrandingMediaSlot {
  return BRANDING_MEDIA_SLOTS.includes(value as BrandingMediaSlot);
}

export function isBrandingMediaMimeAllowed(
  slot: BrandingMediaSlot,
  mimeType: string | null,
) {
  if (!mimeType) return false;
  const normalized = mimeType.trim().toLowerCase();
  if (slot === "favicon") {
    return [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/vnd.microsoft.icon",
    ].includes(normalized);
  }
  return ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
    normalized,
  );
}
