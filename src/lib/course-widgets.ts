import { z } from "zod";

import { safeCourseImageSource } from "@/lib/content-blocks/interactive-documents";
import { safeRichTextHref } from "@/lib/rich-text/document";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function safeText(minLength: number, maxLength: number) {
  return z
    .string()
    .trim()
    .min(minLength)
    .max(maxLength)
    .refine(
      (value) => !CONTROL_CHARACTERS.test(value),
      "Text enthaelt ungueltige Steuerzeichen.",
    );
}

const optionalText = (maxLength: number) =>
  z.union([safeText(1, maxLength), z.literal(""), z.null()]).optional();

export const courseWidgetLinkSchema = z
  .string()
  .trim()
  .max(2_000)
  .transform((value, context) => {
    const href = safeRichTextHref(value);
    if (!href) {
      context.addIssue({
        code: "custom",
        message: "Link muss intern oder eine sichere HTTP(S)-URL sein.",
      });
      return z.NEVER;
    }
    return href;
  });

export const courseWidgetImageSchema = z
  .string()
  .trim()
  .max(2_000)
  .transform((value, context) => {
    const source = safeCourseImageSource(value);
    if (
      !source ||
      !(source.startsWith("/images/") || source.startsWith("https://"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Bildquelle muss ein oeffentliches Kursbild oder eine HTTPS-URL sein; private Medien-Downloads sind nicht erlaubt.",
      });
      return z.NEVER;
    }
    return source;
  });

export function courseWidgetMediaUrl(mediaAssetId: string) {
  return `/api/media-assets/${mediaAssetId}/download`;
}

const courseWidgetStoredImageSchema = z
  .string()
  .trim()
  .max(2_000)
  .transform((value, context) => {
    const source = safeCourseImageSource(value);
    if (!source) {
      context.addIssue({
        code: "custom",
        message: "Bildquelle muss eine sichere Kursbildquelle sein.",
      });
      return z.NEVER;
    }
    return source;
  });

const widgetOrder = z.number().int().min(0).max(100_000).optional();

export const courseWidgetCreateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("author"),
      authorUserId: z.string().uuid(),
      roleLabel: optionalText(160),
      description: optionalText(3_000),
      sortOrder: widgetOrder,
    })
    .strict(),
  z
    .object({
      type: z.literal("info"),
      title: safeText(1, 220),
      text: safeText(1, 5_000),
      linkUrl: z
        .union([courseWidgetLinkSchema, z.literal(""), z.null()])
        .optional(),
      sortOrder: widgetOrder,
    })
    .strict(),
  z
    .object({
      type: z.literal("image_link"),
      mediaAssetId: z.string().uuid().nullable().optional(),
      imageUrl: z
        .union([courseWidgetStoredImageSchema, z.literal(""), z.null()])
        .optional(),
      altText: safeText(1, 300),
      linkUrl: courseWidgetLinkSchema,
      sortOrder: widgetOrder,
    })
    .strict()
    .superRefine((input, context) => {
      const mediaAssetId = input.mediaAssetId ?? null;
      const imageUrl = input.imageUrl || null;
      if (mediaAssetId) {
        const canonicalUrl = courseWidgetMediaUrl(mediaAssetId);
        if (imageUrl && imageUrl !== canonicalUrl) {
          context.addIssue({
            code: "custom",
            path: ["imageUrl"],
            message: "Private Bildquelle und Medien-ID stimmen nicht ueberein.",
          });
        }
        return;
      }
      if (!imageUrl) {
        context.addIssue({
          code: "custom",
          path: ["imageUrl"],
          message: "Bildquelle oder privates Bildasset ist erforderlich.",
        });
        return;
      }
      if (!(imageUrl.startsWith("/images/") || imageUrl.startsWith("https://"))) {
        context.addIssue({
          code: "custom",
          path: ["imageUrl"],
          message: "Private Medien-Downloads erfordern die zugehoerige Medien-ID.",
        });
      }
    }),
]);

// Widget types are immutable; PATCH replaces the complete type-specific payload.
export const courseWidgetUpdateSchema = courseWidgetCreateSchema;

export const courseWidgetOrderSchema = z
  .object({
    orderedIds: z
      .array(z.string().uuid())
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Widget-IDs duerfen nicht doppelt vorkommen.",
      ),
  })
  .strict();

export type CourseWidgetInput = z.infer<typeof courseWidgetCreateSchema>;

export function normalizedOptionalWidgetText(value: unknown) {
  return typeof value === "string" && value.length ? value : null;
}

export function courseWidgetValues(input: CourseWidgetInput) {
  const common = { type: input.type, sortOrder: input.sortOrder };
  if (input.type === "author") {
    return {
      ...common,
      authorUserId: input.authorUserId,
      authorRole: normalizedOptionalWidgetText(input.roleLabel),
      authorDescription: normalizedOptionalWidgetText(input.description),
      title: null,
      text: null,
      linkUrl: null,
      imageUrl: null,
      mediaAssetId: null,
      altText: null,
    };
  }
  if (input.type === "info") {
    return {
      ...common,
      authorUserId: null,
      authorRole: null,
      authorDescription: null,
      title: input.title,
      text: input.text,
      linkUrl: normalizedOptionalWidgetText(input.linkUrl),
      imageUrl: null,
      mediaAssetId: null,
      altText: null,
    };
  }
  return {
    ...common,
    authorUserId: null,
    authorRole: null,
    authorDescription: null,
    title: null,
    text: null,
    linkUrl: input.linkUrl,
    imageUrl: input.mediaAssetId
      ? courseWidgetMediaUrl(input.mediaAssetId)
      : input.imageUrl!,
    mediaAssetId: input.mediaAssetId ?? null,
    altText: input.altText,
  };
}
