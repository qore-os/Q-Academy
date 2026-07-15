import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0042_submission_rich_text.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../src/db/schema.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/lib/submissions.ts", import.meta.url),
  "utf8",
);
const dsar = readFileSync(
  new URL("../scripts/export-user-data.ts", import.meta.url),
  "utf8",
);

test("0042 stores one immutable content representation and its frozen projection", () => {
  assert.match(migration, /ADD COLUMN "content_format"/);
  assert.match(migration, /ADD COLUMN "rich_text" jsonb/);
  assert.match(migration, /ADD COLUMN "content_projection_version"/);
  assert.match(migration, /submissions_content_document_shape_check/);
  assert.match(migration, /char_length\("submissions"\."content"\) <= 50000/);
  assert.match(migration, /char_length\("submissions"\."rich_text"::text\) <= 100000/);
  assert.match(migration, /submissions_prevent_content_update/);
  assert.match(migration, /ERRCODE = '55000'/);

  assert.match(schema, /contentFormat: varchar\("content_format"/);
  assert.match(schema, /richText: jsonb\("rich_text"\)/);
  assert.match(schema, /submissions_content_document_shape_check/);
});

test("submission writes derive content server-side and DSAR exports both representations", () => {
  assert.match(service, /submissionRichTextDocumentSchema\.safeParse/);
  assert.match(service, /projectSubmissionRichTextPlainText/);
  assert.match(service, /contentProjectionVersion: SUBMISSION_TEXT_PROJECTION_VERSION/);
  assert.match(dsar, /s\.content_format as "contentFormat"/);
  assert.match(dsar, /s\.rich_text as "richText"/);
  assert.match(dsar, /sanitizeRichTextDocument\(row\.richText\)/);
});
