import assert from "node:assert/strict";
import test from "node:test";

import {
  AiDocumentKnowledgeSourceError,
  extractKnowledgeTextFromBytes,
} from "../src/lib/ai/document-knowledge-source.server";

test("AI document extraction accepts bounded UTF-8 text and CSV", async () => {
  assert.equal(
    await extractKnowledgeTextFromBytes({
      mimeType: "text/plain",
      bytes: Buffer.from("Leitlinie\r\n\r\nSicher anwenden.", "utf8"),
    }),
    "Leitlinie\n\nSicher anwenden.",
  );
  assert.equal(
    await extractKnowledgeTextFromBytes({
      mimeType: "text/csv",
      bytes: Buffer.from("Thema,Status\nDatenschutz,geprueft", "utf8"),
    }),
    "Thema,Status\nDatenschutz,geprueft",
  );
});

test("AI document extraction rejects malformed PDF and unsupported content", async () => {
  await assert.rejects(
    () =>
      extractKnowledgeTextFromBytes({
        mimeType: "application/pdf",
        bytes: Buffer.from("%PDF-invalid", "ascii"),
      }),
    AiDocumentKnowledgeSourceError,
  );
  await assert.rejects(
    () =>
      extractKnowledgeTextFromBytes({
        mimeType: "application/octet-stream",
        bytes: Buffer.from("not supported", "utf8"),
      }),
    AiDocumentKnowledgeSourceError,
  );
});
