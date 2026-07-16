import { PassThrough } from "node:stream";

import { parseStream } from "music-metadata";

import { MediaContentInspectionError } from "@/lib/media/content-inspection";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";

const METADATA_MIME_TYPES = new Set<AllowedMediaMimeType>([
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "video/webm",
]);
const MAX_DURATION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const STREAM_HIGH_WATER_MARK_BYTES = 64 * 1_024;

export function isMetadataDurationMimeType(
  mimeType: AllowedMediaMimeType,
): boolean {
  return METADATA_MIME_TYPES.has(mimeType);
}

function invalidMedia(message: string) {
  return new MediaContentInspectionError("signature_mismatch", message);
}

export class MetadataDurationStreamValidator {
  private readonly stream = new PassThrough({
    highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
  });
  private readonly metadata: ReturnType<typeof parseStream>;
  private settled = false;
  private failure: unknown = null;

  constructor(
    private readonly mimeType: AllowedMediaMimeType,
    expectedSizeBytes: number,
  ) {
    if (!isMetadataDurationMimeType(mimeType)) {
      throw new TypeError(
        `Unsupported metadata duration MIME type: ${mimeType}`,
      );
    }
    if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0) {
      throw new TypeError(
        "Expected media size must be a positive safe integer.",
      );
    }

    this.metadata = parseStream(
      this.stream,
      { mimeType, size: expectedSizeBytes },
      { duration: true, skipCovers: true },
    );
    void this.metadata.then(
      () => {
        this.settled = true;
      },
      (error: unknown) => {
        this.failure = error;
        this.settled = true;
      },
    );
  }

  async observe(chunk: Uint8Array) {
    if (!chunk.byteLength || this.settled) return;
    const acceptsMore = this.stream.write(Buffer.from(chunk));
    if (acceptsMore) return;

    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          this.stream.off("drain", onDrain);
          this.stream.off("error", onError);
        };
        this.stream.once("drain", onDrain);
        this.stream.once("error", onError);
      }),
      this.metadata.then(
        () => undefined,
        () => undefined,
      ),
    ]);
  }

  async finalize() {
    if (!this.settled) this.stream.end();

    let result: Awaited<ReturnType<typeof parseStream>>;
    try {
      result = await this.metadata;
    } catch {
      if (this.mimeType === "audio/webm" || this.mimeType === "video/webm") {
        return { durationMilliseconds: null };
      }
      throw invalidMedia(
        "The uploaded media container could not be parsed safely.",
      );
    } finally {
      this.stream.destroy();
    }
    if (this.failure) {
      if (this.mimeType === "audio/webm" || this.mimeType === "video/webm") {
        return { durationMilliseconds: null };
      }
      throw invalidMedia("The uploaded media metadata is invalid.");
    }

    const durationSeconds = result.format.duration;
    const durationMilliseconds = Math.round(Number(durationSeconds) * 1_000);
    if (durationMilliseconds > MAX_DURATION_MILLISECONDS) {
      throw invalidMedia(
        "The uploaded audio or video exceeds the maximum duration.",
      );
    }
    if (!Number.isFinite(durationSeconds) || durationMilliseconds <= 0) {
      if (this.mimeType === "audio/webm" || this.mimeType === "video/webm") {
        return { durationMilliseconds: null };
      }
      throw invalidMedia(
        "The uploaded audio or video has no trustworthy bounded duration.",
      );
    }
    return { durationMilliseconds };
  }
}
