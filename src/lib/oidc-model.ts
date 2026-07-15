import { domainToASCII } from "node:url";
import { z } from "zod";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const SAFE_RETURN_FRAGMENT = /^#[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;
const FRESH_AUTHENTICATION_MAX_AGE_MS = 5 * 60_000;
const FRESH_AUTHENTICATION_FUTURE_SKEW_MS = 60_000;

function textSchema(label: string, minimum: number, maximum: number) {
  return z
    .string()
    .trim()
    .min(minimum, `${label} ist zu kurz.`)
    .max(maximum, `${label} ist zu lang.`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: `${label} enthaelt ungueltige Steuerzeichen.`,
    });
}

export const OIDC_DEFAULT_DISPLAY_NAME = "Unternehmens-Login";
export const OIDC_DEFAULT_CONFIGURATION = {
  enabled: false,
  displayName: OIDC_DEFAULT_DISPLAY_NAME,
  issuer: null,
  clientId: null,
  clientSecretConfigured: false,
  autoProvisionMembers: false,
  allowedEmailDomains: [] as string[],
  passwordLoginEnabled: true,
  version: 0,
} as const;

export const oidcDisplayNameSchema = textSchema(
  "Der Anzeigename",
  2,
  80,
);

export const oidcClientIdSchema = textSchema("Die Client-ID", 1, 512);

export const oidcClientSecretSchema = z
  .string()
  .min(8, "Das Client-Secret ist zu kurz.")
  .max(4096, "Das Client-Secret ist zu lang.")
  .refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "Das Client-Secret enthaelt ungueltige Steuerzeichen.",
  });

export type NormalizeOidcIssuerOptions = {
  allowInsecureLocalhost?: boolean;
};

export function normalizeOidcIssuer(
  input: string,
  options: NormalizeOidcIssuerOptions = {},
) {
  const trimmed = input.normalize("NFKC").trim();
  if (!trimmed || trimmed.length > 2000 || CONTROL_CHARACTERS.test(trimmed)) {
    throw new Error("Die Issuer-URL ist ungueltig.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Die Issuer-URL ist ungueltig.");
  }

  const hostname = url.hostname.toLowerCase();
  const localHostname =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1";
  const protocolAllowed =
    url.protocol === "https:" ||
    (options.allowInsecureLocalhost === true &&
      url.protocol === "http:" &&
      localHostname);
  if (
    !protocolAllowed ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostname
  ) {
    throw new Error("Die Issuer-URL ist ungueltig.");
  }

  url.hostname = hostname;
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function normalizeOidcEmailDomain(input: string) {
  const trimmed = input.normalize("NFKC").trim().toLowerCase();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const ascii = domainToASCII(withoutAt);
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii.includes("..") ||
    ascii.startsWith(".") ||
    ascii.endsWith(".") ||
    CONTROL_CHARACTERS.test(ascii)
  ) {
    throw new Error("Die E-Mail-Domain ist ungueltig.");
  }
  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !HOST_LABEL.test(label)) ||
    labels.at(-1)!.length < 2
  ) {
    throw new Error("Die E-Mail-Domain ist ungueltig.");
  }
  return ascii;
}

export function normalizeOidcEmailDomains(input: readonly string[]) {
  if (input.length > 50) {
    throw new Error("Es sind hoechstens 50 E-Mail-Domains erlaubt.");
  }
  return [...new Set(input.map(normalizeOidcEmailDomain))].sort();
}

const nullableTrimmedString = z
  .union([z.string(), z.null()])
  .transform((value) => (typeof value === "string" && value.trim() ? value : null));

export const oidcConfigurationInputSchema = z
  .object({
    enabled: z.boolean(),
    displayName: oidcDisplayNameSchema,
    issuer: nullableTrimmedString,
    clientId: nullableTrimmedString,
    clientSecret: z.union([oidcClientSecretSchema, z.literal(""), z.null()]).optional(),
    autoProvisionMembers: z.boolean(),
    allowedEmailDomains: z.array(z.string()).max(50),
    passwordLoginEnabled: z.boolean(),
  })
  .strict();

export const oidcConfigurationPatchSchema = oidcConfigurationInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Mindestens ein OIDC-Feld muss gesetzt sein.",
  });

export type OidcConfigurationInput = z.infer<
  typeof oidcConfigurationInputSchema
>;
export type OidcConfigurationPatch = z.infer<
  typeof oidcConfigurationPatchSchema
>;

export type OidcConfigurationView = {
  enabled: boolean;
  displayName: string;
  issuer: string | null;
  clientId: string | null;
  clientSecretConfigured: boolean;
  autoProvisionMembers: boolean;
  allowedEmailDomains: string[];
  passwordLoginEnabled: boolean;
  version: number;
  updatedAt: Date | null;
};

export const oidcIdentityClaimsSchema = z
  .object({
    sub: z
      .string()
      .min(1, "Der Subject-Claim ist zu kurz.")
      .max(512, "Der Subject-Claim ist zu lang.")
      .refine((value) => value.trim().length > 0, {
        message: "Der Subject-Claim ist leer.",
      })
      .refine((value) => !CONTROL_CHARACTERS.test(value), {
        message: "Der Subject-Claim enthaelt ungueltige Steuerzeichen.",
      }),
    email: z
      .string()
      .trim()
      .email("Der Identity Provider hat keine gueltige E-Mail geliefert.")
      .max(255)
      .transform((value) => value.normalize("NFKC").toLowerCase()),
    email_verified: z.literal(true, {
      error: "Der Identity Provider hat die E-Mail nicht verifiziert.",
    }),
    given_name: textSchema("Der Vorname", 1, 100).optional(),
    family_name: textSchema("Der Nachname", 1, 100).optional(),
    name: textSchema("Der Name", 1, 220).optional(),
  })
  .passthrough();

export type OidcIdentityClaims = z.infer<typeof oidcIdentityClaimsSchema>;

export function oidcEmailIsAllowed(
  email: string,
  allowedDomains: readonly string[],
) {
  if (allowedDomains.length === 0) return true;
  const separator = email.lastIndexOf("@");
  if (separator < 1) return false;
  const domain = domainToASCII(email.slice(separator + 1).toLowerCase());
  return allowedDomains.some((allowed) => domain === allowed);
}

export function oidcNamesFromClaims(claims: OidcIdentityClaims) {
  const fullName = claims.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const emailLocalPart = claims.email.split("@")[0] || "Mitglied";
  return {
    firstName:
      claims.given_name ?? fullName[0] ?? emailLocalPart.slice(0, 100),
    lastName:
      claims.family_name ??
      (fullName.length > 1 ? fullName.slice(1).join(" ").slice(0, 100) : "SSO"),
  };
}

export const oidcLoginTransactionSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    organizationId: z.string().uuid(),
    issuer: z.string().min(1).max(2000),
    configurationVersion: z.number().int().min(1),
    redirectUri: z.string().url().max(2000),
    returnTo: z.string().min(1).max(300),
    linkUserId: z.string().uuid().nullable(),
    linkSessionId: z.string().uuid().nullable(),
    requireFreshAuthentication: z.boolean(),
  })
  .refine(
    (value) => Boolean(value.linkUserId) === Boolean(value.linkSessionId),
    "OIDC-Link-Identitaet und Sitzung muessen gemeinsam gebunden sein.",
  )
  .strict();

export type OidcLoginTransaction = z.infer<
  typeof oidcLoginTransactionSchema
>;

export function parseOidcAuthenticationTime(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const milliseconds = value * 1000;
  if (!Number.isFinite(milliseconds)) return null;
  const authenticationTime = new Date(milliseconds);
  return Number.isFinite(authenticationTime.getTime())
    ? authenticationTime
    : null;
}

export function isFreshOidcAuthenticationTime(
  authenticationTime: Date | null,
  now = Date.now(),
) {
  const value = authenticationTime?.getTime();
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= now - FRESH_AUTHENTICATION_MAX_AGE_MS &&
    value <= now + FRESH_AUTHENTICATION_FUTURE_SKEW_MS
  );
}

export function sanitizeOidcReturnTo(input: string | null | undefined) {
  if (!input || input.length > 300 || CONTROL_CHARACTERS.test(input)) {
    return "/";
  }
  if (!input.startsWith("/") || input.startsWith("//") || input.includes("\\")) {
    return "/";
  }
  let parsed: URL;
  try {
    parsed = new URL(input, "https://q-academy.invalid");
  } catch {
    return "/";
  }
  if (
    parsed.origin !== "https://q-academy.invalid" ||
    (!["/academy", "/admin"].some(
      (area) =>
        parsed.pathname === area || parsed.pathname.startsWith(`${area}/`),
    ))
  ) {
    return "/";
  }
  const safeFragment = SAFE_RETURN_FRAGMENT.test(parsed.hash) ? parsed.hash : "";
  return `${parsed.pathname}${parsed.search}${safeFragment}`;
}

export function oidcDestinationForRole(
  role: "owner" | "admin" | "trainer" | "member",
  returnTo: string,
) {
  const normalized = sanitizeOidcReturnTo(returnTo);
  const pathname = normalized.split(/[?#]/, 1)[0];
  if (role === "member") {
    return pathname === "/academy" || pathname.startsWith("/academy/")
      ? normalized
      : "/academy";
  }
  if (pathname === "/academy/profile") return normalized;
  return pathname === "/admin" || pathname.startsWith("/admin/")
    ? normalized
    : "/admin";
}
