import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";

export class MediaContentInspectionError extends Error {
  readonly code: "empty_content" | "signature_mismatch";

  constructor(code: MediaContentInspectionError["code"], message: string) {
    super(message);
    this.name = "MediaContentInspectionError";
    this.code = code;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function isoBaseMedia(bytes: Uint8Array) {
  return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
}

function safeText(bytes: Uint8Array) {
  return !bytes.some(
    (byte) =>
      byte === 0 ||
      byte === 0x7f ||
      (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d),
  );
}

export function assertMediaContentSignature(
  mimeType: AllowedMediaMimeType,
  header: Uint8Array,
) {
  if (!header.length) {
    throw new MediaContentInspectionError(
      "empty_content",
      "The uploaded media file is empty.",
    );
  }

  const valid = (() => {
    switch (mimeType) {
      case "image/jpeg":
        return startsWith(header, [0xff, 0xd8, 0xff]);
      case "image/png":
        return startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case "image/webp":
        return ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WEBP";
      case "image/avif":
        return isoBaseMedia(header) && ["avif", "avis"].includes(ascii(header, 8, 4));
      case "image/gif":
        return ["GIF87a", "GIF89a"].includes(ascii(header, 0, 6));
      case "image/vnd.microsoft.icon":
        return startsWith(header, [0x00, 0x00, 0x01, 0x00]);
      case "audio/mpeg":
        return (
          ascii(header, 0, 3) === "ID3" ||
          (header[0] === 0xff && (header[1] ?? 0) >= 0xe0)
        );
      case "audio/mp4":
      case "video/mp4":
        return isoBaseMedia(header);
      case "audio/wav":
        return ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WAVE";
      case "audio/ogg":
        return ascii(header, 0, 4) === "OggS";
      case "audio/webm":
      case "video/webm":
        return startsWith(header, [0x1a, 0x45, 0xdf, 0xa3]);
      case "video/quicktime":
        return isoBaseMedia(header) && ascii(header, 8, 4) === "qt  ";
      case "application/pdf":
        return ascii(header, 0, 5) === "%PDF-";
      case "text/plain":
      case "text/csv":
        return safeText(header);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return startsWith(header, [0x50, 0x4b, 0x03, 0x04]);
    }
  })();

  if (!valid) {
    throw new MediaContentInspectionError(
      "signature_mismatch",
      "The uploaded media content does not match its declared MIME type.",
    );
  }
}
