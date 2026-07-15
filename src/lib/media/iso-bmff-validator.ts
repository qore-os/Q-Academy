import {
  createFile,
  type ISOFile,
  Log,
  type Movie,
  type MP4BoxBuffer,
  type Track,
} from "mp4box";

import { MediaContentInspectionError } from "@/lib/media/content-inspection";
import {
  ISO_BMFF_COMPLEXITY_LIMITS,
  IsoBmffPreflightGuard,
} from "@/lib/media/iso-bmff-preflight";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";

export {
  ISO_BMFF_COMPLEXITY_LIMITS,
  IsoBmffPreflightGuard,
} from "@/lib/media/iso-bmff-preflight";

export const ISO_BMFF_MIME_TYPES = [
  "audio/mp4",
  "video/mp4",
  "video/quicktime",
] as const satisfies readonly AllowedMediaMimeType[];

export type IsoBmffMimeType = (typeof ISO_BMFF_MIME_TYPES)[number];

// Real media files normally contain a handful of top-level boxes and tracks.
// These limits still allow multi-hour 60-fps media while bounding MP4Box state.
const MP4_COMPATIBLE_BRAND = /^(?:isom|iso[2-9]|mp4[12]|avc1|M4[ABPV] |dash|cmf[acsv]|F4[APV] |MSNV|3g[p2][4-9])$/;
const IMAGE_ONLY_BRANDS = new Set([
  "avif",
  "avis",
  "heic",
  "heix",
  "mif1",
  "msf1",
]);

let activeParserErrorSink: ((message: string) => void) | null = null;

// Invalid containers are expected input. MP4Box otherwise writes some parser
// errors directly to stderr instead of routing them through ISOFile.onError.
Log.setLogLevel(Log.error);
Log.error = (module, message, file) => {
  const detail = message || `${module}_parser_error`;
  file?.onError?.(module, detail);
  activeParserErrorSink?.(detail);
};

function captureParserErrors<T>(
  sink: (message: string) => void,
  operation: () => T,
) {
  const previousSink = activeParserErrorSink;
  activeParserErrorSink = sink;
  try {
    return operation();
  } finally {
    activeParserErrorSink = previousSink;
  }
}

function invalidIsoBmff(message: string): never {
  throw new MediaContentInspectionError("signature_mismatch", message);
}

export function isIsoBmffMimeType(
  mimeType: AllowedMediaMimeType,
): mimeType is IsoBmffMimeType {
  return ISO_BMFF_MIME_TYPES.includes(mimeType as IsoBmffMimeType);
}

function assertBrands(file: ISOFile, mimeType: IsoBmffMimeType) {
  const ftyp = file.ftyp;
  if (!ftyp) invalidIsoBmff("The ISO media file has no file-type box.");
  const majorBrand = ftyp.major_brand;
  const brands = [majorBrand, ...ftyp.compatible_brands];
  if (
    brands.some(
      (brand) =>
        typeof brand !== "string" ||
        brand.length !== 4 ||
        !/^[\x20-\x7e]{4}$/.test(brand),
    )
  ) {
    invalidIsoBmff("The ISO media file has malformed compatibility brands.");
  }

  if (mimeType === "video/quicktime") {
    if (majorBrand !== "qt  " || !brands.includes("qt  ")) {
      invalidIsoBmff("The media file is not branded as QuickTime.");
    }
    return;
  }

  if (
    majorBrand === "qt  " ||
    IMAGE_ONLY_BRANDS.has(majorBrand) ||
    !brands.some((brand) => MP4_COMPATIBLE_BRAND.test(brand)) ||
    (mimeType === "audio/mp4" && majorBrand === "M4V ") ||
    (mimeType === "video/mp4" && majorBrand === "M4A ")
  ) {
    invalidIsoBmff("The media file brands do not match its declared MIME type.");
  }
}

function finitePositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isoBmffDurationMilliseconds(
  info: Pick<
    Movie,
    "duration" | "timescale" | "isFragmented" | "fragment_duration"
  >,
) {
  const duration = info.isFragmented
    ? info.fragment_duration?.num
    : info.duration;
  const timescale = info.isFragmented
    ? info.fragment_duration?.den
    : info.timescale;
  if (
    duration === undefined ||
    timescale === undefined ||
    !finitePositiveInteger(duration) ||
    !finitePositiveInteger(timescale)
  ) {
    return null;
  }

  const milliseconds =
    (BigInt(duration) * BigInt(1_000)) / BigInt(timescale);
  if (
    milliseconds < BigInt(1) ||
    milliseconds > BigInt(2_147_483_647)
  ) {
    return null;
  }
  return Number(milliseconds);
}

function assertTopLevelBoxes(file: ISOFile, expectedSizeBytes: number) {
  if (!file.boxes.length) {
    invalidIsoBmff("The ISO media file contains no boxes.");
  }
  if (file.boxes.length > ISO_BMFF_COMPLEXITY_LIMITS.topLevelBoxes) {
    invalidIsoBmff("The ISO media file exceeds the top-level box limit.");
  }

  let cursor = 0;
  for (const box of file.boxes) {
    if (
      !Number.isSafeInteger(box.start) ||
      box.start !== cursor ||
      !finitePositiveInteger(box.size) ||
      box.size < 8 ||
      box.start + box.size > expectedSizeBytes
    ) {
      invalidIsoBmff("The ISO media file has an invalid box layout.");
    }
    cursor = box.start + box.size;
  }
  if (cursor !== expectedSizeBytes) {
    invalidIsoBmff("The ISO media file has incomplete or trailing box data.");
  }

  const ftypCount = file.boxes.filter((box) => box.type === "ftyp").length;
  const moovCount = file.boxes.filter((box) => box.type === "moov").length;
  if (file.boxes[0]?.type !== "ftyp" || ftypCount !== 1 || moovCount !== 1) {
    invalidIsoBmff("The ISO media file has an invalid ftyp/moov structure.");
  }
}

type ByteRange = Readonly<{ start: number; end: number }>;

function mediaDataRanges(file: ISOFile, expectedSizeBytes: number) {
  const ranges: ByteRange[] = [];
  for (const mdat of file.mdats) {
    const start = mdat.start;
    const headerSize = mdat.hdr_size;
    if (
      !Number.isSafeInteger(start) ||
      !finitePositiveInteger(mdat.size) ||
      !finitePositiveInteger(headerSize ?? 0) ||
      mdat.size <= (headerSize ?? 0) ||
      (start ?? -1) + mdat.size > expectedSizeBytes
    ) {
      invalidIsoBmff("The ISO media file has an invalid media-data box.");
    }
    ranges.push({
      start: (start ?? 0) + (headerSize ?? 0),
      end: (start ?? 0) + mdat.size,
    });
  }
  if (!ranges.length) {
    invalidIsoBmff("The ISO media file has no media-data box.");
  }
  return ranges;
}

function sampleIsInsideMediaData(
  sample: Readonly<{ offset: number; size: number }>,
  ranges: readonly ByteRange[],
) {
  if (
    !Number.isSafeInteger(sample.offset) ||
    !finitePositiveInteger(sample.size) ||
    !Number.isSafeInteger(sample.offset + sample.size)
  ) {
    return false;
  }
  return ranges.some(
    ({ start, end }) => sample.offset >= start && sample.offset + sample.size <= end,
  );
}

function assertTrackSamples(
  file: ISOFile,
  info: Movie,
  ranges: readonly ByteRange[],
) {
  assertIsoBmffTrackComplexity(info.tracks);
  const trackIds = new Set<number>();
  for (const track of info.tracks) {
    if (
      !finitePositiveInteger(track.id) ||
      trackIds.has(track.id) ||
      !Number.isSafeInteger(track.nb_samples) ||
      track.nb_samples < 0
    ) {
      invalidIsoBmff("The ISO media file has invalid track metadata.");
    }
    trackIds.add(track.id);

    const samples = file.getTrackSamplesInfo(track.id);
    if (samples.length !== track.nb_samples) {
      invalidIsoBmff("The ISO media sample table is inconsistent.");
    }
    if (!samples.every((sample) => sampleIsInsideMediaData(sample, ranges))) {
      invalidIsoBmff("The ISO media samples are outside the media-data boxes.");
    }
  }
}

export function assertIsoBmffTrackComplexity(
  tracks: readonly Pick<Track, "nb_samples">[],
) {
  if (tracks.length > ISO_BMFF_COMPLEXITY_LIMITS.tracks) {
    invalidIsoBmff("The ISO media file exceeds the track-count limit.");
  }

  let totalSamples = 0;
  for (const track of tracks) {
    if (
      !Number.isSafeInteger(track.nb_samples) ||
      track.nb_samples < 0 ||
      track.nb_samples > ISO_BMFF_COMPLEXITY_LIMITS.samplesPerTrack
    ) {
      invalidIsoBmff("The ISO media file exceeds the per-track sample limit.");
    }
    totalSamples += track.nb_samples;
    if (
      !Number.isSafeInteger(totalSamples) ||
      totalSamples > ISO_BMFF_COMPLEXITY_LIMITS.totalSamples
    ) {
      invalidIsoBmff("The ISO media file exceeds the total sample limit.");
    }
  }
}

function hasUsableTrack(tracks: readonly Track[]) {
  return tracks.some(
    (track) =>
      finitePositiveInteger(track.nb_samples) &&
      finitePositiveInteger(track.size) &&
      finitePositiveInteger(track.samples_duration),
  );
}

export class IsoBmffStreamValidator {
  readonly #mimeType: IsoBmffMimeType;
  readonly #expectedSizeBytes: number;
  readonly #file = createFile(false);
  readonly #preflight: IsoBmffPreflightGuard;
  #offset = 0;
  #parserError: string | null = null;
  #complexityError: string | null = null;
  #ready = false;

  constructor(mimeType: IsoBmffMimeType, expectedSizeBytes: number) {
    this.#mimeType = mimeType;
    this.#expectedSizeBytes = expectedSizeBytes;
    this.#preflight = new IsoBmffPreflightGuard(expectedSizeBytes);
    this.#file.onReady = (info) => {
      this.#ready = true;
      try {
        assertIsoBmffTrackComplexity(info.tracks);
      } catch (error) {
        this.#complexityError =
          error instanceof Error ? error.message : "media_complexity_limit";
      }
    };
    this.#file.onError = (_module, message) => {
      this.#parserError ??= message || "parser_error";
    };
  }

  observe(chunk: Uint8Array) {
    this.#offset += chunk.byteLength;
    if (this.#parserError || this.#complexityError) return;

    try {
      const approvedChunks = this.#preflight.observe(chunk);
      for (const approved of approvedChunks) {
        for (
          let relativeOffset = 0;
          relativeOffset < approved.bytes.byteLength;
          relativeOffset += ISO_BMFF_COMPLEXITY_LIMITS.parserChunkBytes
        ) {
          const parserChunk = approved.bytes.subarray(
            relativeOffset,
            Math.min(
              approved.bytes.byteLength,
              relativeOffset + ISO_BMFF_COMPLEXITY_LIMITS.parserChunkBytes,
            ),
          );
          const buffer = Uint8Array.from(parserChunk).buffer as MP4BoxBuffer;
          buffer.fileStart = approved.fileStart + relativeOffset;
          captureParserErrors(
            (message) => {
              this.#parserError ??= message;
            },
            () => this.#file.appendBuffer(buffer),
          );
          if (
            this.#file.boxes.length >
            ISO_BMFF_COMPLEXITY_LIMITS.topLevelBoxes
          ) {
            this.#complexityError =
              "The ISO media file exceeds the top-level box limit.";
            break;
          }
          if (this.#parserError || this.#complexityError) break;
        }
        if (this.#parserError || this.#complexityError) break;
      }
    } catch (error) {
      this.#parserError =
        error instanceof Error && error.message ? error.message : "parser_error";
    }
  }

  async finalize() {
    if (this.#offset !== this.#expectedSizeBytes) {
      invalidIsoBmff("The ISO media file size changed during inspection.");
    }
    if (!this.#parserError && !this.#complexityError) {
      try {
        this.#preflight.finalize();
      } catch (error) {
        this.#complexityError =
          error instanceof Error ? error.message : "media_preflight_failed";
      }
    }
    if (!this.#parserError && !this.#complexityError) {
      try {
        captureParserErrors(
          (message) => {
            this.#parserError ??= message;
          },
          () => this.#file.flush(),
        );
        if (
          this.#file.boxes.length >
          ISO_BMFF_COMPLEXITY_LIMITS.topLevelBoxes
        ) {
          this.#complexityError =
            "The ISO media file exceeds the top-level box limit.";
        }
      } catch (error) {
        this.#parserError =
          error instanceof Error && error.message ? error.message : "parser_error";
      }
    }
    if (this.#complexityError) {
      invalidIsoBmff(this.#complexityError);
    }
    if (this.#parserError || !this.#ready || !this.#file.moov) {
      invalidIsoBmff("The uploaded ISO media file is malformed or has no moov box.");
    }

    let info: Movie;
    try {
      info = this.#file.getInfo();
    } catch {
      invalidIsoBmff("The uploaded ISO media metadata is malformed.");
    }
    if (!info.hasMoov) {
      invalidIsoBmff("The ISO media file has no moov box.");
    }
    assertIsoBmffTrackComplexity(info.tracks);

    assertTopLevelBoxes(this.#file, this.#expectedSizeBytes);
    assertBrands(this.#file, this.#mimeType);
    const ranges = mediaDataRanges(this.#file, this.#expectedSizeBytes);
    assertTrackSamples(this.#file, info, ranges);

    const matchingTracks =
      this.#mimeType === "audio/mp4" ? info.audioTracks : info.videoTracks;
    if (!hasUsableTrack(matchingTracks)) {
      invalidIsoBmff("The ISO media file has no usable matching media track.");
    }
    return {
      durationMilliseconds: isoBmffDurationMilliseconds(info),
    };
  }
}
