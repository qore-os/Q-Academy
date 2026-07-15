import {
  parseWebVttTranscript,
  serializeWebVttTranscript,
  type VideoTranscriptDocument,
} from "@/lib/content-blocks/video-transcript";

export const MAX_WEB_VTT_FILE_BYTES = 600_000;

export type WebVttFileImportErrorCode =
  | "too_large"
  | "invalid_encoding"
  | "invalid_vtt";

export class WebVttFileImportError extends Error {
  constructor(readonly code: WebVttFileImportErrorCode) {
    super(code);
    this.name = "WebVttFileImportError";
  }
}

function inputBytes(input: ArrayBuffer | Uint8Array) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function importWebVttTranscriptFile(
  input: ArrayBuffer | Uint8Array,
  language: string,
): { document: VideoTranscriptDocument; webVtt: string } {
  const bytes = inputBytes(input);
  if (!bytes.byteLength || bytes.byteLength > MAX_WEB_VTT_FILE_BYTES) {
    throw new WebVttFileImportError(
      bytes.byteLength > MAX_WEB_VTT_FILE_BYTES ? "too_large" : "invalid_vtt",
    );
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new WebVttFileImportError("invalid_encoding");
  }

  const document = parseWebVttTranscript(source, language);
  if (!document) throw new WebVttFileImportError("invalid_vtt");
  return { document, webVtt: serializeWebVttTranscript(document) };
}

export function exportWebVttTranscript(input: unknown) {
  const webVtt = serializeWebVttTranscript(input);
  return webVtt ? `${webVtt.trimEnd()}\n` : null;
}

export function webVttExportFileName(language: string) {
  const safeLanguage = language
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 35);
  return `transcript-${safeLanguage || "de"}.vtt`;
}
