import "server-only";

import { isIP } from "node:net";
import { and, asc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import {
  customDomainClaims,
  organizations,
  platformSettings,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import {
  BRAND_FONT_OPTIONS,
  BRAND_RADIUS_OPTIONS,
  BRAND_COLOR_MODE_OPTIONS,
  DEFAULT_TENANT_BRANDING,
  type BrandFont,
  type BrandRadius,
  type BrandColorMode,
  type TenantBranding,
} from "@/lib/branding-model";
import {
  safeBrandFaviconSource,
  safeLegacyBrandAssetSource,
  safePublicBrandImageSource,
  safePublicBrandPreviewSource,
} from "@/lib/branding-asset-policy";
import {
  brandingMediaAssetIdShape,
  brandingMediaPath,
} from "@/lib/branding-media-policy";
import { resolveCanonicalAppHostname } from "@/lib/branding-host-policy";
import {
  getPublicAppUrl,
  trustProxyHeaders,
} from "@/lib/server-environment";
import { canonicalOidcOrigin } from "@/lib/oidc-host-policy";
import { tenantLegalUrlSchema } from "@/lib/legal-links";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const fontSchema = z.enum(
  BRAND_FONT_OPTIONS.map((option) => option.value) as [BrandFont, ...BrandFont[]],
);
const radiusSchema = z
  .number()
  .int()
  .refine(
    (value): value is BrandRadius =>
      BRAND_RADIUS_OPTIONS.some((option) => option.value === value),
    "Bitte einen gueltigen Eckenradius waehlen.",
  );
const colorModeSchema = z.enum(
  BRAND_COLOR_MODE_OPTIONS.map((option) => option.value) as [
    BrandColorMode,
    ...BrandColorMode[],
  ],
);

function isHostname(value: string) {
  if (value.length > 253 || value.includes(":") || value.includes("/")) return false;
  if (value === "localhost") return true;
  return value
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    );
}

const nullableAssetUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .refine(
    (value) => value === null || safeLegacyBrandAssetSource(value),
    "Asset-URLs muessen lokal oder HTTP(S) ohne Zugangsdaten sein.",
  )
  .transform((value) => safeLegacyBrandAssetSource(value));

const nullableLocalBrandImageSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .refine(
    (value) => value === null || safePublicBrandImageSource(value),
    "Branding-Bilder muessen unter /images/ liegen.",
  )
  .transform((value) => safePublicBrandImageSource(value));

const nullableSocialPreviewSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .refine(
    (value) => value === null || safePublicBrandPreviewSource(value),
    "Das Link-Vorschaubild muss ein Rasterbild unter /images/ sein.",
  )
  .transform((value) => safePublicBrandPreviewSource(value));

const emailSenderNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(
    /^[^\u0000-\u001f\u007f<>"\\]+$/,
    "Der E-Mail-Absendername enthaelt ungueltige Zeichen.",
  );

export const tenantLoginHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\.$/, ""))
  .refine(isHostname, "Bitte einen Hostnamen ohne Protokoll oder Pfad eingeben.")
  .nullable();

export const tenantBrandingInputSchema = z
  .object({
    platformName: z.string().trim().min(2).max(120),
    primaryColor: colorSchema,
    accentColor: colorSchema,
    logoUrl: nullableAssetUrlSchema,
    logoLightUrl: nullableLocalBrandImageSchema,
    logoDarkUrl: nullableLocalBrandImageSchema,
    ...brandingMediaAssetIdShape,
    faviconUrl: nullableAssetUrlSchema.refine(
      (value) => value === null || safeBrandFaviconSource(value) || /^https?:\/\//i.test(value),
      "Das Favicon muss lokal oder ueber HTTP(S) erreichbar sein.",
    ),
    socialPreviewImageUrl: nullableSocialPreviewSchema,
    emailSenderName: emailSenderNameSchema,
    fontFamily: fontSchema,
    cornerRadius: radiusSchema,
    colorMode: colorModeSchema,
    loginHostname: tenantLoginHostnameSchema,
    loginEyebrow: z.string().trim().min(2).max(60),
    loginTitle: z.string().trim().min(3).max(100),
    loginDescription: z.string().trim().min(10).max(300),
    loginBackgroundUrl: nullableAssetUrlSchema,
    loginBackgroundColor: colorSchema,
    privacyPolicyUrl: tenantLegalUrlSchema,
    aiTransparencyUrl: tenantLegalUrlSchema,
  })
  .strict();

export const tenantBrandingPatchSchema = tenantBrandingInputSchema
  .partial()
  .passthrough();

const storedBrandingSchema = tenantBrandingPatchSchema;

export type BrandingRow = {
  id: string;
  name: string;
  slug: string;
  primaryColor: string;
  accentColor: string;
  logoMark: string;
  settings: Record<string, unknown> | null;
  verifiedLoginHostname?: string | null;
};

type HeaderReader = Pick<Headers, "get">;

function normalizeHostname(value: string | null | undefined) {
  const raw = value?.split(",")[0]?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (!raw || raw.length > 512 || raw.includes("/") || /[\r\n]/.test(raw)) {
    return null;
  }
  if (raw.startsWith("[")) {
    const match = /^\[([^\]]+)](?::\d{1,5})?$/.exec(raw);
    return match?.[1] && isIP(match[1]) === 6 ? match[1] : null;
  }
  const host = raw.replace(/:\d{1,5}$/, "");
  return isIP(host) > 0 || isHostname(host) ? host : null;
}

export function trustedRequestHostname(requestHeaders: HeaderReader) {
  const forwardedHost =
    trustProxyHeaders() ? requestHeaders.get("x-forwarded-host") : null;
  return normalizeHostname(forwardedHost || requestHeaders.get("host"));
}

function configuredPublicOrigin() {
  return getPublicAppUrl();
}

export function canonicalTenantAuthOrigin(
  branding: TenantBranding,
  developmentOrigin?: string | null,
) {
  return canonicalOidcOrigin({
    production: process.env.NODE_ENV === "production",
    developmentOrigin,
    loginHostname: branding.loginHostname,
    organizationSlug: branding.organizationSlug,
    tenantBaseDomain: normalizeHostname(process.env.TENANT_BASE_DOMAIN),
    publicAppUrl: configuredPublicOrigin(),
  });
}

export async function getCanonicalTenantAuthOrigin(organizationId: string) {
  return canonicalTenantAuthOrigin(
    await getTenantBranding(organizationId),
  );
}

export function safeAuthLinkOrigin(input: {
  request: Request;
  expectedOrganizationId: string;
  requestTenant: TenantBranding;
}) {
  const hostname = trustedRequestHostname(input.request.headers);
  if (
    hostname &&
    input.requestTenant.organizationId === input.expectedOrganizationId
  ) {
    const requestUrl = new URL(input.request.url);
    const protocol =
      process.env.NODE_ENV === "production"
        ? "https:"
        : ["http:", "https:"].includes(requestUrl.protocol)
          ? requestUrl.protocol
          : "http:";
    const port = process.env.NODE_ENV === "production" ? "" : requestUrl.port;
    const urlHost = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
    return `${protocol}//${urlHost}${port ? `:${port}` : ""}`;
  }
  return configuredPublicOrigin();
}

export function brandingFromRow(row: BrandingRow): TenantBranding {
  const parsed = storedBrandingSchema.safeParse(row.settings ?? {});
  const settings = parsed.success ? parsed.data : {};
  const logoMark = row.logoMark.trim().slice(0, 12) || row.name.trim().charAt(0) || "Q";
  const platformName = settings.platformName ?? row.name;

  return {
    organizationId: row.id,
    organizationSlug: row.slug,
    platformName,
    primaryColor: settings.primaryColor ?? (colorSchema.safeParse(row.primaryColor).success
      ? row.primaryColor
      : DEFAULT_TENANT_BRANDING.primaryColor),
    accentColor: settings.accentColor ?? (colorSchema.safeParse(row.accentColor).success
      ? row.accentColor
      : DEFAULT_TENANT_BRANDING.accentColor),
    logoMark,
    logoUrl: settings.logoAssetId
      ? brandingMediaPath("logo")
      : settings.logoUrl ?? null,
    logoLightUrl: settings.logoLightAssetId
      ? brandingMediaPath("logo-light")
      : settings.logoLightUrl ?? null,
    logoDarkUrl: settings.logoDarkAssetId
      ? brandingMediaPath("logo-dark")
      : settings.logoDarkUrl ?? null,
    logoAssetId: settings.logoAssetId ?? null,
    logoLightAssetId: settings.logoLightAssetId ?? null,
    logoDarkAssetId: settings.logoDarkAssetId ?? null,
    faviconUrl: settings.faviconAssetId
      ? brandingMediaPath("favicon")
      : settings.faviconUrl ?? DEFAULT_TENANT_BRANDING.faviconUrl,
    faviconAssetId: settings.faviconAssetId ?? null,
    socialPreviewImageUrl: settings.socialPreviewImageAssetId
      ? brandingMediaPath("social-preview")
      : settings.socialPreviewImageUrl ?? null,
    socialPreviewImageAssetId: settings.socialPreviewImageAssetId ?? null,
    emailSenderName: settings.emailSenderName ?? platformName,
    fontFamily: settings.fontFamily ?? DEFAULT_TENANT_BRANDING.fontFamily,
    cornerRadius: settings.cornerRadius ?? DEFAULT_TENANT_BRANDING.cornerRadius,
    colorMode: settings.colorMode ?? DEFAULT_TENANT_BRANDING.colorMode,
    loginHostname: row.verifiedLoginHostname ?? null,
    loginEyebrow:
      settings.loginEyebrow ?? DEFAULT_TENANT_BRANDING.loginEyebrow,
    loginTitle: settings.loginTitle ?? DEFAULT_TENANT_BRANDING.loginTitle,
    loginDescription:
      settings.loginDescription ?? DEFAULT_TENANT_BRANDING.loginDescription,
    loginBackgroundUrl: settings.loginBackgroundAssetId
      ? brandingMediaPath("login-background")
      : settings.loginBackgroundUrl ?? null,
    loginBackgroundAssetId: settings.loginBackgroundAssetId ?? null,
    loginBackgroundColor:
      settings.loginBackgroundColor ??
      DEFAULT_TENANT_BRANDING.loginBackgroundColor,
    privacyPolicyUrl: settings.privacyPolicyUrl ?? null,
    aiTransparencyUrl: settings.aiTransparencyUrl ?? null,
  };
}

async function loadBrandingRows() {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      primaryColor: organizations.primaryColor,
      accentColor: organizations.accentColor,
      logoMark: organizations.logoMark,
      settings: platformSettings.value,
      verifiedLoginHostname: customDomainClaims.hostname,
    })
    .from(organizations)
    .leftJoin(
      platformSettings,
      and(
        eq(platformSettings.organizationId, organizations.id),
        eq(platformSettings.key, "design"),
      ),
    )
    .leftJoin(
      customDomainClaims,
      and(
        eq(customDomainClaims.organizationId, organizations.id),
        eq(customDomainClaims.status, "verified"),
        isNull(customDomainClaims.revokedAt),
      ),
    )
    .where(eq(organizations.status, "active"))
    .orderBy(asc(organizations.createdAt), asc(organizations.id));
}

export async function getTenantBranding(organizationId: string) {
  const row = (await loadBrandingRows()).find(
    (candidate) => candidate.id === organizationId,
  );
  return row ? brandingFromRow(row) : DEFAULT_TENANT_BRANDING;
}

export type PublicBrandingHostConfiguration = {
  appDomain?: string | null;
  publicAppUrl?: string | null;
  defaultOrganizationSlug?: string | null;
  tenantBaseDomain?: string | null;
  allowLocalhostHosts?: boolean;
};

function runtimePublicBrandingHostConfiguration(): PublicBrandingHostConfiguration {
  return {
    appDomain: process.env.APP_DOMAIN,
    publicAppUrl: configuredPublicOrigin(),
    defaultOrganizationSlug: process.env.DEFAULT_ORGANIZATION_SLUG,
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowLocalhostHosts: process.env.NODE_ENV !== "production",
  };
}

export function publicBrandingFromRows(
  rows: BrandingRow[],
  hostInput?: string | null,
  configuration = runtimePublicBrandingHostConfiguration(),
) {
  const hostname = normalizeHostname(hostInput);
  if (!rows.length) return DEFAULT_TENANT_BRANDING;

  const canonicalAppHostname = resolveCanonicalAppHostname({
    appDomain: configuration.appDomain,
    publicAppUrl: configuration.publicAppUrl,
  });
  if (canonicalAppHostname.status === "invalid") {
    return DEFAULT_TENANT_BRANDING;
  }

  const defaultSlug =
    configuration.defaultOrganizationSlug?.trim() || "q-academy";
  const configuredDefaults = rows.filter((row) => row.slug === defaultSlug);
  if (
    hostname &&
    canonicalAppHostname.status === "resolved" &&
    hostname === canonicalAppHostname.hostname
  ) {
    return configuredDefaults.length === 1
      ? brandingFromRow(configuredDefaults[0])
      : DEFAULT_TENANT_BRANDING;
  }

  const exactHosts = hostname
    ? rows.filter((row) => brandingFromRow(row).loginHostname === hostname)
    : [];
  if (exactHosts.length === 1) return brandingFromRow(exactHosts[0]);
  if (exactHosts.length > 1) return DEFAULT_TENANT_BRANDING;

  const baseDomain = normalizeHostname(configuration.tenantBaseDomain);
  const subdomainMatches = hostname
    ? rows.filter(
        (row) =>
          (configuration.allowLocalhostHosts === true &&
            hostname === `${row.slug}.localhost`) ||
          (baseDomain && hostname === `${row.slug}.${baseDomain}`),
      )
    : [];
  if (subdomainMatches.length === 1) {
    return brandingFromRow(subdomainMatches[0]);
  }
  if (subdomainMatches.length > 1) return DEFAULT_TENANT_BRANDING;

  const localHostname =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (
    configuredDefaults.length === 1 &&
    configuration.allowLocalhostHosts === true &&
    localHostname
  ) {
    return brandingFromRow(configuredDefaults[0]);
  }

  return DEFAULT_TENANT_BRANDING;
}

export async function getPublicBrandingForHostname(hostInput?: string | null) {
  return publicBrandingFromRows(await loadBrandingRows(), hostInput);
}

export async function getPublicBrandingForRequest(
  requestHeaders: HeaderReader,
) {
  return publicBrandingFromRows(
    await loadBrandingRows(),
    trustedRequestHostname(requestHeaders),
  );
}

export async function getAuthTenantForRequest(requestHeaders: HeaderReader) {
  return getPublicBrandingForRequest(requestHeaders);
}

export async function resolveRequestBranding() {
  const session = await getSession();
  if (session) return getTenantBranding(session.organizationId);
  const requestHeaders = await headers();
  return getPublicBrandingForRequest(requestHeaders);
}
