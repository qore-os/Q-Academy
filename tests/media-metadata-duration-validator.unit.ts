import assert from "node:assert/strict";
import test from "node:test";

import { inspectAndScanMediaStream } from "../src/lib/media/scan-core";

async function* split(bytes: Uint8Array) {
  const sizes = [1, 2, 3, 5, 8, 13, 64, 257];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = sizes[index++ % sizes.length] ?? 1;
    yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
    offset += size;
  }
}

function mp3Fixture(frameCount = 100) {
  const frameLength = Math.floor((144 * 128_000) / 44_100);
  return Buffer.concat(
    Array.from({ length: frameCount }, () => {
      const frame = Buffer.alloc(frameLength);
      frame.set([0xff, 0xfb, 0x90, 0x00]);
      return frame;
    }),
  );
}

function oggChecksum(bytes: Buffer) {
  let checksum = 0;
  for (const byte of bytes) {
    checksum ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum =
        checksum & 0x80000000
          ? ((checksum << 1) ^ 0x04c11db7) >>> 0
          : (checksum << 1) >>> 0;
    }
  }
  return checksum >>> 0;
}

function oggPage(input: {
  headerType: number;
  granulePosition: bigint;
  serial: number;
  sequence: number;
  body: Buffer;
}) {
  assert.ok(input.body.length < 255);
  const page = Buffer.alloc(28 + input.body.length);
  page.write("OggS", 0, "ascii");
  page[4] = 0;
  page[5] = input.headerType;
  page.writeBigUInt64LE(input.granulePosition, 6);
  page.writeUInt32LE(input.serial, 14);
  page.writeUInt32LE(input.sequence, 18);
  page[26] = 1;
  page[27] = input.body.length;
  input.body.copy(page, 28);
  page.writeUInt32LE(oggChecksum(page), 22);
  return page;
}

function oggOpusFixture() {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "ascii");
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(312, 10);
  head.writeUInt32LE(48_000, 12);
  const tags = Buffer.concat([
    Buffer.from("OpusTags", "ascii"),
    Buffer.from([4, 0, 0, 0]),
    Buffer.from("test", "ascii"),
    Buffer.alloc(4),
  ]);
  return Buffer.concat([
    oggPage({ headerType: 2, granulePosition: BigInt(0), serial: 7, sequence: 0, body: head }),
    oggPage({ headerType: 0, granulePosition: BigInt(0), serial: 7, sequence: 1, body: tags }),
    oggPage({
      headerType: 4,
      granulePosition: BigInt(48_312),
      serial: 7,
      sequence: 2,
      body: Buffer.from([0xf8, 0xff, 0xfe]),
    }),
  ]);
}

function ebmlSize(size: number) {
  assert.ok(size >= 0 && size < 127);
  return Buffer.from([0x80 | size]);
}

function ebmlElement(id: readonly number[], body: Uint8Array) {
  return Buffer.concat([Buffer.from(id), ebmlSize(body.length), Buffer.from(body)]);
}

function webmFixture() {
  const headerBody = Buffer.concat([
    ebmlElement([0x42, 0x86], Buffer.from([1])),
    ebmlElement([0x42, 0xf7], Buffer.from([1])),
    ebmlElement([0x42, 0xf2], Buffer.from([4])),
    ebmlElement([0x42, 0xf3], Buffer.from([8])),
    ebmlElement([0x42, 0x82], Buffer.from("webm")),
    ebmlElement([0x42, 0x87], Buffer.from([2])),
    ebmlElement([0x42, 0x85], Buffer.from([2])),
  ]);
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(1_000);
  const info = ebmlElement(
    [0x15, 0x49, 0xa9, 0x66],
    Buffer.concat([
      ebmlElement([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])),
      ebmlElement([0x44, 0x89], duration),
    ]),
  );
  return Buffer.concat([
    ebmlElement([0x1a, 0x45, 0xdf, 0xa3], headerBody),
    ebmlElement([0x18, 0x53, 0x80, 0x67], info),
  ]);
}

for (const fixture of [
  { name: "MP3", mimeType: "audio/mpeg" as const, bytes: mp3Fixture(), expected: 2_612 },
  { name: "Ogg Opus", mimeType: "audio/ogg" as const, bytes: oggOpusFixture(), expected: 1_000 },
  { name: "WebM", mimeType: "video/webm" as const, bytes: webmFixture(), expected: 1_000 },
]) {
  test(`${fixture.name} metadata duration is parsed from a bounded split stream`, async () => {
    const result = await inspectAndScanMediaStream({
      body: split(fixture.bytes),
      expectedSizeBytes: fixture.bytes.length,
      mimeType: fixture.mimeType,
    });
    assert.ok(
      Math.abs(Number(result.durationMilliseconds) - fixture.expected) <= 30,
      `${result.durationMilliseconds} was not close to ${fixture.expected}`,
    );
  });
}

test("malformed metadata media fails closed instead of persisting an estimate", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.alloc(100),
  ]);
  await assert.rejects(
    inspectAndScanMediaStream({
      body: split(bytes),
      expectedSizeBytes: bytes.length,
      mimeType: "video/webm",
    }),
  );
});
