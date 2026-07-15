import {
  isTranscriptSearchQueryExcluded,
  normalizeTranscriptSearchText,
} from "@/lib/transcript-search-settings-model";

export const VIDEO_TRANSCRIPT_DOCUMENT_VERSION = 1 as const;
export const MAX_TRANSCRIPT_SEGMENTS = 2_000;
export const MAX_TRANSCRIPT_DURATION_MS = 12 * 60 * 60 * 1_000;
export const MAX_TRANSCRIPT_TEXT_LENGTH = 300_000;

export type VideoTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type VideoTranscriptDocument = {
  version: typeof VIDEO_TRANSCRIPT_DOCUMENT_VERSION;
  language: string;
  segments: VideoTranscriptSegment[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const WEB_VTT_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  gt: ">",
  lrm: "\u200e",
  lt: "<",
  nbsp: "\u00a0",
  rlm: "\u200f",
};

function decodeWebVttEntity(entity: string) {
  const body = entity.slice(1, -1).toLowerCase();
  if (body in WEB_VTT_ENTITIES) return WEB_VTT_ENTITIES[body] ?? "";
  if (!body.startsWith("#")) return entity;
  const hexadecimal = body.startsWith("#x");
  const value = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0x10ffff ||
    (value >= 0xd800 && value <= 0xdfff)
  ) {
    return "";
  }
  return String.fromCodePoint(value);
}

function webVttCueTextToPlainText(value: string) {
  return value
    .replace(/<(?:\d{1,}:)?[0-5]\d:[0-5]\d[.,]\d{3}>/g, "")
    .replace(/<\/?(?:b|i|u|ruby|rt)>/gi, "")
    .replace(/<c(?:\.[a-z0-9_-]+)*>|<\/c>/gi, "")
    .replace(/<v(?:\s+[^<>\r\n]+)?>|<\/v>/gi, "")
    .replace(/<lang(?:\s+[a-z0-9-]+)?>|<\/lang>/gi, "")
    .replace(/<\/?[a-z][^<>\r\n]{0,128}>/gi, "")
    .replace(/&(?:amp|lt|gt|lrm|rlm|nbsp|#\d+|#x[\da-f]+);/gi, decodeWebVttEntity);
}

function safeCueText(value: unknown) {
  if (typeof value !== "string") return "";
  return webVttCueTextToPlainText(value)
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function safeLanguage(value: unknown) {
  if (typeof value !== "string") return "de";
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)
    ? normalized
    : "de";
}

export function sanitizeVideoTranscriptDocument(
  input: unknown,
): VideoTranscriptDocument | null {
  if (
    !isRecord(input) ||
    input.version !== VIDEO_TRANSCRIPT_DOCUMENT_VERSION ||
    !Array.isArray(input.segments)
  ) {
    return null;
  }

  let totalTextLength = 0;
  const segments: VideoTranscriptSegment[] = [];
  for (const candidate of input.segments.slice(0, MAX_TRANSCRIPT_SEGMENTS)) {
    if (!isRecord(candidate)) continue;
    const startMs = candidate.startMs;
    const endMs = candidate.endMs;
    const text = safeCueText(candidate.text);
    if (
      !Number.isInteger(startMs) ||
      !Number.isInteger(endMs) ||
      Number(startMs) < 0 ||
      Number(endMs) <= Number(startMs) ||
      Number(endMs) > MAX_TRANSCRIPT_DURATION_MS ||
      !text
    ) {
      continue;
    }
    totalTextLength += text.length;
    if (totalTextLength > MAX_TRANSCRIPT_TEXT_LENGTH) break;
    segments.push({ startMs: Number(startMs), endMs: Number(endMs), text });
  }

  segments.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.text.localeCompare(right.text, "de"),
  );
  const unique = segments.filter(
    (segment, index) =>
      index === 0 ||
      segment.startMs !== segments[index - 1]?.startMs ||
      segment.endMs !== segments[index - 1]?.endMs ||
      segment.text !== segments[index - 1]?.text,
  );
  if (!unique.length) return null;

  return {
    version: VIDEO_TRANSCRIPT_DOCUMENT_VERSION,
    language: safeLanguage(input.language),
    segments: unique,
  };
}

function parseTimestamp(value: string) {
  const match = value
    .trim()
    .match(/^(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  const result =
    ((hours * 60 * 60 + minutes * 60 + seconds) * 1_000) + milliseconds;
  return result <= MAX_TRANSCRIPT_DURATION_MS ? result : null;
}

export function parseWebVttTranscript(
  value: string,
  language = "de",
): VideoTranscriptDocument | null {
  if (!value.trim() || value.length > MAX_TRANSCRIPT_TEXT_LENGTH * 2) {
    return null;
  }
  const lines = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let index = lines[0]?.trim().startsWith("WEBVTT") ? 1 : 0;
  const segments: VideoTranscriptSegment[] = [];

  while (index < lines.length && segments.length < MAX_TRANSCRIPT_SEGMENTS) {
    while (index < lines.length && !lines[index]?.trim()) index += 1;
    if (index >= lines.length) break;

    if (lines[index]?.trim().startsWith("NOTE")) {
      while (index < lines.length && lines[index]?.trim()) index += 1;
      continue;
    }

    let timing = lines[index]?.trim() ?? "";
    if (!timing.includes("-->")) {
      index += 1;
      timing = lines[index]?.trim() ?? "";
    }
    const timingMatch = timing.match(
      /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/,
    );
    if (!timingMatch) {
      index += 1;
      continue;
    }
    const startMs = parseTimestamp(timingMatch[1] ?? "");
    const endMs = parseTimestamp(timingMatch[2] ?? "");
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]?.trim()) {
      textLines.push(lines[index] ?? "");
      index += 1;
    }
    const text = safeCueText(textLines.join(" "));
    if (
      startMs !== null &&
      endMs !== null &&
      endMs > startMs &&
      text
    ) {
      segments.push({ startMs, endMs, text });
    }
  }

  return sanitizeVideoTranscriptDocument({
    version: VIDEO_TRANSCRIPT_DOCUMENT_VERSION,
    language,
    segments,
  });
}

function vttTimestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

export function serializeWebVttTranscript(input: unknown) {
  const transcript = sanitizeVideoTranscriptDocument(input);
  if (!transcript) return "";
  return [
    "WEBVTT",
    "",
    ...transcript.segments.flatMap((segment, index) => [
      String(index + 1),
      `${vttTimestamp(segment.startMs)} --> ${vttTimestamp(segment.endMs)}`,
      segment.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;"),
      "",
    ]),
  ].join("\n");
}

export function searchVideoTranscript(
  input: unknown,
  query: string,
  excludedSearchTerms: readonly string[] = [],
) {
  const transcript = sanitizeVideoTranscriptDocument(input);
  const terms = normalizeTranscriptSearchText(query).split(/\s+/).filter(Boolean);
  if (
    !transcript ||
    !terms.length ||
    isTranscriptSearchQueryExcluded(query, excludedSearchTerms)
  ) {
    return [];
  }
  return transcript.segments.filter((segment) => {
    const comparable = normalizeTranscriptSearchText(segment.text);
    return terms.every((term) => comparable.includes(term));
  });
}

export function formatTranscriptTimestamp(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
