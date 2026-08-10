import { MAX_SCANNABLE_MEDIA_BYTES } from "@/lib/media/storage-configuration";

export const MEDIA_PURPOSES = [
  "course_content",
  "submission",
  "community",
  "avatar",
  "branding",
  "profile",
] as const;

export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export type MediaKind = "image" | "audio" | "video" | "document";

const MEBIBYTE = 1024 * 1024;

const MEDIA_MIME_DEFINITIONS = {
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/png": { kind: "image", extension: "png" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/avif": { kind: "image", extension: "avif" },
  "image/gif": { kind: "image", extension: "gif" },
  "image/vnd.microsoft.icon": { kind: "image", extension: "ico" },
  "audio/mpeg": { kind: "audio", extension: "mp3" },
  "audio/mp4": { kind: "audio", extension: "m4a" },
  "audio/wav": { kind: "audio", extension: "wav" },
  "audio/ogg": { kind: "audio", extension: "ogg" },
  "audio/webm": { kind: "audio", extension: "weba" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/quicktime": { kind: "video", extension: "mov" },
  "application/pdf": { kind: "document", extension: "pdf" },
  "text/plain": { kind: "document", extension: "txt" },
  "text/csv": { kind: "document", extension: "csv" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "document",
    extension: "docx",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "document",
    extension: "xlsx",
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    kind: "document",
    extension: "pptx",
  },
} as const satisfies Record<
  string,
  Readonly<{ kind: MediaKind; extension: string }>
>;

export type AllowedMediaMimeType = keyof typeof MEDIA_MIME_DEFINITIONS;

const COURSE_AND_SUBMISSION_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const satisfies readonly AllowedMediaMimeType[];

const AVATAR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const satisfies readonly AllowedMediaMimeType[];

const BRANDING_MIME_TYPES = [
  ...AVATAR_MIME_TYPES,
  "image/vnd.microsoft.icon",
] as const satisfies readonly AllowedMediaMimeType[];

export const MEDIA_MIME_TYPES_BY_PURPOSE: Readonly<
  Record<MediaPurpose, readonly AllowedMediaMimeType[]>
> = Object.freeze({
  course_content: Object.freeze([...COURSE_AND_SUBMISSION_MIME_TYPES]),
  submission: Object.freeze([...COURSE_AND_SUBMISSION_MIME_TYPES]),
  community: Object.freeze([...COURSE_AND_SUBMISSION_MIME_TYPES]),
  avatar: Object.freeze([...AVATAR_MIME_TYPES]),
  branding: Object.freeze([...BRANDING_MIME_TYPES]),
  profile: Object.freeze([...COURSE_AND_SUBMISSION_MIME_TYPES]),
});

export const MEDIA_SIZE_LIMITS_BY_PURPOSE: Readonly<
  Record<MediaPurpose, Readonly<Record<MediaKind, number>>>
> = Object.freeze({
  course_content: Object.freeze({
    image: 25 * MEBIBYTE,
    audio: 512 * MEBIBYTE,
    video: MAX_SCANNABLE_MEDIA_BYTES,
    document: 100 * MEBIBYTE,
  }),
  submission: Object.freeze({
    image: 25 * MEBIBYTE,
    audio: 256 * MEBIBYTE,
    video: MAX_SCANNABLE_MEDIA_BYTES,
    document: 100 * MEBIBYTE,
  }),
  community: Object.freeze({
    image: 25 * MEBIBYTE,
    audio: 128 * MEBIBYTE,
    video: MAX_SCANNABLE_MEDIA_BYTES,
    document: 50 * MEBIBYTE,
  }),
  avatar: Object.freeze({
    image: 8 * MEBIBYTE,
    audio: 0,
    video: 0,
    document: 0,
  }),
  branding: Object.freeze({
    image: 10 * MEBIBYTE,
    audio: 0,
    video: 0,
    document: 0,
  }),
  profile: Object.freeze({
    image: 25 * MEBIBYTE,
    audio: 256 * MEBIBYTE,
    video: MAX_SCANNABLE_MEDIA_BYTES,
    document: 100 * MEBIBYTE,
  }),
});

export type MediaPolicyErrorCode =
  | "invalid_purpose"
  | "invalid_mime_type"
  | "unsupported_mime_type"
  | "invalid_size"
  | "file_too_large";

export class MediaPolicyError extends Error {
  readonly code: MediaPolicyErrorCode;
  readonly details?: Readonly<{ maxBytes: number }>;

  constructor(
    code: MediaPolicyErrorCode,
    message: string,
    details?: Readonly<{ maxBytes: number }>,
  ) {
    super(message);
    this.name = "MediaPolicyError";
    this.code = code;
    this.details = details;
  }
}

export type MediaUploadPolicyInput = Readonly<{
  purpose: string;
  declaredMimeType: string;
  originalFileName: string;
  sizeBytes: number;
  globalMaxUploadBytes?: number;
}>;

export type MediaUploadPolicyDecision = Readonly<{
  purpose: MediaPurpose;
  mimeType: AllowedMediaMimeType;
  kind: MediaKind;
  extension: string;
  safeFileName: string;
  sizeBytes: number;
  maxBytes: number;
  contentInspectionRequired: true;
  malwareScanRequired: true;
}>;

const MIME_TOKEN = "[a-z0-9!#$&^_.+-]+";
const MIME_ESSENCE_PATTERN = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}$`, "i");
const MIME_PARAMETER_PATTERN = new RegExp(
  `^${MIME_TOKEN}=(?:${MIME_TOKEN}(?:,${MIME_TOKEN})*|"[a-z0-9!#$&^_.+, -]*")$`,
  "i",
);
const WINDOWS_RESERVED_BASE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_SAFE_FILE_NAME_LENGTH = 120;
const MAX_SAFE_FILE_BASE_LENGTH = 115;

export function isMediaPurpose(value: string): value is MediaPurpose {
  return MEDIA_PURPOSES.includes(value as MediaPurpose);
}

export function normalizeDeclaredMediaMimeType(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    /[^\x20-\x7e]/.test(trimmed)
  ) {
    throw new MediaPolicyError(
      "invalid_mime_type",
      "The declared MIME type is invalid.",
    );
  }

  const [rawEssence, ...parameters] = trimmed.split(";");
  const essence = rawEssence.trim().toLowerCase();
  if (
    !MIME_ESSENCE_PATTERN.test(essence) ||
    parameters.some(
      (parameter) => !MIME_PARAMETER_PATTERN.test(parameter.trim()),
    )
  ) {
    throw new MediaPolicyError(
      "invalid_mime_type",
      "The declared MIME type is invalid.",
    );
  }
  return essence;
}

function isKnownMimeType(value: string): value is AllowedMediaMimeType {
  return Object.prototype.hasOwnProperty.call(MEDIA_MIME_DEFINITIONS, value);
}

export function allowedMediaMimeTypes(
  purpose: MediaPurpose,
): readonly AllowedMediaMimeType[] {
  return MEDIA_MIME_TYPES_BY_PURPOSE[purpose];
}

export function isMediaMimeTypeAllowed(
  purpose: MediaPurpose,
  declaredMimeType: string,
) {
  try {
    const mimeType = normalizeDeclaredMediaMimeType(declaredMimeType);
    return (
      isKnownMimeType(mimeType) &&
      MEDIA_MIME_TYPES_BY_PURPOSE[purpose].includes(mimeType)
    );
  } catch {
    return false;
  }
}

function safeBaseName(value: string) {
  const leaf = value.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const lastDot = leaf.lastIndexOf(".");
  const withoutExtension = lastDot > 0 ? leaf.slice(0, lastDot) : leaf;
  let base = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();

  if (!base) base = "upload";
  if (WINDOWS_RESERVED_BASE_NAME.test(base)) base = `file-${base}`;
  return base;
}

export function createSafeMediaFileName(
  originalFileName: string,
  declaredMimeType: string,
) {
  const mimeType = normalizeDeclaredMediaMimeType(declaredMimeType);
  if (!isKnownMimeType(mimeType)) {
    throw new MediaPolicyError(
      "unsupported_mime_type",
      "The declared MIME type is not supported.",
    );
  }

  const extension = MEDIA_MIME_DEFINITIONS[mimeType].extension;
  const suffix = `.${extension}`;
  const maximumBaseLength = Math.min(
    MAX_SAFE_FILE_BASE_LENGTH,
    MAX_SAFE_FILE_NAME_LENGTH - suffix.length,
  );
  const base = safeBaseName(originalFileName)
    .slice(0, maximumBaseLength)
    .replace(/[-_]+$/g, "") || "upload";
  return `${base}${suffix}`;
}

export function validateMediaUploadPolicy(
  input: MediaUploadPolicyInput,
): MediaUploadPolicyDecision {
  if (!isMediaPurpose(input.purpose)) {
    throw new MediaPolicyError(
      "invalid_purpose",
      "The media purpose is not supported.",
    );
  }

  const mimeType = normalizeDeclaredMediaMimeType(input.declaredMimeType);
  if (
    !isKnownMimeType(mimeType) ||
    !MEDIA_MIME_TYPES_BY_PURPOSE[input.purpose].includes(mimeType)
  ) {
    throw new MediaPolicyError(
      "unsupported_mime_type",
      `The declared MIME type is not allowed for ${input.purpose}.`,
    );
  }

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new MediaPolicyError(
      "invalid_size",
      "The media size must be a positive whole number of bytes.",
    );
  }
  if (
    input.globalMaxUploadBytes !== undefined &&
    (!Number.isSafeInteger(input.globalMaxUploadBytes) ||
      input.globalMaxUploadBytes <= 0)
  ) {
    throw new MediaPolicyError(
      "invalid_size",
      "The global upload limit must be a positive whole number of bytes.",
    );
  }

  const definition = MEDIA_MIME_DEFINITIONS[mimeType];
  const purposeLimit =
    MEDIA_SIZE_LIMITS_BY_PURPOSE[input.purpose][definition.kind];
  const maxBytes = Math.min(
    purposeLimit,
    input.globalMaxUploadBytes ?? purposeLimit,
  );
  if (input.sizeBytes > maxBytes) {
    const formattedLimit =
      maxBytes >= 1024 * MEBIBYTE
        ? `${(maxBytes / (1024 * MEBIBYTE)).toFixed(2).replace(".", ",")} GiB`
        : `${Math.round(maxBytes / MEBIBYTE)} MiB`;
    throw new MediaPolicyError(
      "file_too_large",
      `Die Datei ueberschreitet das Upload-Limit von ${formattedLimit}.`,
      { maxBytes },
    );
  }

  return {
    purpose: input.purpose,
    mimeType,
    kind: definition.kind,
    extension: definition.extension,
    safeFileName: createSafeMediaFileName(input.originalFileName, mimeType),
    sizeBytes: input.sizeBytes,
    maxBytes,
    contentInspectionRequired: true,
    malwareScanRequired: true,
  };
}
