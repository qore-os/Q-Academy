import { z } from "zod";

export const MEMBER_SIDEBAR_LINK_ICONS = [
  "link",
  "book-open",
  "life-buoy",
  "video",
  "file-text",
  "globe",
  "messages-square",
  "calendar",
  "home",
  "graduation-cap",
  "library",
  "bookmark",
  "award",
  "trophy",
  "users",
  "user-round",
  "briefcase",
  "building",
  "chart",
  "clipboard-check",
  "circle-help",
  "lightbulb",
  "megaphone",
  "mail",
  "phone",
  "map-pin",
  "rocket",
  "star",
  "target",
  "heart",
  "shield-check",
  "shopping-bag",
] as const;

export type MemberSidebarLinkIcon =
  (typeof MEMBER_SIDEBAR_LINK_ICONS)[number];

export const memberSidebarLinkIconSchema = z.enum(
  MEMBER_SIDEBAR_LINK_ICONS,
);

export function normalizeMemberSidebarHref(value: string) {
  const href = value.trim();
  if (!href || href.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(href)) {
    return null;
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    try {
      const parsed = new URL(href, "https://tenant.invalid");
      if (parsed.origin !== "https://tenant.invalid") return null;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(href);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

const safeHrefSchema = z
  .string()
  .trim()
  .min(1, "Ein Ziel ist erforderlich.")
  .max(2048, "Das Ziel ist zu lang.")
  .transform((value, context) => {
    const normalized = normalizeMemberSidebarHref(value);
    if (!normalized) {
      context.addIssue({
        code: "custom",
        message: "Nur interne Pfade oder HTTPS-Links sind erlaubt.",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const memberSidebarLinkInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    description: z
      .string()
      .trim()
      .max(240)
      .transform((value) => value || null),
    href: safeHrefSchema,
    icon: memberSidebarLinkIconSchema,
    active: z.boolean(),
  })
  .strict();

export const memberSidebarLinkOrderSchema = z
  .array(z.string().uuid())
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Links duerfen in der Sortierung nicht doppelt vorkommen.",
  });
