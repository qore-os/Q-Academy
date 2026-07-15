import type { CSSProperties } from "react";

export const BRANDING_CACHE_TAG = "tenant-branding";

export const BRAND_FONT_OPTIONS = [
  { value: "geist", label: "Geist", css: "var(--font-geist-sans), Arial, Helvetica, sans-serif" },
  { value: "system", label: "System", css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { value: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { value: "georgia", label: "Georgia", css: "Georgia, 'Times New Roman', serif" },
] as const;

export const BRAND_RADIUS_OPTIONS = [
  { value: 0, label: "Kantig" },
  { value: 4, label: "Dezent" },
  { value: 8, label: "Ausgewogen" },
] as const;

export const BRAND_COLOR_MODE_OPTIONS = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  { value: "system", label: "System" },
] as const;

export type BrandFont = (typeof BRAND_FONT_OPTIONS)[number]["value"];
export type BrandRadius = (typeof BRAND_RADIUS_OPTIONS)[number]["value"];
export type BrandColorMode =
  (typeof BRAND_COLOR_MODE_OPTIONS)[number]["value"];

export type TenantBranding = {
  organizationId: string | null;
  organizationSlug: string | null;
  platformName: string;
  primaryColor: string;
  accentColor: string;
  logoMark: string;
  logoUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  logoAssetId: string | null;
  logoLightAssetId: string | null;
  logoDarkAssetId: string | null;
  faviconUrl: string;
  faviconAssetId: string | null;
  socialPreviewImageUrl: string | null;
  socialPreviewImageAssetId: string | null;
  emailSenderName: string;
  fontFamily: BrandFont;
  cornerRadius: BrandRadius;
  colorMode: BrandColorMode;
  loginHostname: string | null;
  loginEyebrow: string;
  loginTitle: string;
  loginDescription: string;
  loginBackgroundUrl: string | null;
  loginBackgroundAssetId: string | null;
  loginBackgroundColor: string;
  privacyPolicyUrl: string | null;
  aiTransparencyUrl: string | null;
};

export const DEFAULT_TENANT_BRANDING: TenantBranding = {
  organizationId: null,
  organizationSlug: null,
  platformName: "Q-Academy",
  primaryColor: "#17324d",
  accentColor: "#2bb7a9",
  logoMark: "Q",
  logoUrl: null,
  logoLightUrl: null,
  logoDarkUrl: null,
  logoAssetId: null,
  logoLightAssetId: null,
  logoDarkAssetId: null,
  faviconUrl: "/favicon.ico",
  faviconAssetId: null,
  socialPreviewImageUrl: null,
  socialPreviewImageAssetId: null,
  emailSenderName: "Q-Academy",
  fontFamily: "geist",
  cornerRadius: 8,
  colorMode: "light",
  loginHostname: null,
  loginEyebrow: "Willkommen zurueck",
  loginTitle: "Lernen, anwenden, besser werden.",
  loginDescription:
    "Melde dich an und setze deinen persoenlichen KI-Lernpfad fort.",
  loginBackgroundUrl: null,
  loginBackgroundAssetId: null,
  loginBackgroundColor: "#0f263c",
  privacyPolicyUrl: null,
  aiTransparencyUrl: null,
};

function colorChannels(value: string) {
  const normalized = value.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [0, 0, 0] as const;
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as unknown as readonly [number, number, number];
}

function relativeLuminance(value: string) {
  const channels = colorChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function colorContrast(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function accessibleForeground(background: string, candidates: readonly string[]) {
  return candidates.reduce((best, candidate) =>
    colorContrast(background, candidate) > colorContrast(background, best)
      ? candidate
      : best,
  );
}

export function brandingCssVariables(branding: TenantBranding): CSSProperties {
  const font =
    BRAND_FONT_OPTIONS.find((option) => option.value === branding.fontFamily)?.css ??
    BRAND_FONT_OPTIONS[0].css;

  return {
    "--brand-primary": branding.primaryColor,
    "--brand-accent": branding.accentColor,
    "--brand-accent-foreground": accessibleForeground(
      branding.accentColor,
      ["#ffffff", "#0f263c"],
    ),
    "--brand-primary-foreground": accessibleForeground(
      branding.primaryColor,
      ["#ffffff", "#0f263c"],
    ),
    "--brand-font-family": font,
    "--brand-radius": `${branding.cornerRadius}px`,
    fontFamily: "var(--brand-font-family)",
  } as CSSProperties;
}
