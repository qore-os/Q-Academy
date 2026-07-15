import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createFile } from "mp4box";

import { MediaContentInspectionError } from "../src/lib/media/content-inspection";
import {
  assertIsoBmffTrackComplexity,
  ISO_BMFF_COMPLEXITY_LIMITS,
  isoBmffDurationMilliseconds,
  IsoBmffPreflightGuard,
  type IsoBmffMimeType,
} from "../src/lib/media/iso-bmff-validator";
import { inspectAndScanMediaStream } from "../src/lib/media/scan-core";

function mediaFixture(mimeType: IsoBmffMimeType) {
  const file = createFile(true);
  const brands =
    mimeType === "video/quicktime"
      ? ["qt  "]
      : mimeType === "audio/mp4"
        ? ["M4A ", "isom", "mp42"]
        : ["isom", "iso2", "mp41"];
  file.init({ brands, duration: 1000, timescale: 1000 });

  const trackId =
    mimeType === "audio/mp4"
      ? file.addTrack({
          type: "mp4a",
          hdlr: "soun",
          channel_count: 2,
          samplesize: 16,
          samplerate: 48000,
          duration: 1000,
          media_duration: 1000,
          timescale: 1000,
        })
      : file.addTrack({
          type: "avc1",
          hdlr: "vide",
          width: 16,
          height: 16,
          duration: 1000,
          media_duration: 1000,
          timescale: 1000,
        });
  file.addSample(trackId, Uint8Array.from([0, 0, 0, 1, 9, 0x10]), {
    duration: 1000,
    dts: 0,
    cts: 0,
    is_sync: true,
  });
  return Buffer.from(new Uint8Array(file.getBuffer().buffer));
}

function box(type: string, payload: Uint8Array) {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "ascii");
  Buffer.from(payload).copy(output, 8);
  return output;
}

function ftyp(majorBrand = "isom") {
  const payload = Buffer.alloc(12);
  payload.write(majorBrand, 0, 4, "ascii");
  payload.writeUInt32BE(0, 4);
  payload.write("isom", 8, 4, "ascii");
  return box("ftyp", payload);
}

function countedFullBox(
  type: string,
  countOffsetAfterFullHeader: number,
  count = 0xffffffff,
  version = 0,
) {
  const payload = Buffer.alloc(4 + countOffsetAfterFullHeader + 4);
  payload[0] = version;
  payload.writeUInt32BE(count, 4 + countOffsetAfterFullHeader);
  return box(type, payload);
}

function maliciousSbgp(count = 8_000_000) {
  const payload = Buffer.alloc(12);
  payload.write("roll", 4, 4, "ascii");
  payload.writeUInt32BE(count, 8);
  return Buffer.concat([ftyp(), box("moov", box("sbgp", payload))]);
}

function maliciousNestedCountBox(type: "ssix" | "sbpm") {
  if (type === "ssix") {
    const payload = Buffer.alloc(12);
    payload.writeUInt32BE(1, 4);
    payload.writeUInt32BE(0xffffffff, 8);
    return box(type, payload);
  }

  const payload = Buffer.alloc(19);
  payload.writeUInt32BE(0xffffffff, 7);
  return box(type, payload);
}

function zeroLengthNaluArray(count: number) {
  const output = Buffer.alloc(3 + count * 2);
  output.writeUInt16BE(count, 1);
  return output;
}

function excessiveCodecConfiguration(
  type: "hvcC" | "lvcC" | "lhvC" | "vvcC",
) {
  const arrays = Buffer.concat([
    zeroLengthNaluArray(40_000),
    zeroLengthNaluArray(40_000),
  ]);
  if (type === "hvcC") {
    const header = Buffer.alloc(23);
    header[22] = 2;
    return box(type, Buffer.concat([header, arrays]));
  }
  if (type === "lvcC") {
    const header = Buffer.alloc(15);
    header[0] = 1;
    header[4] = 0x3f;
    header[13] = 0x1f;
    header[14] = 2;
    return box(type, Buffer.concat([header, arrays]));
  }
  if (type === "lhvC") {
    const header = Buffer.alloc(6);
    header[5] = 2;
    return box(type, Buffer.concat([header, arrays]));
  }
  const header = Buffer.alloc(6);
  header[5] = 2;
  return box(type, Buffer.concat([header, arrays]));
}

async function* splitBytes(bytes: Uint8Array, sizes: readonly number[]) {
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = sizes[index % sizes.length] ?? 1;
    yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
    offset += size;
    index += 1;
  }
}

async function inspectIso(
  bytes: Uint8Array,
  mimeType: IsoBmffMimeType,
  scanner?: Parameters<typeof inspectAndScanMediaStream>[0]["scanner"],
  sizes: readonly number[] = [1, 2, 3, 5, 8, 13, 257],
) {
  return inspectAndScanMediaStream({
    body: splitBytes(bytes, sizes),
    expectedSizeBytes: bytes.length,
    mimeType,
    scanner,
  });
}

async function rejectsAsContentMismatch(
  bytes: Uint8Array,
  mimeType: IsoBmffMimeType,
) {
  await assert.rejects(
    inspectIso(bytes, mimeType),
    (error: unknown) =>
      error instanceof MediaContentInspectionError &&
      error.code === "signature_mismatch",
  );
}

test("ISO-BMFF inspection accepts MP4 audio, MP4 video, and QuickTime", async () => {
  for (const mimeType of [
    "audio/mp4",
    "video/mp4",
    "video/quicktime",
  ] as const) {
    const bytes = mediaFixture(mimeType);
    const result = await inspectIso(bytes, mimeType);
    assert.equal(result.clean, true);
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.durationMilliseconds, 1_000);
  }
});

test("ISO-BMFF duration accepts only bounded unfragmented movie metadata", () => {
  assert.equal(
    isoBmffDurationMilliseconds({
      duration: 90_123,
      timescale: 1_000,
      isFragmented: false,
      fragment_duration: undefined,
    }),
    90_123,
  );
  assert.equal(
    isoBmffDurationMilliseconds({
      duration: 1,
      timescale: 2_000,
      isFragmented: false,
      fragment_duration: undefined,
    }),
    null,
  );
  assert.equal(
    isoBmffDurationMilliseconds({
      duration: 90_123,
      timescale: 1_000,
      isFragmented: true,
      fragment_duration: undefined,
    }),
    null,
  );
  assert.equal(
    isoBmffDurationMilliseconds({
      duration: 0,
      timescale: 1_000,
      isFragmented: true,
      fragment_duration: { num: 90_123, den: 1_000 },
    }),
    90_123,
  );
  assert.equal(
    isoBmffDurationMilliseconds({
      duration: Number.MAX_SAFE_INTEGER,
      timescale: 1,
      isFragmented: false,
      fragment_duration: undefined,
    }),
    null,
  );
});

test("ISO-BMFF inspection parses boxes split at every byte and scans once", async () => {
  const bytes = mediaFixture("video/mp4");
  const scanned: Buffer[] = [];
  const result = await inspectIso(
    bytes,
    "video/mp4",
    async (body, expectedSize) => {
      assert.equal(expectedSize, bytes.length);
      for await (const chunk of body) scanned.push(Buffer.from(chunk));
      return { clean: true, signature: null };
    },
    [1],
  );

  assert.equal(result.scanner, "clamav");
  assert.deepEqual(Buffer.concat(scanned), bytes);
});

test("ISO-BMFF inspection rejects wrong track types and incompatible brands", async () => {
  await rejectsAsContentMismatch(mediaFixture("audio/mp4"), "video/mp4");
  await rejectsAsContentMismatch(mediaFixture("video/quicktime"), "video/mp4");

  const imageBranded = Buffer.from(mediaFixture("video/mp4"));
  imageBranded.write("avif", 8, 4, "ascii");
  await rejectsAsContentMismatch(imageBranded, "video/mp4");
});

test("ISO-BMFF inspection rejects absent moov/mdat and malformed ftyp boxes", async () => {
  const withoutMoov = Buffer.concat([ftyp(), box("mdat", Buffer.from([1]))]);
  await rejectsAsContentMismatch(withoutMoov, "video/mp4");

  const withoutMdat = Buffer.from(mediaFixture("video/mp4"));
  const mdatOffset = withoutMdat.indexOf(Buffer.from("mdat", "ascii")) - 4;
  assert.ok(mdatOffset > 0);
  await rejectsAsContentMismatch(
    withoutMdat.subarray(0, mdatOffset),
    "video/mp4",
  );

  const malformedFtyp = Buffer.from(mediaFixture("video/mp4"));
  malformedFtyp.writeUInt32BE(12, 0);
  await rejectsAsContentMismatch(malformedFtyp, "video/mp4");
});

test("ISO-BMFF inspection rejects trailing bytes and empty media data", async () => {
  const trailing = Buffer.concat([
    mediaFixture("video/mp4"),
    Buffer.from([0xde, 0xad, 0xbe, 0xef]),
  ]);
  await rejectsAsContentMismatch(trailing, "video/mp4");

  const emptyMdat = Buffer.from(mediaFixture("video/mp4"));
  const mdatTypeOffset = emptyMdat.indexOf(Buffer.from("mdat", "ascii"));
  assert.ok(mdatTypeOffset > 4);
  const mdatStart = mdatTypeOffset - 4;
  emptyMdat.writeUInt32BE(8, mdatStart);
  await rejectsAsContentMismatch(
    emptyMdat.subarray(0, mdatStart + 8),
    "video/mp4",
  );
});

test("ISO-BMFF inspection stops parsing excessive top-level boxes", async () => {
  const freeBox = box("free", new Uint8Array());
  const bytes = Buffer.concat([
    ftyp(),
    ...Array.from(
      { length: ISO_BMFF_COMPLEXITY_LIMITS.topLevelBoxes + 1 },
      () => freeBox,
    ),
  ]);
  await rejectsAsContentMismatch(bytes, "video/mp4");
});

test("ISO-BMFF complexity rejects excessive tracks and sample tables", () => {
  assert.throws(
    () =>
      assertIsoBmffTrackComplexity(
        Array.from(
          { length: ISO_BMFF_COMPLEXITY_LIMITS.tracks + 1 },
          () => ({ nb_samples: 1 }),
        ),
      ),
    MediaContentInspectionError,
  );
  assert.throws(
    () =>
      assertIsoBmffTrackComplexity([
        { nb_samples: ISO_BMFF_COMPLEXITY_LIMITS.samplesPerTrack + 1 },
      ]),
    MediaContentInspectionError,
  );
  assert.throws(
    () =>
      assertIsoBmffTrackComplexity([
        { nb_samples: ISO_BMFF_COMPLEXITY_LIMITS.totalSamples / 2 + 1 },
        { nb_samples: ISO_BMFF_COMPLEXITY_LIMITS.totalSamples / 2 },
      ]),
    MediaContentInspectionError,
  );
});

test("ISO-BMFF preflight rejects malicious compact stsz counts before MP4Box", () => {
  const stszPayload = Buffer.alloc(12);
  stszPayload.writeUInt32BE(1, 4);
  stszPayload.writeUInt32BE(0xffffffff, 8);
  const bytes = Buffer.concat([ftyp(), box("moov", box("stsz", stszPayload))]);
  const guard = new IsoBmffPreflightGuard(bytes.length);
  const split = bytes.length - 2;

  assert.doesNotThrow(() => guard.observe(bytes.subarray(0, split)));
  assert.throws(
    () => guard.observe(bytes.subarray(split)),
    (error: unknown) =>
      error instanceof MediaContentInspectionError &&
      /entry-count limit/.test(error.message),
  );
});

test("ISO-BMFF preflight bounds chunk and sample-to-chunk table counts", () => {
  for (const tableType of ["stco", "co64", "stsc"] as const) {
    const tablePayload = Buffer.alloc(8);
    tablePayload.writeUInt32BE(0xffffffff, 4);
    const bytes = Buffer.concat([
      ftyp(),
      box("moov", box(tableType, tablePayload)),
    ]);
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.throws(
      () => guard.observe(bytes),
      (error: unknown) =>
        error instanceof MediaContentInspectionError &&
        /entry-count limit/.test(error.message),
    );
  }
});

test("ISO-BMFF structural preflight bounds all high-risk entry-count boxes", () => {
  const attacks = [
    maliciousSbgp(),
    Buffer.concat([ftyp(), box("moov", countedFullBox("sgpd", 4))]),
    Buffer.concat([ftyp(), box("moov", countedFullBox("subs", 0))]),
    Buffer.concat([ftyp(), box("moov", countedFullBox("saiz", 1))]),
    Buffer.concat([ftyp(), box("moov", countedFullBox("saio", 0))]),
    Buffer.concat([ftyp(), box("moov", countedFullBox("senc", 0))]),
    Buffer.concat([ftyp(), box("moov", countedFullBox("dref", 0))]),
    Buffer.concat([ftyp(), box("moov", countedFullBox("iinf", 0, 0xffffffff, 1))]),
    Buffer.concat([ftyp(), box("moov", maliciousNestedCountBox("ssix"))]),
    Buffer.concat([ftyp(), box("moov", maliciousNestedCountBox("sbpm"))]),
  ];

  for (const bytes of attacks) {
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.throws(
      () => guard.observe(bytes),
      (error: unknown) =>
        error instanceof MediaContentInspectionError &&
        /entry-count limit/.test(error.message),
    );
  }
});

test("ISO-BMFF structural preflight rejects unsafe declared metadata lengths", () => {
  const sgpd = Buffer.alloc(20);
  sgpd[0] = 1;
  sgpd.write("zzzz", 4, 4, "ascii");
  sgpd.writeUInt32BE(1, 12);
  sgpd.writeUInt32BE(0xffffffff, 16);

  const pssh = Buffer.alloc(24);
  pssh.writeUInt32BE(0xffffffff, 20);

  const keys = Buffer.alloc(12);
  keys.writeUInt32BE(1, 4);
  keys.writeUInt32BE(0xffffffff, 8);

  for (const metadata of [
    box("sgpd", sgpd),
    box("pssh", pssh),
    box("keys", keys),
  ]) {
    const bytes = Buffer.concat([ftyp(), box("moov", metadata)]);
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.throws(
      () => guard.observe(bytes),
      MediaContentInspectionError,
    );
  }
});

test("ISO-BMFF structural preflight bounds size-derived parser loops", () => {
  const attacks = [
    box(
      "sdtp",
      Buffer.alloc(4 + ISO_BMFF_COMPLEXITY_LIMITS.samplesPerTrack + 1),
    ),
    box(
      "pdin",
      Buffer.alloc(4 + (ISO_BMFF_COMPLEXITY_LIMITS.entriesPerBox + 1) * 8),
    ),
  ];

  for (const metadata of attacks) {
    const bytes = Buffer.concat([ftyp(), box("moov", metadata)]);
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.throws(
      () => guard.observe(bytes),
      (error: unknown) =>
        error instanceof MediaContentInspectionError &&
        /entry-count limit/.test(error.message),
    );
  }
});

test("ISO-BMFF structural preflight descends custom child containers", () => {
  const nestedCount = box("sbgp", maliciousSbgp().subarray(ftyp().length + 16));
  const stvi = Buffer.concat([Buffer.alloc(16), nestedCount]);
  const trep = Buffer.concat([Buffer.alloc(8), nestedCount]);

  for (const metadata of [box("stvi", stvi), box("trep", trep)]) {
    const bytes = Buffer.concat([ftyp(), box("moov", metadata)]);
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.throws(
      () => guard.observe(bytes),
      (error: unknown) =>
        error instanceof MediaContentInspectionError &&
        /entry-count limit/.test(error.message),
    );
  }
});

test("ISO-BMFF structural preflight bounds codec and FLAC parser loops", () => {
  const continuedFlacBlocks = Buffer.alloc(
    4 + (ISO_BMFF_COMPLEXITY_LIMITS.flacMetadataBlocks + 1) * 4,
  );
  for (
    let offset = 4;
    offset < continuedFlacBlocks.length;
    offset += 4
  ) {
    continuedFlacBlocks[offset] = 0x81;
  }
  const attacks = [
    ...(["hvcC", "lvcC", "lhvC", "vvcC"] as const).map(
      excessiveCodecConfiguration,
    ),
    box("dfLa", continuedFlacBlocks),
  ];

  for (const metadata of attacks) {
    const bytes = Buffer.concat([ftyp(), box("moov", metadata)]);
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.throws(() => guard.observe(bytes), MediaContentInspectionError);
  }
});

test("ISO-BMFF structural preflight accepts bounded custom configurations", () => {
  const hvc = Buffer.alloc(23);
  const lvc = Buffer.alloc(15);
  lvc[0] = 1;
  lvc[4] = 0x3f;
  lvc[13] = 0x1f;
  const lhv = Buffer.alloc(6);
  const vvc = Buffer.alloc(6);
  const flac = Buffer.alloc(42);
  const metadata = [
    box("hvcC", hvc),
    box("lvcC", lvc),
    box("lhvC", lhv),
    box("vvcC", vvc),
    box("dfLa", flac),
    box("stvi", Buffer.alloc(16)),
    box("trep", Buffer.alloc(8)),
  ];

  for (const entry of metadata) {
    const bytes = Buffer.concat([ftyp(), box("moov", entry)]);
    const guard = new IsoBmffPreflightGuard(bytes.length);
    assert.doesNotThrow(() => {
      guard.observe(bytes);
      guard.finalize();
    });
  }
});

test("ISO-BMFF sbgp OOM regression survives a 128 MiB child heap", () => {
  const bytes = maliciousSbgp();
  const validatorUrl = pathToFileURL(
    resolve("src/lib/media/iso-bmff-validator.ts"),
  ).href;
  const script = [
    `import { IsoBmffStreamValidator } from ${JSON.stringify(validatorUrl)};`,
    `const bytes = Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64");`,
    'const validator = new IsoBmffStreamValidator("video/mp4", bytes.length);',
    "validator.observe(bytes);",
    "try { await validator.finalize(); process.exitCode = 2; }",
    "catch (error) { if (error?.code !== 'signature_mismatch') throw error; }",
  ].join("\n");
  const child = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
    },
  );

  assert.equal(child.signal, null, child.stderr || child.stdout);
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("ISO-BMFF structural failures still consume the complete scanner stream", async () => {
  const bytes = Buffer.concat([ftyp(), box("mdat", Buffer.from([1]))]);
  const scanned: Buffer[] = [];

  await assert.rejects(
    inspectIso(bytes, "video/mp4", async (body) => {
      for await (const chunk of body) scanned.push(Buffer.from(chunk));
      return { clean: true, signature: null };
    }),
    MediaContentInspectionError,
  );
  assert.deepEqual(Buffer.concat(scanned), bytes);
});
