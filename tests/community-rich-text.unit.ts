import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/lib/api/errors";
import {
  commentCreateSchema,
  commentUpdateSchema,
  postCreateSchema,
  postUpdateSchema,
} from "../src/lib/api/schemas";
import { openApiDocument } from "../src/lib/api/openapi";
import {
  communityContentAnalysisText,
  communityModerationAnalysisText,
  normalizeCommunityContent,
} from "../src/lib/community-rich-text";

const postBase = {
  spaceId: "10000000-0000-4000-8000-000000000001",
  authorId: "10000000-0000-4000-8000-000000000002",
};

const richDocument = {
  version: 1 as const,
  blocks: [
    {
      type: "paragraph" as const,
      children: [
        { type: "text" as const, text: "Sicher" },
        {
          type: "link" as const,
          href: "javascript:alert(1)",
          children: [{ type: "text" as const, text: " unsicher" }],
        },
        {
          type: "link" as const,
          href: "https://example.test/guide",
          children: [{ type: "text" as const, text: " Anleitung" }],
        },
      ],
    },
  ],
};

test("community API bodies require exactly one plain or rich representation", () => {
  assert.equal(postCreateSchema.safeParse({ ...postBase }).success, false);
  assert.equal(
    postCreateSchema.safeParse({
      ...postBase,
      content: "Plain community body",
      richText: richDocument,
    }).success,
    false,
  );
  assert.equal(
    postCreateSchema.safeParse({ ...postBase, richText: richDocument }).success,
    true,
  );
  assert.equal(
    postUpdateSchema.safeParse({
      expectedContentVersion: 1,
      title: "Title only update",
    }).success,
    true,
  );
  assert.equal(
    postUpdateSchema.safeParse({
      expectedContentVersion: 1,
      content: "Plain update",
      richText: richDocument,
    }).success,
    false,
  );
  assert.equal(
    commentCreateSchema.safeParse({
      authorId: postBase.authorId,
      richText: richDocument,
    }).success,
    true,
  );
  assert.equal(
    commentUpdateSchema.safeParse({ expectedContentVersion: 1 }).success,
    false,
  );
});

test("community rich text is strict, sanitized and projected deterministically", () => {
  const normalized = normalizeCommunityContent(
    { richText: richDocument },
    "post",
  );
  assert.equal(normalized.contentFormat, "rich_text");
  assert.equal(normalized.contentProjectionVersion, 1);
  assert.equal(normalized.content, "Sicher unsicher Anleitung");
  assert.deepEqual(normalized.analysisLinks, ["https://example.test/guide"]);
  assert.doesNotMatch(JSON.stringify(normalized.richText), /javascript:/i);

  assert.throws(
    () =>
      normalizeCommunityContent(
        { richText: { ...richDocument, extra: true } },
        "post",
      ),
    (error) =>
      error instanceof ApiError &&
      error.status === 422 &&
      error.code === "validation_error",
  );
  assert.equal(
    normalizeCommunityContent({ content: "  Legacy text  " }, "post").content,
    "Legacy text",
  );
});

test("moderation analysis rejects oversized link and UTF-8 material as 422", () => {
  const longLinksDocument = {
    version: 1 as const,
    blocks: Array.from({ length: 30 }, (_, index) => ({
      type: "paragraph" as const,
      children: [
        {
          type: "link" as const,
          href: `https://example.test/${index}/${"a".repeat(1_850)}`,
          children: [{ type: "text" as const, text: `L${index}` }],
        },
      ],
    })),
  };
  const normalized = normalizeCommunityContent(
    { richText: longLinksDocument },
    "post",
  );
  assert.throws(
    () =>
      communityModerationAnalysisText([
        "Titel",
        communityContentAnalysisText(normalized),
      ]),
    (error) =>
      error instanceof ApiError &&
      error.status === 422 &&
      error.code === "validation_error",
  );
  assert.throws(
    () => communityModerationAnalysisText(["ä".repeat(26_000)]),
    (error) => error instanceof ApiError && error.status === 422,
  );
});

test("OpenAPI publishes rich community bodies and immutable feed projections", () => {
  for (const schemaName of [
    "PostCreate",
    "PostUpdate",
    "CommentCreate",
    "CommentUpdate",
  ]) {
    assert.match(
      JSON.stringify(openApiDocument.components.schemas[schemaName]),
      /RichTextDocument/,
    );
  }
  for (const schemaName of ["CommunityFeedPost", "CommunityFeedComment"]) {
    const schema = JSON.stringify(
      openApiDocument.components.schemas[schemaName],
    );
    assert.match(schema, /contentFormat/);
    assert.match(schema, /richText/);
    assert.match(schema, /contentProjectionVersion/);
  }
});
