import { z } from "zod";
import {
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
import type { AppLocale } from "@/lib/i18n/model";

export const PLATFORM_CUSTOM_CODE_SETTING_KEY = "custom_code";
export const PLATFORM_CUSTOM_CODE_MAX_LENGTH = 20_000;
export const PLATFORM_CUSTOM_CODE_MAX_ORIGINS = 8;
export const PLATFORM_CUSTOM_CODE_MAX_HEIGHT = 600;
const PLATFORM_CUSTOM_CODE_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const codeSchema = z.string().max(PLATFORM_CUSTOM_CODE_MAX_LENGTH);
const heightSchema = z.number().int().min(0).max(PLATFORM_CUSTOM_CODE_MAX_HEIGHT);

export const platformCustomCodeOriginSchema = z
  .string()
  .trim()
  .url()
  .transform((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Network entries must be HTTPS origins without a path.",
      });
      return z.NEVER;
    }
    return url.origin;
  });

const platformCustomCodeFields = {
  revision: z.number().int().min(0),
  enabled: z.boolean(),
  headerCode: codeSchema,
  headerHeight: heightSchema,
  footerCode: codeSchema,
  footerHeight: heightSchema,
  allowedNetworkOrigins: z
    .array(platformCustomCodeOriginSchema)
    .max(PLATFORM_CUSTOM_CODE_MAX_ORIGINS),
};

export const platformCustomCodeInputSchema = z
  .object(platformCustomCodeFields)
  .transform((value) => ({
    ...value,
    allowedNetworkOrigins: [...new Set(value.allowedNetworkOrigins)],
  }));

export const storedPlatformCustomCodeSchema = z
  .object({
    ...platformCustomCodeFields,
    version: z.literal(1),
    revision: z.number().int().min(1),
  })
  .strict()
  .transform((value) => ({
    ...value,
    allowedNetworkOrigins: [...new Set(value.allowedNetworkOrigins)],
  }));

export type PlatformCustomCodeConfiguration = z.infer<
  typeof storedPlatformCustomCodeSchema
>;

export const DEFAULT_PLATFORM_CUSTOM_CODE: PlatformCustomCodeConfiguration = {
  version: 1,
  revision: 1,
  enabled: false,
  headerCode: "",
  headerHeight: 0,
  footerCode: "",
  footerHeight: 0,
  allowedNetworkOrigins: [],
};

export function parsePlatformCustomCodeOrigins(value: unknown) {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizePlatformCustomCodeValue(value: unknown) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
}

function directive(origins: string[]) {
  return origins.length > 0 ? origins.join(" ") : "'none'";
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

type HtmlNode = DefaultTreeAdapterMap["node"];

function applyScriptNonce(node: HtmlNode, nonce: string) {
  if ("tagName" in node && node.tagName === "script") {
    node.attrs = [
      ...node.attrs.filter((attribute) => attribute.name !== "nonce"),
      { name: "nonce", value: nonce },
    ];
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) applyScriptNonce(child, nonce);
  }
  if ("content" in node) applyScriptNonce(node.content, nonce);
}

function codeWithNonce(value: string, nonce: string) {
  const fragment = parseFragment(value);
  applyScriptNonce(fragment, nonce);
  return serialize(fragment);
}

export function platformCustomCodeDocument(input: {
  code: string;
  locale: AppLocale;
  allowedNetworkOrigins: string[];
  nonce: string;
}) {
  const parsedOrigins = z
    .array(platformCustomCodeOriginSchema)
    .max(PLATFORM_CUSTOM_CODE_MAX_ORIGINS)
    .safeParse(input.allowedNetworkOrigins);
  if (
    !PLATFORM_CUSTOM_CODE_NONCE_PATTERN.test(input.nonce) ||
    !input.code.trim() ||
    input.code.length > PLATFORM_CUSTOM_CODE_MAX_LENGTH ||
    !parsedOrigins.success
  ) {
    return null;
  }
  const origins = [...new Set(parsedOrigins.data)];
  const external = directive(origins);
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "navigate-to 'none'",
    `connect-src ${external}`,
    `img-src data: blob: ${external}`,
    `media-src data: blob: ${external}`,
    `font-src data: ${external}`,
    `style-src 'unsafe-inline' ${external}`,
    `script-src 'unsafe-inline' ${external}`,
    `frame-src ${external}`,
    "worker-src 'none'",
  ].join("; ");

  return [
    "<!doctype html>",
    `<html lang="${input.locale}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>html,body{margin:0;padding:0;max-width:100%;overflow-x:hidden;background:transparent;color-scheme:light dark}</style>",
    "</head>",
    `<body>${codeWithNonce(input.code, input.nonce)}</body>`,
    "</html>",
  ].join("");
}
