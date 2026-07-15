import { z } from "zod";

import {
  MAX_RICH_TEXT_JSON_LENGTH,
  richTextDocumentHasContent,
  sanitizeRichTextDocument,
  type RichTextDocument,
  type RichTextInline,
} from "@/lib/rich-text/document";

export const SUBMISSION_TEXT_PROJECTION_VERSION = 1 as const;
export const MAX_SUBMISSION_PLAIN_TEXT_LENGTH = 50_000;

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function projectInline(nodes: readonly RichTextInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return normalizeNewlines(node.text);
      if (node.type === "linebreak") return "\n";
      return projectInline(node.children);
    })
    .join("");
}

/**
 * Projection v1 is the immutable offset coordinate system for text reviews.
 * JavaScript string offsets therefore use UTF-16 code units.
 */
export function projectSubmissionRichTextPlainText(
  document: RichTextDocument,
) {
  return document.blocks
    .map((block) => {
      if (block.type === "list") {
        return block.items.map((item) => projectInline(item.children)).join("\n");
      }
      return projectInline(block.children);
    })
    .join("\n\n")
    .trim();
}

function serializedLength(input: unknown) {
  try {
    return JSON.stringify(input)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const richTextTextInputSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(MAX_SUBMISSION_PLAIN_TEXT_LENGTH),
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
  })
  .strict();

const richTextLineBreakInputSchema = z
  .object({ type: z.literal("linebreak") })
  .strict();

const richTextLeafInputSchema = z.discriminatedUnion("type", [
  richTextTextInputSchema,
  richTextLineBreakInputSchema,
]);

const richTextLinkInputSchema = z
  .object({
    type: z.literal("link"),
    href: z.string().max(2_000),
    children: z.array(richTextLeafInputSchema).max(1_000),
  })
  .strict();

const richTextInlineInputSchema = z.discriminatedUnion("type", [
  richTextTextInputSchema,
  richTextLineBreakInputSchema,
  richTextLinkInputSchema,
]);

const richTextChildrenInputSchema = z.array(richTextInlineInputSchema).max(1_000);

const richTextBlockInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("paragraph"),
      children: richTextChildrenInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3)]),
      children: richTextChildrenInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      style: z.enum(["bullet", "number"]),
      items: z
        .array(
          z.object({ children: richTextChildrenInputSchema }).strict(),
        )
        .max(100),
    })
    .strict(),
]);

const strictRichTextDocumentInputSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(richTextBlockInputSchema).max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if (serializedLength(input) > MAX_RICH_TEXT_JSON_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Das Rich-Text-Dokument ist zu gross.",
      });
    }

    let inlineNodes = 0;
    let textLength = 0;
    const countChildren = (
      children: z.infer<typeof richTextChildrenInputSchema>,
    ) => {
      for (const node of children) {
        inlineNodes += 1;
        if (node.type === "text") textLength += node.text.length;
        if (node.type === "link") {
          inlineNodes += node.children.length;
          for (const child of node.children) {
            if (child.type === "text") textLength += child.text.length;
          }
        }
      }
    };
    for (const block of input.blocks) {
      if (block.type === "list") {
        for (const item of block.items) countChildren(item.children);
      } else {
        countChildren(block.children);
      }
    }
    if (inlineNodes > 1_000) {
      context.addIssue({
        code: "custom",
        message: "Das Rich-Text-Dokument enthaelt zu viele Inline-Elemente.",
      });
    }
    if (textLength > MAX_SUBMISSION_PLAIN_TEXT_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Das Rich-Text-Dokument enthaelt zu viel Text.",
      });
    }
  });

export const submissionRichTextDocumentSchema =
  strictRichTextDocumentInputSchema.transform(
    (input, context): RichTextDocument => {
      const document = sanitizeRichTextDocument(input);

      if (!richTextDocumentHasContent(document)) {
        context.addIssue({
          code: "custom",
          message: "Rich-Text-Abgaben duerfen nicht leer sein.",
        });
        return z.NEVER;
      }

      const projection = projectSubmissionRichTextPlainText(document);
      if (
        projection.length === 0 ||
        projection.length > MAX_SUBMISSION_PLAIN_TEXT_LENGTH
      ) {
        context.addIssue({
          code: "custom",
          message: "Die Textprojektion der Abgabe ist ungueltig oder zu gross.",
        });
        return z.NEVER;
      }
      return document;
    },
  );

export function parseSubmissionRichTextDocumentJson(value: string) {
  if (!value || value.length > MAX_RICH_TEXT_JSON_LENGTH) return null;
  try {
    const parsed = submissionRichTextDocumentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
