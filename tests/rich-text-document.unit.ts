import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RichTextContent } from "../src/components/content/rich-text-content";
import { contentBlockCreateSchema } from "../src/lib/api/schemas";
import {
  parseRichTextDocumentJson,
  safeRichTextHref,
  sanitizeRichTextDocument,
} from "../src/lib/rich-text/document";

const unsafeDocument = {
  version: 1,
  blocks: [
    {
      type: "heading",
      level: 2,
      children: [
        { type: "text", text: "Sicher <script>alert(1)</script>", bold: true },
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          type: "link",
          href: "javascript:alert(document.cookie)",
          children: [{ type: "text", text: "Unsicher", italic: true }],
        },
        { type: "text", text: " und " },
        {
          type: "link",
          href: "https://example.com/lernen?q=1",
          children: [{ type: "text", text: "Dokumentation" }],
        },
      ],
    },
    {
      type: "list",
      style: "number",
      items: [
        { children: [{ type: "text", text: "Erster Punkt" }] },
        { children: [{ type: "text", text: "Zweiter Punkt" }] },
      ],
    },
    {
      type: "html",
      children: [{ type: "text", text: "Wird verworfen" }],
    },
  ],
};

test("rich text sanitizing keeps supported structure and unwraps unsafe links", () => {
  const document = sanitizeRichTextDocument(unsafeDocument);

  assert.equal(document.blocks.length, 3);
  assert.deepEqual(document.blocks[1], {
    type: "paragraph",
    children: [
      { type: "text", text: "Unsicher", italic: true },
      { type: "text", text: " und " },
      {
        type: "link",
        href: "https://example.com/lernen?q=1",
        children: [{ type: "text", text: "Dokumentation" }],
      },
    ],
  });
  assert.equal(safeRichTextHref("javascript:alert(1)"), null);
  assert.equal(safeRichTextHref("//example.com/path"), null);
  assert.equal(safeRichTextHref("https://user:secret@example.com"), null);
  assert.equal(safeRichTextHref("/academy/courses"), "/academy/courses");
  assert.equal(safeRichTextHref("#lernziel"), "#lernziel");
});

test("rich text rendering escapes text and hardens external links", () => {
  const markup = renderToStaticMarkup(
    createElement(RichTextContent, { document: unsafeDocument }),
  );

  assert.match(markup, /<h2/);
  assert.match(markup, /<strong>/);
  assert.match(markup, /<em>Unsicher<\/em>/);
  assert.match(markup, /<ol/);
  assert.match(markup, /<li><span>Erster Punkt<\/span><\/li>/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /javascript:/i);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer nofollow"/);
  assert.match(markup, /referrerPolicy="no-referrer"/);
});

test("rich text parsing and API input fail closed on empty or malformed documents", () => {
  assert.equal(parseRichTextDocumentJson("not-json"), null);
  assert.equal(
    parseRichTextDocumentJson(JSON.stringify({ version: 1, blocks: [] })),
    null,
  );
  assert.equal(parseRichTextDocumentJson("x".repeat(100_001)), null);

  const parsed = contentBlockCreateSchema.safeParse({
    type: "rich_text",
    data: { richText: unsafeDocument },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.data.richText?.blocks.length, 3);
  }
  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "rich_text",
      data: { richText: { version: 1, blocks: [] } },
    }).success,
    false,
  );
});

test("rich text sanitizing bounds recursively nested untrusted links", () => {
  let child: unknown = { type: "text", text: "Tief" };
  for (let index = 0; index < 10_000; index += 1) {
    child = { type: "link", href: "https://example.com", children: [child] };
  }
  assert.doesNotThrow(() =>
    sanitizeRichTextDocument({
      version: 1,
      blocks: [{ type: "paragraph", children: [child] }],
    }),
  );
});
