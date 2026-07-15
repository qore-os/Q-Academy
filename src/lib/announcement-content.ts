import { z } from "zod";

import {
  createRichTextDocument,
  richTextDocumentHasContent,
  sanitizeRichTextDocument,
  type RichTextDocument,
  type RichTextInline,
} from "@/lib/rich-text/document";
import { renderPersonalizedTemplateText } from "@/lib/member-property-model";

export const ANNOUNCEMENT_CONTENT_VERSION = 1 as const;
export const MAX_ANNOUNCEMENT_CONTENT_BLOCKS = 16;
export const MAX_ANNOUNCEMENT_CONTENT_JSON_LENGTH = 30_000;

const LEGACY_RICH_TEXT_BLOCK_ID = "00000000-0000-4000-8000-000000000001";
const LEGACY_CTA_BLOCK_ID = "00000000-0000-4000-8000-000000000002";

export type AnnouncementContentBlock =
  | {
      id: string;
      type: "rich_text";
      document: RichTextDocument;
    }
  | {
      id: string;
      type: "callout";
      tone: "info" | "success" | "warning" | "critical";
      title: string | null;
      body: string;
    }
  | {
      id: string;
      type: "divider";
      style: "solid" | "dashed" | "dotted";
    }
  | {
      id: string;
      type: "cta";
      label: string;
      href: string;
      style: "primary" | "secondary";
    };

export type AnnouncementContentDocument = {
  version: typeof ANNOUNCEMENT_CONTENT_VERSION;
  blocks: AnnouncementContentBlock[];
};

function cleanPlainText(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function safeAnnouncementHref(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > 2_000 ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }
  if (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.startsWith("/\\")
  ) {
    return candidate;
  }
  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

const announcementRichTextSchema = z.unknown().transform((value, context) => {
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    context.addIssue({ code: "custom", message: "Der Rich-Text ist ungueltig." });
    return z.NEVER;
  }
  if (utf8Length(serialized) > MAX_ANNOUNCEMENT_CONTENT_JSON_LENGTH) {
    context.addIssue({ code: "custom", message: "Der Rich-Text ist zu gross." });
    return z.NEVER;
  }
  const document = sanitizeRichTextDocument(value);
  if (!richTextDocumentHasContent(document)) {
    context.addIssue({ code: "custom", message: "Der Rich-Text ist leer." });
    return z.NEVER;
  }
  if (document.blocks.length > 40 || richTextToPlainText(document).length > 5_000) {
    context.addIssue({ code: "custom", message: "Der Rich-Text ist zu lang." });
    return z.NEVER;
  }
  return document;
});

const announcementHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .transform((value, context) => {
    const href = safeAnnouncementHref(value);
    if (!href) {
      context.addIssue({
        code: "custom",
        message: "Der Link muss intern oder eine sichere HTTP(S)-URL sein.",
      });
      return z.NEVER;
    }
    return href;
  });

const announcementContentBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string().uuid(),
      type: z.literal("rich_text"),
      document: announcementRichTextSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      type: z.literal("callout"),
      tone: z.enum(["info", "success", "warning", "critical"]),
      title: z.string().trim().min(1).max(120).nullable(),
      body: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      type: z.literal("divider"),
      style: z.enum(["solid", "dashed", "dotted"]),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      type: z.literal("cta"),
      label: z.string().trim().min(1).max(80),
      href: announcementHrefSchema,
      style: z.enum(["primary", "secondary"]),
    })
    .strict(),
]);

export const announcementContentDocumentSchema = z
  .object({
    version: z.literal(ANNOUNCEMENT_CONTENT_VERSION),
    blocks: z
      .array(announcementContentBlockSchema)
      .min(1)
      .max(MAX_ANNOUNCEMENT_CONTENT_BLOCKS),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      utf8Length(JSON.stringify(document)) >
      MAX_ANNOUNCEMENT_CONTENT_JSON_LENGTH
    ) {
      context.addIssue({
        code: "custom",
        message: "Das Blockdokument ist zu gross.",
        path: ["blocks"],
      });
    }
    const ids = new Set<string>();
    for (const [index, block] of document.blocks.entries()) {
      if (ids.has(block.id)) {
        context.addIssue({
          code: "custom",
          message: "Block-IDs muessen eindeutig sein.",
          path: ["blocks", index, "id"],
        });
      }
      ids.add(block.id);
    }
    if (!document.blocks.some((block) => block.type !== "divider")) {
      context.addIssue({
        code: "custom",
        message: "Die Ankuendigung benoetigt einen Inhaltsblock.",
        path: ["blocks"],
      });
    }
    if (announcementContentToLegacyProjection(document).body.length < 3) {
      context.addIssue({
        code: "custom",
        message: "Die Ankuendigung benoetigt mindestens drei Zeichen Inhalt.",
        path: ["blocks"],
      });
    }
  });

export const EMPTY_ANNOUNCEMENT_CONTENT_DOCUMENT: AnnouncementContentDocument = {
  version: ANNOUNCEMENT_CONTENT_VERSION,
  blocks: [],
};

export function parseAnnouncementContentDocument(value: unknown) {
  return announcementContentDocumentSchema.safeParse(value);
}

export function announcementContentFromLegacy(input: {
  body: string;
  href?: string | null;
  actionLabel?: string | null;
}): AnnouncementContentDocument {
  const body = cleanPlainText(input.body, 5_000);
  const href = safeAnnouncementHref(input.href);
  const label = cleanPlainText(input.actionLabel ?? "", 80);
  const blocks: AnnouncementContentBlock[] = [];
  if (body) {
    blocks.push({
      id: LEGACY_RICH_TEXT_BLOCK_ID,
      type: "rich_text",
      document: createRichTextDocument(body),
    });
  }
  if (href) {
    blocks.push({
      id: LEGACY_CTA_BLOCK_ID,
      type: "cta",
      label: label || "Mehr erfahren",
      href,
      style: "primary",
    });
  }
  return { version: ANNOUNCEMENT_CONTENT_VERSION, blocks };
}

export function normalizeAnnouncementContent(input: {
  contentDocument: unknown;
  body: string;
  href?: string | null;
  actionLabel?: string | null;
}) {
  const parsed = announcementContentDocumentSchema.safeParse(
    input.contentDocument,
  );
  return parsed.success ? parsed.data : announcementContentFromLegacy(input);
}

function inlineToPlainText(nodes: readonly RichTextInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "linebreak") return "\n";
      return inlineToPlainText(node.children);
    })
    .join("");
}

export function richTextToPlainText(document: RichTextDocument) {
  return document.blocks
    .flatMap((block) =>
      block.type === "list"
        ? block.items.map((item) => inlineToPlainText(item.children))
        : [inlineToPlainText(block.children)],
    )
    .join("\n")
    .trim();
}

export function announcementContentToLegacyProjection(
  document: AnnouncementContentDocument,
) {
  const bodyParts = document.blocks.flatMap((block) => {
    if (block.type === "rich_text") return [richTextToPlainText(block.document)];
    if (block.type === "callout") {
      return [`${block.title ? `${block.title}\n` : ""}${block.body}`];
    }
    return [];
  });
  const cta = document.blocks.find(
    (block): block is Extract<AnnouncementContentBlock, { type: "cta" }> =>
      block.type === "cta",
  );
  return {
    body: cleanPlainText(bodyParts.filter(Boolean).join("\n\n"), 5_000),
    href: cta?.href ?? null,
    actionLabel: cta?.label ?? null,
  };
}

export function announcementContentPersonalizationValues(
  document: AnnouncementContentDocument,
) {
  return document.blocks.flatMap((block) => {
    if (block.type === "rich_text") {
      return block.document.blocks.flatMap((richBlock) =>
        richBlock.type === "list"
          ? richBlock.items.map((item) => inlineToPlainText(item.children))
          : [inlineToPlainText(richBlock.children)],
      );
    }
    if (block.type === "callout") return [block.title ?? "", block.body];
    if (block.type === "cta") return [block.label];
    return [];
  });
}

function personalizeInline(
  nodes: readonly RichTextInline[],
  variables: Readonly<Record<string, string>>,
): RichTextInline[] {
  return nodes.map((node) => {
    if (node.type === "text") {
      return {
        ...node,
        text: renderPersonalizedTemplateText(node.text, variables),
      };
    }
    if (node.type === "link") {
      return {
        ...node,
        children: node.children.map((child) =>
          child.type === "text"
            ? {
                ...child,
                text: renderPersonalizedTemplateText(child.text, variables),
              }
            : child,
        ),
      };
    }
    return node;
  });
}

function personalizeRichText(
  document: RichTextDocument,
  variables: Readonly<Record<string, string>>,
) {
  return sanitizeRichTextDocument({
    ...document,
    blocks: document.blocks.map((block) =>
      block.type === "list"
        ? {
            ...block,
            items: block.items.map((item) => ({
              children: personalizeInline(item.children, variables),
            })),
          }
        : { ...block, children: personalizeInline(block.children, variables) },
    ),
  });
}

export function personalizeAnnouncementContent(
  document: AnnouncementContentDocument,
  variables: Readonly<Record<string, string>>,
): AnnouncementContentDocument {
  return {
    version: ANNOUNCEMENT_CONTENT_VERSION,
    blocks: document.blocks.map((block) => {
      if (block.type === "rich_text") {
        return {
          ...block,
          document: personalizeRichText(block.document, variables),
        };
      }
      if (block.type === "callout") {
        return {
          ...block,
          title: block.title
            ? renderPersonalizedTemplateText(block.title, variables)
            : null,
          body: renderPersonalizedTemplateText(block.body, variables),
        };
      }
      if (block.type === "cta") {
        return {
          ...block,
          label: renderPersonalizedTemplateText(block.label, variables),
        };
      }
      return block;
    }),
  };
}
