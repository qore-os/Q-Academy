import { safeRichTextHref } from "@/lib/rich-text/document";

export const VIDEO_END_CARD_VERSION = 1 as const;

export const VIDEO_END_CARD_LIMITS = {
  heading: 180,
  text: 1_500,
  ctaLabel: 120,
} as const;

export type VideoEndCard = {
  version: typeof VIDEO_END_CARD_VERSION;
  heading: string;
  text?: string;
  cta?: {
    label: string;
    href: string;
  };
};

type VideoEndCardFormInput = {
  enabled: boolean;
  heading: unknown;
  text: unknown;
  ctaLabel: unknown;
  ctaHref: unknown;
};

export type VideoEndCardFormResult =
  | { success: true; value: VideoEndCard | null }
  | { success: false; reason: "invalid_content" | "unsafe_href" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizedText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximumLength);
}

export function sanitizeVideoEndCard(input: unknown): VideoEndCard | null {
  if (!isRecord(input) || input.version !== VIDEO_END_CARD_VERSION) return null;

  const heading = sanitizedText(input.heading, VIDEO_END_CARD_LIMITS.heading);
  if (!heading) return null;

  const text = sanitizedText(input.text, VIDEO_END_CARD_LIMITS.text);
  let cta: VideoEndCard["cta"];
  if (input.cta !== undefined) {
    if (!isRecord(input.cta)) return null;
    const label = sanitizedText(
      input.cta.label,
      VIDEO_END_CARD_LIMITS.ctaLabel,
    );
    const href = safeRichTextHref(input.cta.href);
    if (!label || !href) return null;
    cta = { label, href };
  }

  return {
    version: VIDEO_END_CARD_VERSION,
    heading,
    ...(text ? { text } : {}),
    ...(cta ? { cta } : {}),
  };
}

export function videoEndCardFromForm(
  input: VideoEndCardFormInput,
): VideoEndCardFormResult {
  if (!input.enabled) return { success: true, value: null };

  const ctaLabel = sanitizedText(
    input.ctaLabel,
    VIDEO_END_CARD_LIMITS.ctaLabel,
  );
  const rawCtaHref = typeof input.ctaHref === "string" ? input.ctaHref.trim() : "";
  if (Boolean(ctaLabel) !== Boolean(rawCtaHref)) {
    return { success: false, reason: "invalid_content" };
  }
  const href = rawCtaHref ? safeRichTextHref(rawCtaHref) : null;
  if (rawCtaHref && !href) return { success: false, reason: "unsafe_href" };

  const value = sanitizeVideoEndCard({
    version: VIDEO_END_CARD_VERSION,
    heading: input.heading,
    text: input.text,
    ...(ctaLabel && href ? { cta: { label: ctaLabel, href } } : {}),
  });
  return value
    ? { success: true, value }
    : { success: false, reason: "invalid_content" };
}
