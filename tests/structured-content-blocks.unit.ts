import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StructuredBlockContent } from "../src/components/content/interactive-block-content";
import { contentBlockCreateSchema } from "../src/lib/api/schemas";
import { openApiDocument } from "../src/lib/api/openapi";
import { contentBlockForSnapshot } from "../src/lib/course-snapshot-block";
import {
  defaultStructuredDocument,
  sanitizeAccordionDocument,
  sanitizeCodeDocument,
  sanitizeColumnsDocument,
  sanitizeDownloadDocument,
  sanitizeQuoteDocument,
  sanitizeTableDocument,
  sanitizeTabsDocument,
  structuredContentDocumentForBlock,
} from "../src/lib/content-blocks/layout-documents";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";
import { getStructuredContentCopy } from "../src/lib/i18n/structured-content";

test("structured block documents are bounded, unique, and safe", () => {
  assert.deepEqual(
    sanitizeQuoteDocument({ version: 1, quote: "  Lernen  ", attribution: "Ada", sourceUrl: "javascript:alert(1)" }),
    { version: 1, quote: "Lernen", attribution: "Ada" },
  );
  assert.equal(
    sanitizeDownloadDocument({ version: 1, mediaAssetId: "not-an-id", fileName: "a.pdf", label: "A", fileUrl: "https://attacker.invalid/a" }),
    null,
  );
  const accordion = sanitizeAccordionDocument({
    version: 1,
    items: [
      { id: "one", title: "Eins", body: "Inhalt", openByDefault: true },
      { id: "one", title: "Duplikat", body: "Entfernen" },
      { id: "empty", title: "", body: "Inhalt" },
    ],
  });
  assert.equal(accordion?.items.length, 1);
  assert.equal(sanitizeColumnsDocument({ version: 1, columns: [{ id: "one", body: "Nur eine" }] }), null);
  assert.equal(sanitizeTabsDocument({ version: 1, tabs: [], defaultTabId: "x" }), null);
  assert.equal(structuredContentDocumentForBlock("download", {}), null);
  assert.equal(
    sanitizeQuoteDocument({ version: 1, quote: "Zeile 1\nZeile 2" })?.quote,
    "Zeile 1\nZeile 2",
  );
  assert.deepEqual(
    sanitizeCodeDocument({
      version: 1,
      language: "unknown",
      code: "\n  const value = 1;\n    return value;\n",
      lineNumbers: true,
      wrap: false,
    }),
    {
      version: 1,
      language: "plaintext",
      code: "  const value = 1;\n    return value;",
      lineNumbers: true,
      wrap: false,
    },
  );
  assert.equal(
    sanitizeTableDocument({
      version: 1,
      headers: ["A", "B"],
      rows: [["only one cell"]],
    }),
    null,
  );
});

test("structured blocks render accessible content without interpreting markup", () => {
  const markup = renderToStaticMarkup(createElement(StructuredBlockContent, {
    type: "accordion",
    document: { version: 1, items: [{ id: "one", title: "Details", body: "<script>alert(1)</script>", openByDefault: false }] },
    locale: "de",
  }));
  assert.match(markup, /<details/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);

  const codeMarkup = renderToStaticMarkup(createElement(StructuredBlockContent, {
    type: "code",
    document: {
      version: 1,
      language: "html",
      code: "  <script>alert(1)</script>",
      lineNumbers: true,
      wrap: false,
    },
    locale: "en",
  }));
  assert.match(codeMarkup, /Copy code/);
  assert.match(codeMarkup, /  &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(codeMarkup, /<script>/);

  const tableMarkup = renderToStaticMarkup(createElement(StructuredBlockContent, {
    type: "table",
    document: {
      version: 1,
      caption: "Results",
      headers: ["Name", "Score"],
      rows: [["Ada", "100"]],
      striped: true,
    },
    locale: "en",
  }));
  assert.match(tableMarkup, /<caption[^>]*>Results<\/caption>/);
  assert.match(tableMarkup, /<th[^>]*scope="col"/);
  assert.match(tableMarkup, /<td[^>]*>/);
});

test("structured block chrome follows the active locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getStructuredContentCopy(locale);
    const emptyMarkup = renderToStaticMarkup(
      createElement(StructuredBlockContent, {
        type: "tabs",
        document: null,
        locale,
        showEmpty: true,
      }),
    );
    const tabsMarkup = renderToStaticMarkup(
      createElement(StructuredBlockContent, {
        type: "tabs",
        document: {
          version: 1,
          tabs: [{ id: "one", label: "One", body: "Body" }],
          defaultTabId: "one",
        },
        locale,
      }),
    );

    assert.match(emptyMarkup, new RegExp(copy.incomplete));
    assert.match(tabsMarkup, new RegExp(`aria-label="${copy.tabsLabel}"`));
  }
});

test("REST and OpenAPI expose all structured document contracts", () => {
  const valid = contentBlockCreateSchema.safeParse({
    type: "tabs",
    data: { tabs: { version: 1, tabs: [{ id: "a", label: "A", body: "Alpha" }], defaultTabId: "a" } },
  });
  assert.equal(valid.success, true);
  assert.equal(contentBlockCreateSchema.safeParse({
    type: "code",
    data: { code: { version: 1, language: "typescript", code: "const ok = true;", lineNumbers: true, wrap: false } },
  }).success, true);
  assert.equal(contentBlockCreateSchema.safeParse({
    type: "table",
    data: { table: { version: 1, headers: ["A"], rows: [["B"]], striped: true } },
  }).success, true);
  assert.equal(contentBlockCreateSchema.safeParse({ type: "quote", data: valid.success ? valid.data.data : {} }).success, false);
  const schema = openApiDocument.components.schemas.ContentBlockCreate as { properties?: { data?: { properties?: Record<string, unknown> } } };
  for (const name of ["callout", "quote", "divider", "accordion", "tabs", "columns", "download", "code", "table"]) {
    assert.ok(schema.properties?.data?.properties?.[name], `missing ${name}`);
  }
});

test("published snapshots retain structured block data", () => {
  const block = {
    id: "00000000-0000-4000-8000-000000000001",
    type: "tabs",
    data: { tabs: { version: 1, tabs: [{ id: "a", label: "A", body: "Alpha" }], defaultTabId: "a" } },
  };
  assert.equal(contentBlockForSnapshot(block as never, true), block);
});

test("new structured documents use the requested editor locale", () => {
  const headings = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const document = defaultStructuredDocument("columns", locale);
    assert.ok(document && "columns" in document);
    assert.equal(document.columns.length, 2);
    headings.add(document.columns[0].heading ?? "");
  }
  assert.equal(headings.size, SUPPORTED_LOCALES.length);

  const codeDefaults = new Set<string>();
  const tableDefaults = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const code = defaultStructuredDocument("code", locale);
    const table = defaultStructuredDocument("table", locale);
    assert.ok(code && "code" in code);
    assert.ok(table && "rows" in table);
    codeDefaults.add(code.code);
    tableDefaults.add(table.caption ?? "");
  }
  assert.equal(codeDefaults.size, SUPPORTED_LOCALES.length);
  assert.equal(tableDefaults.size, SUPPORTED_LOCALES.length);
});
