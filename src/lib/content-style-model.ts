import { z } from "zod";

export const pageLayoutWidthSchema = z.enum(["narrow", "standard", "wide"]);
export const pageBackgroundToneSchema = z.enum(["plain", "soft", "contrast"]);
export const pageContentSpacingSchema = z.enum([
  "compact",
  "comfortable",
  "spacious",
]);

export const pageStyleSchema = z
  .object({
    layoutWidth: pageLayoutWidthSchema,
    backgroundTone: pageBackgroundToneSchema,
    contentSpacing: pageContentSpacingSchema,
  })
  .strict();

export const DEFAULT_PAGE_STYLE = Object.freeze({
  layoutWidth: "standard",
  backgroundTone: "plain",
  contentSpacing: "comfortable",
} as const);

export const contentBlockStyleSchema = z
  .object({
    width: z.enum(["compact", "content", "full"]),
    alignment: z.enum(["left", "center"]),
    surface: z.enum(["plain", "bordered", "muted"]),
  })
  .strict();

export type ContentBlockStyle = z.infer<typeof contentBlockStyleSchema>;

export const DEFAULT_CONTENT_BLOCK_STYLE: ContentBlockStyle = Object.freeze({
  width: "content",
  alignment: "left",
  surface: "plain",
});

export const lessonPageCommandSchema = z
  .object({
    command: z.enum(["move_up", "move_down", "duplicate", "toggle_hidden"]),
    revision: z.number().int().positive(),
  })
  .strict();

