import "server-only";

import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { sanitizeAiReferenceText } from "@/lib/ai/grounding";
import { getStoredMediaObjectForScanning } from "@/lib/media/storage";
import {
  extractOoxmlKnowledgeText,
  isOoxmlMimeType,
  type OoxmlMimeType,
} from "@/lib/media/ooxml-validator";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 2_000_000;
const MAX_PDF_PAGES = 300;

export class AiDocumentKnowledgeSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiDocumentKnowledgeSourceError";
  }
}

function fail(message: string): never {
  throw new AiDocumentKnowledgeSourceError(message);
}

function decodeText(bytes: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("Die Dokumentquelle ist nicht gueltig UTF-8-kodiert.");
  }
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) fail("Die Dokumentquelle enthaelt keinen extrahierbaren Text.");
  if (normalized.length > MAX_TEXT_CHARACTERS) {
    fail("Der extrahierte Dokumenttext ueberschreitet das sichere Limit.");
  }
  return normalized;
}

async function extractPdfText(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > MAX_PDF_PAGES) {
      fail("Das PDF ueberschreitet das Seitenlimit fuer Wissensquellen.");
    }
    const pages: string[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      const pageText = content.items
        .flatMap((item) =>
          "str" in item && typeof item.str === "string" ? [item.str] : [],
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      characters += pageText.length + 1;
      if (characters > MAX_TEXT_CHARACTERS) {
        fail("Der extrahierte PDF-Text ueberschreitet das sichere Limit.");
      }
      if (pageText) pages.push(pageText);
      page.cleanup();
    }
    const text = pages.join("\n").trim();
    if (!text) fail("Das PDF enthaelt keinen extrahierbaren Text.");
    return text;
  } catch (error) {
    if (error instanceof AiDocumentKnowledgeSourceError) throw error;
    fail("Das PDF konnte nicht sicher als Wissensquelle gelesen werden.");
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractKnowledgeTextFromBytes(input: {
  mimeType: string;
  bytes: Buffer;
}) {
  if (!input.bytes.length || input.bytes.length > MAX_DOCUMENT_BYTES) {
    fail("Die Dokumentquelle ueberschreitet das sichere Dateilimit.");
  }
  if (input.mimeType === "text/plain" || input.mimeType === "text/csv") {
    return decodeText(input.bytes);
  }
  if (input.mimeType === "application/pdf") {
    return extractPdfText(input.bytes);
  }
  if (isOoxmlMimeType(input.mimeType as OoxmlMimeType)) {
    try {
      return await extractOoxmlKnowledgeText(
        input.mimeType as OoxmlMimeType,
        input.bytes,
      );
    } catch {
      fail("Das Office-Dokument konnte nicht sicher als Wissensquelle gelesen werden.");
    }
  }
  fail("Dieser Dokumenttyp kann nicht als KI-Wissensquelle extrahiert werden.");
}

export type DocumentKnowledgeSnapshot = Readonly<{
  mediaAssetId: string;
  title: string;
  content: string;
  contentDigest: string;
  extractedAt: Date;
}>;

export async function extractDocumentKnowledgeSnapshot(input: {
  organizationId: string;
  mediaAssetId: string;
}): Promise<DocumentKnowledgeSnapshot> {
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      organizationId: mediaAssets.organizationId,
      kind: mediaAssets.kind,
      status: mediaAssets.status,
      storageKey: mediaAssets.storageKey,
      originalFileName: mediaAssets.originalFileName,
      detectedMimeType: mediaAssets.detectedMimeType,
      actualSizeBytes: mediaAssets.actualSizeBytes,
      etag: mediaAssets.etag,
      storageVersionId: mediaAssets.storageVersionId,
      contentSha256: mediaAssets.contentSha256,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, input.mediaAssetId),
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.kind, "document"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .limit(1);
  if (
    !asset ||
    !asset.detectedMimeType ||
    !asset.contentSha256 ||
    !asset.actualSizeBytes ||
    asset.actualSizeBytes > MAX_DOCUMENT_BYTES
  ) {
    fail("Die Dokumentquelle ist nicht geprueft, zu gross oder nicht mehr verfuegbar.");
  }

  const stored = await getStoredMediaObjectForScanning(
    {
      organizationId: asset.organizationId,
      assetId: asset.id,
      key: asset.storageKey,
    },
    asset.etag,
    asset.storageVersionId,
  );
  if (stored.sizeBytes !== asset.actualSizeBytes) {
    fail("Die Dokumentquelle stimmt nicht mit dem geprueften Asset ueberein.");
  }
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let length = 0;
  for await (const sourceChunk of stored.body) {
    const chunk = Buffer.from(sourceChunk);
    length += chunk.length;
    if (length > MAX_DOCUMENT_BYTES || length > asset.actualSizeBytes) {
      fail("Die Dokumentquelle ueberschreitet das sichere Dateilimit.");
    }
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (length !== asset.actualSizeBytes || hash.digest("hex") !== asset.contentSha256) {
    fail("Die Dokumentquelle hat ihre Integritaetspruefung nicht bestanden.");
  }
  const content = await extractKnowledgeTextFromBytes({
    mimeType: asset.detectedMimeType,
    bytes: Buffer.concat(chunks, length),
  });
  const title = sanitizeAiReferenceText(asset.originalFileName, 220);
  if (!title) fail("Die Dokumentquelle hat keinen gueltigen Titel.");
  return {
    mediaAssetId: asset.id,
    title,
    content,
    contentDigest: asset.contentSha256,
    extractedAt: new Date(),
  };
}
