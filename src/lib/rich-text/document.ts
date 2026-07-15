export const RICH_TEXT_DOCUMENT_VERSION = 1 as const;
export const MAX_RICH_TEXT_JSON_LENGTH = 100_000;

const MAX_BLOCKS = 200;
const MAX_LIST_ITEMS = 100;
const MAX_INLINE_NODES = 1_000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_LINK_LENGTH = 2_000;

export type RichTextText = {
  type: "text";
  text: string;
  bold?: true;
  italic?: true;
};

export type RichTextLineBreak = { type: "linebreak" };

export type RichTextLink = {
  type: "link";
  href: string;
  children: Array<RichTextText | RichTextLineBreak>;
};

export type RichTextInline = RichTextText | RichTextLineBreak | RichTextLink;

export type RichTextBlock =
  | { type: "paragraph"; children: RichTextInline[] }
  | { type: "heading"; level: 2 | 3; children: RichTextInline[] }
  | {
      type: "list";
      style: "bullet" | "number";
      items: Array<{ children: RichTextInline[] }>;
    };

export type RichTextDocument = {
  version: typeof RICH_TEXT_DOCUMENT_VERSION;
  blocks: RichTextBlock[];
};

type SanitizerBudget = {
  inlineNodes: number;
  textLength: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizedText(value: unknown, budget: SanitizerBudget) {
  if (typeof value !== "string" || budget.textLength >= MAX_TEXT_LENGTH) {
    return "";
  }
  const withoutControls = value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  const remaining = MAX_TEXT_LENGTH - budget.textLength;
  const text = withoutControls.slice(0, remaining);
  budget.textLength += text.length;
  return text;
}

export function safeRichTextHref(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_LINK_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }
  if (candidate.startsWith("#")) return candidate;
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

export function isExternalRichTextHref(href: string) {
  return href.startsWith("http://") || href.startsWith("https://");
}

function sanitizeInlineNodes(
  input: unknown,
  budget: SanitizerBudget,
  depth = 0,
): RichTextInline[] {
  if (!Array.isArray(input) || depth > 3) return [];
  const nodes: RichTextInline[] = [];

  for (const candidate of input) {
    if (budget.inlineNodes >= MAX_INLINE_NODES) break;
    if (!isRecord(candidate)) continue;

    if (candidate.type === "text") {
      const text = sanitizedText(candidate.text, budget);
      if (!text) continue;
      budget.inlineNodes += 1;
      nodes.push({
        type: "text",
        text,
        ...(candidate.bold === true ? { bold: true as const } : {}),
        ...(candidate.italic === true ? { italic: true as const } : {}),
      });
      continue;
    }

    if (candidate.type === "linebreak") {
      budget.inlineNodes += 1;
      nodes.push({ type: "linebreak" });
      continue;
    }

    if (candidate.type === "link") {
      const linkChildren = sanitizeInlineNodes(
        candidate.children,
        budget,
        depth + 1,
      )
        .flatMap((node) =>
          node.type === "link" ? node.children : [node],
        )
        .filter(
          (node): node is RichTextText | RichTextLineBreak =>
            node.type === "text" || node.type === "linebreak",
        );
      if (!linkChildren.length) continue;
      const href = safeRichTextHref(candidate.href);
      if (href) {
        budget.inlineNodes += 1;
        nodes.push({ type: "link", href, children: linkChildren });
      } else {
        nodes.push(...linkChildren);
      }
    }
  }

  return nodes;
}

function inlineNodesHaveText(nodes: readonly RichTextInline[]) {
  return nodes.some((node) =>
    node.type === "link"
      ? node.children.some(
          (child) => child.type === "text" && child.text.trim().length > 0,
        )
      : node.type === "text" && node.text.trim().length > 0,
  );
}

export function sanitizeRichTextDocument(input: unknown): RichTextDocument {
  const empty: RichTextDocument = {
    version: RICH_TEXT_DOCUMENT_VERSION,
    blocks: [],
  };
  if (
    !isRecord(input) ||
    input.version !== RICH_TEXT_DOCUMENT_VERSION ||
    !Array.isArray(input.blocks)
  ) {
    return empty;
  }

  const budget: SanitizerBudget = { inlineNodes: 0, textLength: 0 };
  const blocks: RichTextBlock[] = [];
  for (const candidate of input.blocks.slice(0, MAX_BLOCKS)) {
    if (!isRecord(candidate)) continue;

    if (candidate.type === "paragraph" || candidate.type === "heading") {
      const children = sanitizeInlineNodes(candidate.children, budget);
      if (!inlineNodesHaveText(children)) continue;
      if (candidate.type === "heading") {
        blocks.push({
          type: "heading",
          level: candidate.level === 3 ? 3 : 2,
          children,
        });
      } else {
        blocks.push({ type: "paragraph", children });
      }
      continue;
    }

    if (candidate.type === "list" && Array.isArray(candidate.items)) {
      const items = candidate.items
        .slice(0, MAX_LIST_ITEMS)
        .flatMap((item) => {
          if (!isRecord(item)) return [];
          const children = sanitizeInlineNodes(item.children, budget);
          return inlineNodesHaveText(children) ? [{ children }] : [];
        });
      if (items.length) {
        blocks.push({
          type: "list",
          style: candidate.style === "number" ? "number" : "bullet",
          items,
        });
      }
    }
  }

  return { version: RICH_TEXT_DOCUMENT_VERSION, blocks };
}

export function richTextDocumentHasContent(document: RichTextDocument) {
  return document.blocks.some((block) =>
    block.type === "list"
      ? block.items.some((item) => inlineNodesHaveText(item.children))
      : inlineNodesHaveText(block.children),
  );
}

export function parseRichTextDocumentJson(value: string) {
  if (!value || value.length > MAX_RICH_TEXT_JSON_LENGTH) return null;
  try {
    const document = sanitizeRichTextDocument(JSON.parse(value));
    return richTextDocumentHasContent(document) ? document : null;
  } catch {
    return null;
  }
}

export function createRichTextDocument(text: string): RichTextDocument {
  return sanitizeRichTextDocument({
    version: RICH_TEXT_DOCUMENT_VERSION,
    blocks: [
      {
        type: "paragraph",
        children: [{ type: "text", text }],
      },
    ],
  });
}
