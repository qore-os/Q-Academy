import assert from "node:assert/strict";
import test from "node:test";

import { submissionCreateSchema } from "../src/lib/api/schemas";
import { openApiDocument } from "../src/lib/api/openapi";
import {
  parseSubmissionRichTextDocumentJson,
  projectSubmissionRichTextPlainText,
  submissionRichTextDocumentSchema,
  SUBMISSION_TEXT_PROJECTION_VERSION,
} from "../src/lib/submission-rich-text";

const ids = {
  userId: "10000000-0000-4000-8000-000000000001",
  courseId: "10000000-0000-4000-8000-000000000002",
  lessonId: "10000000-0000-4000-8000-000000000003",
  blockId: "10000000-0000-4000-8000-000000000004",
};

const documentInput = {
  version: 1 as const,
  blocks: [
    {
      type: "paragraph" as const,
      children: [
        { type: "text" as const, text: " Alpha\r\n" },
        { type: "linebreak" as const },
        {
          type: "link" as const,
          href: "https://example.test/guide",
          children: [{ type: "text" as const, text: "Beta" }],
        },
      ],
    },
    {
      type: "heading" as const,
      level: 2 as const,
      children: [{ type: "text" as const, text: "Gamma" }],
    },
    {
      type: "list" as const,
      style: "number" as const,
      items: [
        { children: [{ type: "text" as const, text: "One" }] },
        {
          children: [
            {
              type: "link" as const,
              href: "javascript:alert(1)",
              children: [{ type: "text" as const, text: "Two" }],
            },
          ],
        },
      ],
    },
  ],
};

test("rich submission documents sanitize links and project deterministic UTF-16 text", () => {
  const document = submissionRichTextDocumentSchema.parse(documentInput);
  const secondListItem = document.blocks[2];
  assert.equal(secondListItem?.type, "list");
  if (secondListItem?.type !== "list") return;
  assert.deepEqual(secondListItem.items[1]?.children, [
    { type: "text", text: "Two" },
  ]);
  assert.equal(
    projectSubmissionRichTextPlainText(document),
    "Alpha\n\nBeta\n\nGamma\n\nOne\nTwo",
  );
  assert.equal(SUBMISSION_TEXT_PROJECTION_VERSION, 1);

  const emojiDocument = submissionRichTextDocumentSchema.parse({
    version: 1,
    blocks: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "A😀B" }],
      },
    ],
  });
  assert.equal(projectSubmissionRichTextPlainText(emojiDocument).length, 4);
});

test("rich submission validation rejects malformed or over-budget input without truncation", () => {
  for (const invalid of [
    { ...documentInput, unknown: true },
    {
      version: 1,
      blocks: [
        {
          type: "heading",
          level: 1,
          children: [{ type: "text", text: "Invalid heading" }],
        },
      ],
    },
    { version: 1, blocks: [] },
    {
      version: 1,
      blocks: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "x".repeat(50_001) }],
        },
      ],
    },
    {
      version: 1,
      blocks: [
        {
          type: "paragraph",
          children: Array.from({ length: 1_001 }, () => ({
            type: "text",
            text: "x",
          })),
        },
      ],
    },
  ]) {
    assert.equal(submissionRichTextDocumentSchema.safeParse(invalid).success, false);
  }

  const validJson = JSON.stringify(documentInput);
  assert.deepEqual(
    parseSubmissionRichTextDocumentJson(validJson),
    submissionRichTextDocumentSchema.parse(documentInput),
  );
  assert.equal(parseSubmissionRichTextDocumentJson("{"), null);
});

test("submission creation accepts legacy or rich text but rejects conflicting bodies", () => {
  const base = { ...ids, title: "Structured response", attachmentIds: [] };
  const rich = submissionCreateSchema.parse({ ...base, richText: documentInput });
  assert.equal(rich.content, undefined);
  assert.equal(
    projectSubmissionRichTextPlainText(rich.richText!),
    "Alpha\n\nBeta\n\nGamma\n\nOne\nTwo",
  );

  assert.equal(
    submissionCreateSchema.safeParse({
      ...base,
      content: "Legacy and rich text must not diverge.",
      richText: documentInput,
    }).success,
    false,
  );
  assert.equal(
    submissionCreateSchema.safeParse({
      ...base,
      content: "Legacy submission remains supported.",
    }).success,
    true,
  );
  assert.equal(
    submissionCreateSchema.safeParse({
      ...base,
      content: null,
      richText: null,
      attachmentIds: ["10000000-0000-4000-8000-000000000005"],
    }).success,
    true,
  );
});

test("OpenAPI publishes the structured document and immutable projection contract", () => {
  const createJson = JSON.stringify(
    openApiDocument.components.schemas.SubmissionCreate,
  );
  assert.match(createJson, /RichTextDocument/);
  assert.match(createJson, /"richText"/);

  const documentJson = JSON.stringify(
    openApiDocument.components.schemas.RichTextDocument,
  );
  assert.match(documentJson, /"additionalProperties":false/);
  assert.match(documentJson, /"paragraph"/);
  assert.match(documentJson, /"heading"/);
  assert.match(documentJson, /"list"/);

  const recordJson = JSON.stringify(
    openApiDocument.components.schemas.SubmissionRecord,
  );
  assert.match(recordJson, /contentFormat/);
  assert.match(recordJson, /contentProjectionVersion/);
  assert.match(recordJson, /UTF-16 code units/);
});
