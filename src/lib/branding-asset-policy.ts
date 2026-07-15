import type { TenantBranding } from "@/lib/branding-model";

const MAX_BRAND_ASSET_SOURCE_LENGTH = 2_000;
const PUBLIC_BRAND_IMAGE_PATH =
  /^\/images\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const PUBLIC_BRAND_PREVIEW_PATH =
  /^\/images\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i;

function trimmedSource(value: unknown) {
  if (typeof value !== "string") return null;
  const source = value.trim();
  return source && source.length <= MAX_BRAND_ASSET_SOURCE_LENGTH
    ? source
    : null;
}

export function safePublicBrandImageSource(value: unknown): string | null {
  const source = trimmedSource(value);
  return source && PUBLIC_BRAND_IMAGE_PATH.test(source) ? source : null;
}

export function safePublicBrandPreviewSource(value: unknown): string | null {
  const source = trimmedSource(value);
  return source && PUBLIC_BRAND_PREVIEW_PATH.test(source) ? source : null;
}

export function safeBrandFaviconSource(value: unknown): string | null {
  const source = trimmedSource(value);
  return source === "/favicon.ico" || safePublicBrandImageSource(source)
    ? source
    : null;
}

export function safeLegacyBrandAssetSource(value: unknown): string | null {
  const source = trimmedSource(value);
  if (!source) return null;
  const localSource =
    safeBrandFaviconSource(source) ?? safePublicBrandImageSource(source);
  if (localSource) return localSource;
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function brandLogoSource(
  branding: Pick<
    TenantBranding,
    "logoLightUrl" | "logoDarkUrl" | "logoUrl"
  >,
  surface: "light" | "dark" = "light",
) {
  const preferred =
    surface === "dark" ? branding.logoDarkUrl : branding.logoLightUrl;
  const alternate =
    surface === "dark" ? branding.logoLightUrl : branding.logoDarkUrl;
  return preferred ?? alternate ?? branding.logoUrl;
}
