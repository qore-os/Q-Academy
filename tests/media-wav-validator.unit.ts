import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { MediaContentInspectionError } from "../src/lib/media/content-inspection";
import { inspectAndScanMediaStream } from "../src/lib/media/scan-core";
import {
  WAV_COMPLEXITY_LIMITS,
  WavStreamValidator,
  wavDurationMilliseconds,
} from "../src/lib/media/wav-validator";

const PCM_SUBTYPE_GUID = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);
const IEEE_FLOAT_SUBTYPE_GUID = Buffer.from([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

type FormatOptions = Readonly<{
  formatTag?: number;
  channels?: number;
  sampleRate?: number;
  byteRate?: number;
  blockAlign?: number;
  bitsPerSample?: number;
  extensionSize?: number;
  validBitsPerSample?: number;
  channelMask?: number;
  subtype?: Buffer;
}>;

function formatChunk(options: FormatOptions = {}) {
  const formatTag = options.formatTag ?? 1;
  const channels = options.channels ?? 1;
  const sampleRate = options.sampleRate ?? 8_000;
  const bitsPerSample = options.bitsPerSample ?? 8;
  const blockAlign =
    options.blockAlign ?? channels * Math.ceil(bitsPerSample / 8);
  const byteRate = options.byteRate ?? sampleRate * blockAlign;
  const extensible = formatTag === 0xfffe;
  const hasExtension = extensible || options.extensionSize !== undefined;
  const bytes = Buffer.alloc(extensible ? 40 : hasExtension ? 18 : 16);
  bytes.writeUInt16LE(formatTag, 0);
  bytes.writeUInt16LE(channels, 2);
  bytes.writeUInt32LE(sampleRate, 4);
  bytes.writeUInt32LE(byteRate, 8);
  bytes.writeUInt16LE(blockAlign, 12);
  bytes.writeUInt16LE(bitsPerSample, 14);
  if (hasExtension) bytes.writeUInt16LE(options.extensionSize ?? 22, 16);
  if (extensible) {
    bytes.writeUInt16LE(options.validBitsPerSample ?? bitsPerSample, 18);
    bytes.writeUInt32LE(options.channelMask ?? 0, 20);
    (options.subtype ?? PCM_SUBTYPE_GUID).copy(bytes, 24);
  }
  return bytes;
}

function chunk(id: string, payload: Uint8Array, declaredSize = payload.byteLength) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, "ascii");
  header.writeUInt32LE(declaredSize, 4);
  return Buffer.concat([
    header,
    Buffer.from(payload),
    ...(declaredSize & 1 ? [Buffer.alloc(1)] : []),
  ]);
}

function factChunk(sampleFrames: number) {
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(sampleFrames);
  return chunk("fact", payload);
}

function riff(...chunks: readonly Uint8Array[]) {
  const body = Buffer.concat(chunks.map((value) => Buffer.from(value)));
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.byteLength + 4, 4);
  header.write("WAVE", 8, 4, "ascii");
  return Buffer.concat([header, body]);
}

function pcmFixture(
  data = Buffer.alloc(8_000, 0x80),
  format = formatChunk(),
) {
  return riff(chunk("fmt ", format), chunk("data", data));
}

async function* splitBytes(bytes: Uint8Array, sizes: readonly number[]) {
  let offset = 0;
  let index = 0;
  while (offset < bytes.byteLength) {
    const size = sizes[index % sizes.length] ?? 1;
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
    offset += size;
    index += 1;
  }
}

async function inspect(
  bytes: Uint8Array,
  sizes: readonly number[] = [1, 2, 3, 5, 8, 13, 257],
  scanner?: Parameters<typeof inspectAndScanMediaStream>[0]["scanner"],
) {
  return inspectAndScanMediaStream({
    body: splitBytes(bytes, sizes),
    expectedSizeBytes: bytes.byteLength,
    mimeType: "audio/wav",
    scanner,
  });
}

async function rejectsAsWav(
  bytes: Uint8Array,
  sizes: readonly number[] = [1, 2, 3, 5, 8, 13, 257],
) {
  await assert.rejects(
    inspect(bytes, sizes),
    (error: unknown) =>
      error instanceof MediaContentInspectionError &&
      error.code === "signature_mismatch",
  );
}

test("WAV inspection streams split PCM chunks and derives duration", async () => {
  const bytes = riff(
    chunk("fmt ", formatChunk()),
    chunk("JUNK", Buffer.from([1, 2, 3])),
    chunk("data", Buffer.alloc(8_000, 0x80)),
  );
  const scanned: Buffer[] = [];
  const result = await inspect(
    bytes,
    [1],
    async (body, expectedSizeBytes) => {
      assert.equal(expectedSizeBytes, bytes.byteLength);
      for await (const value of body) scanned.push(Buffer.from(value));
      return { clean: true, signature: null };
    },
  );

  assert.equal(result.scanner, "clamav");
  assert.equal(result.durationMilliseconds, 1_000);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(Buffer.concat(scanned), bytes);
});

test("WAV inspection accepts IEEE float and PCM/float extensible formats", async () => {
  const extendedPcm = Buffer.concat([
    formatChunk({
      formatTag: 0xfffe,
      channels: 4,
      sampleRate: 1_000,
      bitsPerSample: 16,
      channelMask: 0x33,
    }),
    Buffer.from([0]),
  ]);
  extendedPcm.writeUInt16LE(23, 16);
  const formats = [
    {
      format: formatChunk({
        formatTag: 3,
        sampleRate: 1_000,
        bitsPerSample: 32,
        extensionSize: 0,
      }),
      data: Buffer.alloc(4_000),
      factSampleFrames: 1_000,
    },
    {
      format: extendedPcm,
      data: Buffer.alloc(8_000),
    },
    {
      format: formatChunk({
        formatTag: 0xfffe,
        channels: 2,
        sampleRate: 1_000,
        bitsPerSample: 16,
        channelMask: 0x3,
      }),
      data: Buffer.alloc(4_000),
    },
    {
      format: formatChunk({
        formatTag: 0xfffe,
        sampleRate: 1_000,
        bitsPerSample: 32,
        subtype: IEEE_FLOAT_SUBTYPE_GUID,
      }),
      data: Buffer.alloc(4_000),
      factSampleFrames: 1_000,
    },
  ];

  for (const fixture of formats) {
    const result = await inspect(
      riff(
        chunk("fmt ", fixture.format),
        ...(fixture.factSampleFrames === undefined
          ? []
          : [factChunk(fixture.factSampleFrames)]),
        chunk("data", fixture.data),
      ),
    );
    assert.equal(result.durationMilliseconds, 1_000);
  }
});

test("WAV inspection rejects known durations outside its stored range", async () => {
  const oneMillisecond = await inspect(
    pcmFixture(Buffer.from([0x80]), formatChunk({ sampleRate: 1_000 })),
  );
  assert.equal(oneMillisecond.durationMilliseconds, 1);
  await rejectsAsWav(pcmFixture(Buffer.from([0x80])));
  await rejectsAsWav(
    pcmFixture(
      Buffer.alloc(2_147_484),
      formatChunk({ sampleRate: 1 }),
    ),
    [64 * 1024],
  );

  assert.equal(wavDurationMilliseconds(2_147_483, 1, 1), 2_147_483_000);
  assert.equal(wavDurationMilliseconds(2_147_484, 1, 1), null);
  assert.equal(wavDurationMilliseconds(3, 8_000, 2), null);
  assert.equal(wavDurationMilliseconds(4, 3, 2), null);
});

test("WAV inspection rejects malformed RIFF boundaries and trailing bytes", async () => {
  const valid = pcmFixture();
  const wrongRiff = Buffer.from(valid);
  wrongRiff.write("RIFX", 0, 4, "ascii");
  const wrongWave = Buffer.from(valid);
  wrongWave.write("AVI ", 8, 4, "ascii");
  const wrongSize = Buffer.from(valid);
  wrongSize.writeUInt32LE(wrongSize.readUInt32LE(4) - 1, 4);
  const unchangedRiffWithTrailing = Buffer.concat([valid, Buffer.from([1, 2, 3, 4])]);
  const adjustedRiffWithTrailing = Buffer.from(unchangedRiffWithTrailing);
  adjustedRiffWithTrailing.writeUInt32LE(adjustedRiffWithTrailing.length - 8, 4);

  const oversizedChunkHeader = Buffer.alloc(8);
  oversizedChunkHeader.write("JUNK", 0, 4, "ascii");
  oversizedChunkHeader.writeUInt32LE(0xffff_ffff, 4);

  const oddWithoutPadding = (() => {
    const oddHeader = Buffer.alloc(8);
    oddHeader.write("JUNK", 0, 4, "ascii");
    oddHeader.writeUInt32LE(3, 4);
    return riff(
      chunk("fmt ", formatChunk()),
      Buffer.concat([oddHeader, Buffer.from([1, 2, 3])]),
      chunk("data", Buffer.alloc(8_000)),
    );
  })();

  for (const bytes of [
    wrongRiff,
    wrongWave,
    wrongSize,
    unchangedRiffWithTrailing,
    adjustedRiffWithTrailing,
    riff(chunk("fmt ", formatChunk()), oversizedChunkHeader),
    oddWithoutPadding,
  ]) {
    await rejectsAsWav(bytes);
  }
});

test("WAV inspection rejects duplicate and out-of-order required chunks", async () => {
  const format = chunk("fmt ", formatChunk());
  const data = chunk("data", Buffer.alloc(8_000));
  for (const bytes of [
    riff(data, format),
    riff(format, format, data),
    riff(format, data, data),
    riff(format),
    riff(data),
  ]) {
    await rejectsAsWav(bytes);
  }
});

test("WAV inspection rejects inconsistent formats and sample frames", async () => {
  const invalidFormats = [
    formatChunk({ formatTag: 6 }),
    formatChunk({ channels: 0 }),
    formatChunk({ channels: 3 }),
    formatChunk({ sampleRate: 0 }),
    formatChunk({ byteRate: 7_999 }),
    formatChunk({ blockAlign: 2 }),
    formatChunk({ bitsPerSample: 40 }),
    formatChunk({ formatTag: 3, sampleRate: 1_000, bitsPerSample: 32 }),
    formatChunk({ formatTag: 3, bitsPerSample: 16 }),
    formatChunk({ formatTag: 1, extensionSize: 2 }),
    formatChunk({
      formatTag: 0xfffe,
      bitsPerSample: 16,
      extensionSize: 21,
    }),
    formatChunk({
      formatTag: 0xfffe,
      channels: 2,
      bitsPerSample: 16,
      channelMask: 1,
    }),
    formatChunk({
      formatTag: 0xfffe,
      bitsPerSample: 16,
      validBitsPerSample: 17,
    }),
    formatChunk({
      formatTag: 0xfffe,
      bitsPerSample: 16,
      channelMask: 0x4000_0000,
    }),
    formatChunk({
      formatTag: 0xfffe,
      bitsPerSample: 16,
      subtype: Buffer.alloc(16, 0xff),
    }),
  ];

  for (const format of invalidFormats) {
    await rejectsAsWav(
      riff(chunk("fmt ", format), chunk("data", Buffer.alloc(8_000))),
    );
  }

  await rejectsAsWav(
    riff(
      chunk(
        "fmt ",
        formatChunk({ channels: 2, bitsPerSample: 16, sampleRate: 8_000 }),
      ),
      chunk("data", Buffer.alloc(3)),
    ),
  );
});

test("WAV inspection requires one consistent fact chunk for IEEE float", async () => {
  const format = chunk(
    "fmt ",
    formatChunk({
      formatTag: 3,
      sampleRate: 1_000,
      bitsPerSample: 32,
      extensionSize: 0,
    }),
  );
  const data = chunk("data", Buffer.alloc(4_000));

  for (const bytes of [
    riff(format, data),
    riff(format, factChunk(999), data),
    riff(format, factChunk(1_000), factChunk(1_000), data),
    riff(format, chunk("fact", Buffer.alloc(8)), data),
  ]) {
    await rejectsAsWav(bytes);
  }

  const pcmWithFact = await inspect(
    riff(
      chunk("fmt ", formatChunk()),
      factChunk(8_000),
      chunk("data", Buffer.alloc(8_000)),
    ),
  );
  assert.equal(pcmWithFact.durationMilliseconds, 1_000);
});

test("WAV inspection enforces bounded chunk and metadata complexity", async () => {
  const emptyMetadata = chunk("JUNK", Buffer.alloc(0));
  const excessiveChunks = riff(
    chunk("fmt ", formatChunk()),
    ...Array.from({ length: WAV_COMPLEXITY_LIMITS.chunks }, () => emptyMetadata),
  );
  await rejectsAsWav(excessiveChunks);

  const excessiveMetadata = riff(
    chunk("fmt ", formatChunk()),
    chunk(
      "LIST",
      Buffer.alloc(WAV_COMPLEXITY_LIMITS.metadataPayloadBytes + 1),
    ),
  );
  await rejectsAsWav(excessiveMetadata, [64 * 1024]);
});

test("WAV structural failures still consume the complete scanner stream", async () => {
  const format = chunk("fmt ", formatChunk());
  const bytes = riff(format, format, chunk("data", Buffer.alloc(8_000)));
  const scanned: Buffer[] = [];

  await assert.rejects(
    inspect(bytes, [17, 31, 127], async (body) => {
      for await (const value of body) scanned.push(Buffer.from(value));
      return { clean: true, signature: null };
    }),
    MediaContentInspectionError,
  );
  assert.deepEqual(Buffer.concat(scanned), bytes);
});

test("WAV parser rejects unsafe declared sizes before allocating metadata", async () => {
  const expectedSize = WAV_COMPLEXITY_LIMITS.metadataPayloadBytes + 30;
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(expectedSize - 8, 4);
  header.write("WAVE", 8, 4, "ascii");
  header.write("LIST", 12, 4, "ascii");
  header.writeUInt32LE(WAV_COMPLEXITY_LIMITS.metadataPayloadBytes + 1, 16);
  const validator = new WavStreamValidator(expectedSize);
  validator.observe(header);
  const reusable = Buffer.alloc(64 * 1024);
  let observedBytes = header.byteLength;
  while (observedBytes < expectedSize) {
    const remaining = expectedSize - observedBytes;
    validator.observe(reusable.subarray(0, Math.min(reusable.length, remaining)));
    observedBytes += Math.min(reusable.length, remaining);
  }

  await assert.rejects(
    validator.finalize(),
    (error: unknown) =>
      error instanceof MediaContentInspectionError &&
      /metadata-size limit/.test(error.message),
  );
});
