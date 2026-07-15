import { MediaContentInspectionError } from "@/lib/media/content-inspection";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";

const UINT32_MAX = 0xffff_ffff;
const DATABASE_INTEGER_MAX = 2_147_483_647;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

const PCM_FORMAT_TAG = 0x0001;
const IEEE_FLOAT_FORMAT_TAG = 0x0003;
const EXTENSIBLE_FORMAT_TAG = 0xfffe;
const DEFINED_SPEAKER_MASK = 0x0003_ffff;

const PCM_SUBTYPE_GUID = Uint8Array.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);
const IEEE_FLOAT_SUBTYPE_GUID = Uint8Array.from([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

export const WAV_COMPLEXITY_LIMITS = Object.freeze({
  chunks: 4_096,
  metadataPayloadBytes: 16 * 1024 * 1024,
  formatPayloadBytes: 256,
  channels: 32,
  sampleRate: 768_000,
});

export const WAV_MIME_TYPE = "audio/wav" as const satisfies AllowedMediaMimeType;

type WavEncoding = "pcm" | "ieee_float";

type WavFormat = Readonly<{
  encoding: WavEncoding;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  validBitsPerSample: number;
}>;

type ParserState =
  | "riff_header"
  | "chunk_header"
  | "chunk_payload"
  | "chunk_padding"
  | "done";

type CurrentChunk = {
  id: string;
  size: number;
  remaining: number;
  captured: Buffer | null;
  capturedBytes: number;
};

function invalidWav(message: string): never {
  throw new MediaContentInspectionError("signature_mismatch", message);
}

function fourCc(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function validFourCc(value: string) {
  return /^[\x20-\x7e]{4}$/.test(value);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function populationCount32(value: number) {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

function assertBaseFormatFields(
  channels: number,
  sampleRate: number,
  byteRate: number,
  blockAlign: number,
  bitsPerSample: number,
) {
  if (
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > WAV_COMPLEXITY_LIMITS.channels
  ) {
    invalidWav("The WAV channel count is unsupported.");
  }
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    sampleRate > WAV_COMPLEXITY_LIMITS.sampleRate
  ) {
    invalidWav("The WAV sample rate is unsupported.");
  }
  if (
    !Number.isInteger(bitsPerSample) ||
    bitsPerSample < 8 ||
    bitsPerSample > 64 ||
    bitsPerSample % 8 !== 0
  ) {
    invalidWav("The WAV sample container width is unsupported.");
  }

  const expectedBlockAlign = channels * (bitsPerSample / 8);
  const expectedByteRate = sampleRate * expectedBlockAlign;
  if (
    !Number.isSafeInteger(expectedBlockAlign) ||
    expectedBlockAlign < 1 ||
    expectedBlockAlign > 0xffff ||
    blockAlign !== expectedBlockAlign ||
    !Number.isSafeInteger(expectedByteRate) ||
    expectedByteRate < 1 ||
    expectedByteRate > UINT32_MAX ||
    byteRate !== expectedByteRate
  ) {
    invalidWav("The WAV byte rate or block alignment is inconsistent.");
  }
}

function parseWavFormat(bytes: Buffer): WavFormat {
  if (
    bytes.byteLength < 16 ||
    bytes.byteLength > WAV_COMPLEXITY_LIMITS.formatPayloadBytes
  ) {
    invalidWav("The WAV format chunk has an unsupported size.");
  }

  const formatTag = bytes.readUInt16LE(0);
  const channels = bytes.readUInt16LE(2);
  const sampleRate = bytes.readUInt32LE(4);
  const byteRate = bytes.readUInt32LE(8);
  const blockAlign = bytes.readUInt16LE(12);
  const bitsPerSample = bytes.readUInt16LE(14);

  let encoding: WavEncoding;
  let validBitsPerSample = bitsPerSample;

  if (formatTag === PCM_FORMAT_TAG || formatTag === IEEE_FLOAT_FORMAT_TAG) {
    if (
      (formatTag === PCM_FORMAT_TAG
        ? ![16, 18].includes(bytes.byteLength)
        : bytes.byteLength !== 18) ||
      (bytes.byteLength === 18 && bytes.readUInt16LE(16) !== 0) ||
      channels > 2
    ) {
      invalidWav("The WAV format extension is inconsistent with its format tag.");
    }
    encoding = formatTag === PCM_FORMAT_TAG ? "pcm" : "ieee_float";
  } else if (formatTag === EXTENSIBLE_FORMAT_TAG) {
    const extensionSize = bytes.byteLength >= 18 ? bytes.readUInt16LE(16) : 0;
    if (
      bytes.byteLength < 40 ||
      extensionSize < 22 ||
      extensionSize !== bytes.byteLength - 18
    ) {
      invalidWav("The extensible WAV format metadata is malformed.");
    }
    validBitsPerSample = bytes.readUInt16LE(18);
    const channelMask = bytes.readUInt32LE(20);
    const subtype = bytes.subarray(24, 40);
    if (equalBytes(subtype, PCM_SUBTYPE_GUID)) {
      encoding = "pcm";
    } else if (equalBytes(subtype, IEEE_FLOAT_SUBTYPE_GUID)) {
      encoding = "ieee_float";
    } else {
      invalidWav("The extensible WAV encoding is unsupported.");
    }
    if (
      validBitsPerSample < 1 ||
      validBitsPerSample > bitsPerSample ||
      (channelMask & ~DEFINED_SPEAKER_MASK) !== 0 ||
      (channelMask !== 0 && populationCount32(channelMask) !== channels)
    ) {
      invalidWav("The extensible WAV precision or channel mask is inconsistent.");
    }
  } else {
    invalidWav("The WAV encoding is unsupported.");
  }

  assertBaseFormatFields(
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
  );

  if (
    (encoding === "pcm" && ![8, 16, 24, 32].includes(bitsPerSample)) ||
    (encoding === "ieee_float" &&
      (![32, 64].includes(bitsPerSample) ||
        validBitsPerSample !== bitsPerSample))
  ) {
    invalidWav("The WAV precision is unsupported for its encoding.");
  }

  return {
    encoding,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    validBitsPerSample,
  };
}

export function wavDurationMilliseconds(
  dataSizeBytes: number,
  byteRate: number,
  blockAlign: number,
) {
  if (
    !Number.isSafeInteger(dataSizeBytes) ||
    dataSizeBytes <= 0 ||
    dataSizeBytes > UINT32_MAX ||
    !Number.isSafeInteger(byteRate) ||
    byteRate <= 0 ||
    byteRate > UINT32_MAX ||
    !Number.isSafeInteger(blockAlign) ||
    blockAlign <= 0 ||
    blockAlign > 0xffff ||
    byteRate % blockAlign !== 0 ||
    dataSizeBytes % blockAlign !== 0
  ) {
    return null;
  }

  const milliseconds =
    (BigInt(dataSizeBytes) * BigInt(1_000)) / BigInt(byteRate);
  if (
    milliseconds < BigInt(1) ||
    milliseconds > BigInt(DATABASE_INTEGER_MAX)
  ) {
    return null;
  }
  return Number(milliseconds);
}

export function isWavMimeType(
  mimeType: AllowedMediaMimeType,
): mimeType is typeof WAV_MIME_TYPE {
  return mimeType === WAV_MIME_TYPE;
}

export class WavStreamValidator {
  readonly #expectedSizeBytes: number;
  readonly #header = Buffer.alloc(RIFF_HEADER_BYTES);
  #headerBytes = 0;
  #state: ParserState = "riff_header";
  #currentChunk: CurrentChunk | null = null;
  #observedBytes = 0;
  #parsedBytes = 0;
  #chunkCount = 0;
  #metadataPayloadBytes = 0;
  #format: WavFormat | null = null;
  #factSampleFrames: number | null = null;
  #dataSizeBytes: number | null = null;
  #error: string | null = null;

  constructor(expectedSizeBytes: number) {
    this.#expectedSizeBytes = expectedSizeBytes;
    if (
      !Number.isSafeInteger(expectedSizeBytes) ||
      expectedSizeBytes < RIFF_HEADER_BYTES ||
      expectedSizeBytes > UINT32_MAX + 8
    ) {
      this.#error = "The WAV file has an unsupported size.";
    }
  }

  #fail(message: string) {
    this.#error ??= message;
  }

  #copyIntoHeader(source: Uint8Array, sourceOffset: number, targetBytes: number) {
    const copied = Math.min(
      targetBytes - this.#headerBytes,
      source.byteLength - sourceOffset,
    );
    this.#header.set(
      source.subarray(sourceOffset, sourceOffset + copied),
      this.#headerBytes,
    );
    this.#headerBytes += copied;
    this.#parsedBytes += copied;
    return copied;
  }

  #parseRiffHeader() {
    if (fourCc(this.#header, 0) !== "RIFF" || fourCc(this.#header, 8) !== "WAVE") {
      this.#fail("The uploaded WAV file has an invalid RIFF/WAVE header.");
      return;
    }
    const declaredSize = this.#header.readUInt32LE(4);
    if (declaredSize < 4 || declaredSize + 8 !== this.#expectedSizeBytes) {
      this.#fail("The WAV RIFF size does not match the stored object.");
      return;
    }
    this.#headerBytes = 0;
    this.#state = "chunk_header";
  }

  #parseChunkHeader() {
    const id = fourCc(this.#header, 0);
    const size = this.#header.readUInt32LE(4);
    this.#headerBytes = 0;

    if (!validFourCc(id)) {
      this.#fail("The WAV file contains an invalid chunk identifier.");
      return;
    }

    const paddedSize = size + (size & 1);
    const chunkEnd = this.#parsedBytes + paddedSize;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > this.#expectedSizeBytes) {
      this.#fail("A WAV chunk exceeds the RIFF boundary.");
      return;
    }

    this.#chunkCount += 1;
    if (this.#chunkCount > WAV_COMPLEXITY_LIMITS.chunks) {
      this.#fail("The WAV file exceeds the chunk-count limit.");
      return;
    }

    let captured: Buffer | null = null;
    if (id !== "fmt " && id !== "data") {
      this.#metadataPayloadBytes += size;
      if (
        !Number.isSafeInteger(this.#metadataPayloadBytes) ||
        this.#metadataPayloadBytes > WAV_COMPLEXITY_LIMITS.metadataPayloadBytes
      ) {
        this.#fail("The WAV file exceeds the metadata-size limit.");
        return;
      }
    }

    if (id === "fmt ") {
      if (this.#format || this.#currentChunk?.id === "fmt ") {
        this.#fail("The WAV file repeats its format chunk.");
        return;
      }
      if (
        size < 16 ||
        size > WAV_COMPLEXITY_LIMITS.formatPayloadBytes
      ) {
        this.#fail("The WAV format chunk has an unsupported size.");
        return;
      }
      captured = Buffer.alloc(size);
    } else if (id === "data") {
      if (!this.#format) {
        this.#fail("The WAV data chunk appears before its format chunk.");
        return;
      }
      if (this.#dataSizeBytes !== null) {
        this.#fail("The WAV file repeats its data chunk.");
        return;
      }
      if (size === 0) {
        this.#fail("The WAV data chunk is empty.");
        return;
      }
    } else if (id === "fact") {
      if (this.#factSampleFrames !== null) {
        this.#fail("The WAV file repeats its fact chunk.");
        return;
      }
      if (size !== 4) {
        this.#fail("The WAV fact chunk is malformed.");
        return;
      }
      captured = Buffer.alloc(size);
    }

    this.#currentChunk = {
      id,
      size,
      remaining: size,
      captured,
      capturedBytes: 0,
    };
    this.#state = "chunk_payload";
    if (size === 0) this.#finishChunkPayload();
  }

  #finishChunkPayload() {
    const chunk = this.#currentChunk;
    if (!chunk) {
      this.#fail("The WAV parser lost its chunk state.");
      return;
    }

    if (chunk.id === "fmt ") {
      try {
        this.#format = parseWavFormat(chunk.captured ?? Buffer.alloc(0));
      } catch (error) {
        this.#fail(
          error instanceof Error ? error.message : "The WAV format is malformed.",
        );
        return;
      }
    } else if (chunk.id === "data") {
      this.#dataSizeBytes = chunk.size;
    } else if (chunk.id === "fact") {
      this.#factSampleFrames = chunk.captured?.readUInt32LE(0) ?? null;
    }

    if (chunk.size & 1) {
      this.#state = "chunk_padding";
      return;
    }
    this.#finishChunk();
  }

  #finishChunk() {
    this.#currentChunk = null;
    if (this.#parsedBytes === this.#expectedSizeBytes) {
      this.#state = "done";
    } else if (this.#parsedBytes < this.#expectedSizeBytes) {
      this.#state = "chunk_header";
    } else {
      this.#fail("A WAV chunk exceeds the RIFF boundary.");
    }
  }

  observe(source: Uint8Array) {
    this.#observedBytes += source.byteLength;
    if (
      !Number.isSafeInteger(this.#observedBytes) ||
      this.#observedBytes > this.#expectedSizeBytes
    ) {
      this.#fail("The WAV file size changed during inspection.");
    }
    if (this.#error || source.byteLength === 0) return;

    let cursor = 0;
    while (cursor < source.byteLength && !this.#error) {
      if (this.#state === "riff_header") {
        cursor += this.#copyIntoHeader(source, cursor, RIFF_HEADER_BYTES);
        if (this.#headerBytes === RIFF_HEADER_BYTES) this.#parseRiffHeader();
        continue;
      }

      if (this.#state === "chunk_header") {
        const remainingFileBytes = this.#expectedSizeBytes - this.#parsedBytes;
        if (remainingFileBytes < CHUNK_HEADER_BYTES) {
          this.#fail("The WAV file has incomplete trailing chunk bytes.");
          continue;
        }
        cursor += this.#copyIntoHeader(source, cursor, CHUNK_HEADER_BYTES);
        if (this.#headerBytes === CHUNK_HEADER_BYTES) this.#parseChunkHeader();
        continue;
      }

      if (this.#state === "chunk_payload") {
        const current = this.#currentChunk;
        if (!current) {
          this.#fail("The WAV parser lost its chunk state.");
          continue;
        }
        const consumed = Math.min(
          current.remaining,
          source.byteLength - cursor,
        );
        if (current.captured) {
          current.captured.set(
            source.subarray(cursor, cursor + consumed),
            current.capturedBytes,
          );
          current.capturedBytes += consumed;
        }
        current.remaining -= consumed;
        cursor += consumed;
        this.#parsedBytes += consumed;
        if (current.remaining === 0) this.#finishChunkPayload();
        continue;
      }

      if (this.#state === "chunk_padding") {
        cursor += 1;
        this.#parsedBytes += 1;
        this.#finishChunk();
        continue;
      }

      this.#fail("The WAV file contains trailing bytes outside its chunks.");
    }
  }

  async finalize() {
    if (this.#observedBytes !== this.#expectedSizeBytes) {
      invalidWav("The WAV file size changed during inspection.");
    }
    if (this.#error) invalidWav(this.#error);
    if (
      this.#state !== "done" ||
      this.#parsedBytes !== this.#expectedSizeBytes ||
      this.#headerBytes !== 0 ||
      this.#currentChunk
    ) {
      invalidWav("The WAV RIFF structure is incomplete.");
    }
    if (!this.#format || this.#dataSizeBytes === null) {
      invalidWav("The WAV file has no unique format and data chunks.");
    }
    if (this.#dataSizeBytes % this.#format.blockAlign !== 0) {
      invalidWav("The WAV data size is not aligned to complete sample frames.");
    }

    const sampleFrames = this.#dataSizeBytes / this.#format.blockAlign;
    if (
      (this.#format.encoding === "ieee_float" &&
        this.#factSampleFrames === null) ||
      (this.#factSampleFrames !== null &&
        this.#factSampleFrames !== sampleFrames)
    ) {
      invalidWav("The WAV fact chunk is missing or inconsistent.");
    }

    const durationMilliseconds = wavDurationMilliseconds(
      this.#dataSizeBytes,
      this.#format.byteRate,
      this.#format.blockAlign,
    );
    if (durationMilliseconds === null) {
      invalidWav("The WAV duration is outside the supported millisecond range.");
    }

    return {
      durationMilliseconds,
    };
  }
}
