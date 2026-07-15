import { safeRichTextHref } from "@/lib/rich-text/document";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";

export const STRUCTURED_CONTENT_DOCUMENT_VERSION = 1 as const;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CalloutDocument = {
  version: 1;
  tone: "info" | "success" | "warning" | "danger";
  heading?: string;
  body: string;
};

export type QuoteDocument = {
  version: 1;
  quote: string;
  attribution?: string;
  sourceUrl?: string;
};

export type DividerDocument = {
  version: 1;
  style: "solid" | "dashed" | "dotted";
  spacing: "compact" | "normal" | "wide";
};

export type AccordionDocument = {
  version: 1;
  items: Array<{
    id: string;
    title: string;
    body: string;
    openByDefault: boolean;
  }>;
};

export type TabsDocument = {
  version: 1;
  tabs: Array<{ id: string; label: string; body: string }>;
  defaultTabId: string;
};

export type ColumnsDocument = {
  version: 1;
  layout: "equal" | "sidebar_left" | "sidebar_right";
  columns: Array<{ id: string; heading?: string; body: string }>;
};

export type DownloadDocument = {
  version: 1;
  mediaAssetId: string;
  fileName: string;
  label: string;
  description?: string;
};

export const CODE_BLOCK_LANGUAGES = [
  "plaintext",
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "python",
  "sql",
  "typescript",
] as const;

export type CodeBlockLanguage = (typeof CODE_BLOCK_LANGUAGES)[number];

export type CodeDocument = {
  version: 1;
  language: CodeBlockLanguage;
  code: string;
  lineNumbers: boolean;
  wrap: boolean;
};

export type TableDocument = {
  version: 1;
  caption?: string;
  headers: string[];
  rows: string[][];
  striped: boolean;
};

export type StructuredContentDocument =
  | CalloutDocument
  | QuoteDocument
  | DividerDocument
  | AccordionDocument
  | TabsDocument
  | ColumnsDocument
  | DownloadDocument
  | CodeDocument
  | TableDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .trim()
    .slice(0, maxLength);
}

function safeCodeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/^\n+|\n+$/g, "")
    .slice(0, maxLength);
  return /\S/.test(normalized) ? normalized : "";
}

function safeId(value: unknown, fallback: string) {
  const id = safeText(value, 80);
  return /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id) ? id : fallback;
}

function uniqueIds<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function sanitizeCalloutDocument(input: unknown): CalloutDocument | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const body = safeText(input.body, 12_000);
  if (!body) return null;
  const heading = safeText(input.heading, 220);
  return {
    version: 1,
    tone:
      input.tone === "success" || input.tone === "warning" || input.tone === "danger"
        ? input.tone
        : "info",
    ...(heading ? { heading } : {}),
    body,
  };
}

export function sanitizeQuoteDocument(input: unknown): QuoteDocument | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const quote = safeText(input.quote, 12_000);
  if (!quote) return null;
  const attribution = safeText(input.attribution, 500);
  const sourceUrl = safeRichTextHref(input.sourceUrl);
  return {
    version: 1,
    quote,
    ...(attribution ? { attribution } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function sanitizeDividerDocument(input: unknown): DividerDocument | null {
  if (!isRecord(input) || input.version !== 1) return null;
  return {
    version: 1,
    style: input.style === "dashed" || input.style === "dotted" ? input.style : "solid",
    spacing: input.spacing === "compact" || input.spacing === "wide" ? input.spacing : "normal",
  };
}

export function sanitizeAccordionDocument(input: unknown): AccordionDocument | null {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.items)) return null;
  const items = uniqueIds(
    input.items.slice(0, 20).flatMap((candidate, index) => {
      if (!isRecord(candidate)) return [];
      const title = safeText(candidate.title, 220);
      const body = safeText(candidate.body, 12_000);
      if (!title || !body) return [];
      return [{
        id: safeId(candidate.id, `item-${index + 1}`),
        title,
        body,
        openByDefault: candidate.openByDefault === true,
      }];
    }),
  );
  return items.length ? { version: 1, items } : null;
}

export function sanitizeTabsDocument(input: unknown): TabsDocument | null {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.tabs)) return null;
  const tabs = uniqueIds(
    input.tabs.slice(0, 12).flatMap((candidate, index) => {
      if (!isRecord(candidate)) return [];
      const label = safeText(candidate.label, 120);
      const body = safeText(candidate.body, 12_000);
      if (!label || !body) return [];
      return [{ id: safeId(candidate.id, `tab-${index + 1}`), label, body }];
    }),
  );
  if (!tabs.length) return null;
  const requestedDefault = safeText(input.defaultTabId, 80);
  return {
    version: 1,
    tabs,
    defaultTabId: tabs.some((tab) => tab.id === requestedDefault)
      ? requestedDefault
      : tabs[0].id,
  };
}

export function sanitizeColumnsDocument(input: unknown): ColumnsDocument | null {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.columns)) return null;
  const columns = uniqueIds(
    input.columns.slice(0, 3).flatMap((candidate, index) => {
      if (!isRecord(candidate)) return [];
      const heading = safeText(candidate.heading, 220);
      const body = safeText(candidate.body, 12_000);
      if (!body) return [];
      return [{
        id: safeId(candidate.id, `column-${index + 1}`),
        ...(heading ? { heading } : {}),
        body,
      }];
    }),
  );
  if (columns.length < 2) return null;
  return {
    version: 1,
    layout:
      input.layout === "sidebar_left" || input.layout === "sidebar_right"
        ? input.layout
        : "equal",
    columns,
  };
}

export function sanitizeDownloadDocument(input: unknown): DownloadDocument | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const mediaAssetId = safeText(input.mediaAssetId, 36);
  const fileName = safeText(input.fileName, 500);
  const label = safeText(input.label, 220);
  if (!UUID.test(mediaAssetId) || !fileName || !label) return null;
  const description = safeText(input.description, 2_000);
  return {
    version: 1,
    mediaAssetId,
    fileName,
    label,
    ...(description ? { description } : {}),
  };
}

export function sanitizeCodeDocument(input: unknown): CodeDocument | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const code = safeCodeText(input.code, 30_000);
  if (!code) return null;
  const language = CODE_BLOCK_LANGUAGES.includes(
    input.language as CodeBlockLanguage,
  )
    ? (input.language as CodeBlockLanguage)
    : "plaintext";
  return {
    version: 1,
    language,
    code,
    lineNumbers: input.lineNumbers === true,
    wrap: input.wrap === true,
  };
}

export function sanitizeTableDocument(input: unknown): TableDocument | null {
  if (
    !isRecord(input) ||
    input.version !== 1 ||
    !Array.isArray(input.headers) ||
    !Array.isArray(input.rows)
  ) {
    return null;
  }
  const headers = input.headers
    .slice(0, 12)
    .map((header) => safeText(header, 500));
  if (!headers.length || headers.some((header) => !header)) return null;

  let totalLength = headers.reduce((total, header) => total + header.length, 0);
  const rows: string[][] = [];
  for (const candidate of input.rows.slice(0, 100)) {
    if (!Array.isArray(candidate) || candidate.length !== headers.length) {
      return null;
    }
    const row = candidate.map((cell) => safeText(cell, 2_000));
    totalLength += row.reduce((total, cell) => total + cell.length, 0);
    if (totalLength > 60_000) return null;
    rows.push(row);
  }
  if (!rows.length) return null;
  const caption = safeText(input.caption, 500);
  return {
    version: 1,
    ...(caption ? { caption } : {}),
    headers,
    rows,
    striped: input.striped !== false,
  };
}

export function defaultStructuredDocument(
  type: string,
  locale: AppLocale = "de",
): StructuredContentDocument | null {
  const copy = getCourseParityCopy(locale).structured;
  if (type === "callout") return { version: 1, tone: "info", heading: copy.tones.info, body: copy.defaultBody };
  if (type === "quote") return { version: 1, quote: copy.quote };
  if (type === "divider") return { version: 1, style: "solid", spacing: "normal" };
  if (type === "accordion") return { version: 1, items: [{ id: "item-1", title: copy.newItemTitle(1), body: copy.defaultBody, openByDefault: false }] };
  if (type === "tabs") return { version: 1, tabs: [{ id: "tab-1", label: copy.newTabLabel(1), body: `${copy.defaultBody} 1` }, { id: "tab-2", label: copy.newTabLabel(2), body: `${copy.defaultBody} 2` }], defaultTabId: "tab-1" };
  if (type === "columns") return { version: 1, layout: "equal", columns: [{ id: "column-1", heading: copy.newColumnHeading(1), body: `${copy.defaultBody} 1` }, { id: "column-2", heading: copy.newColumnHeading(2), body: `${copy.defaultBody} 2` }] };
  if (type === "code") return { version: 1, language: "plaintext", code: copy.defaultCode, lineNumbers: true, wrap: false };
  if (type === "table") return { version: 1, caption: copy.defaultTableCaption, headers: [copy.newTableHeader(1), copy.newTableHeader(2)], rows: [[copy.defaultTableCell, copy.defaultTableCell]], striped: true };
  return null;
}

export function structuredContentDocumentForBlock(
  type: string,
  data: unknown,
): StructuredContentDocument | null {
  const record = isRecord(data) ? data : null;
  if (type === "callout") return sanitizeCalloutDocument(record?.callout);
  if (type === "quote") return sanitizeQuoteDocument(record?.quote);
  if (type === "divider") return sanitizeDividerDocument(record?.divider);
  if (type === "accordion") return sanitizeAccordionDocument(record?.accordion);
  if (type === "tabs") return sanitizeTabsDocument(record?.tabs);
  if (type === "columns") return sanitizeColumnsDocument(record?.columns);
  if (type === "download") return sanitizeDownloadDocument(record?.download);
  if (type === "code") return sanitizeCodeDocument(record?.code);
  if (type === "table") return sanitizeTableDocument(record?.table);
  return null;
}

export function isStructuredContentBlockType(type: string) {
  return ["callout", "quote", "divider", "accordion", "tabs", "columns", "download", "code", "table"].includes(type);
}
