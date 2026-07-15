import { MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES } from "@/lib/privacy/export-limits";

const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;
const MAX_ENTRY_COUNT = 10_000;
const MAX_ZIP_BYTES = MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES;

export type StoredZipEntry = Readonly<{
  path: string;
  bytes: Uint8Array;
  modifiedAt?: Date;
}>;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function assertEntryPath(value: string) {
  if (
    !value ||
    value.length > 240 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("The ZIP entry path is invalid.");
  }
}

function dosTimestamp(value: Date) {
  const date = Number.isNaN(value.getTime()) ? new Date(0) : value;
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const time =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    Math.floor(date.getUTCSeconds() / 2);
  const day =
    ((year - 1980) << 9) |
    ((date.getUTCMonth() + 1) << 5) |
    date.getUTCDate();
  return { time, date: day };
}

export function createStoredZip(entries: readonly StoredZipEntry[]) {
  if (!entries.length || entries.length > MAX_ENTRY_COUNT) {
    throw new TypeError("The ZIP entry count is invalid.");
  }

  const seen = new Set<string>();
  const prepared: Array<{
    entry: StoredZipEntry;
    name: Buffer;
    sizeBytes: number;
  }> = [];
  let totalLocalBytes = 0;
  let totalCentralBytes = 0;
  for (const entry of entries) {
    assertEntryPath(entry.path);
    if (seen.has(entry.path)) {
      throw new TypeError(`Duplicate ZIP entry path: ${entry.path}`);
    }
    seen.add(entry.path);
    const name = Buffer.from(entry.path, "utf8");
    const sizeBytes = entry.bytes.byteLength;
    if (
      name.byteLength > 0xffff ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 0 ||
      sizeBytes > 0xffffffff
    ) {
      throw new TypeError("The ZIP entry exceeds the supported size.");
    }
    totalLocalBytes += 30 + name.byteLength + sizeBytes;
    totalCentralBytes += 46 + name.byteLength;
    if (
      !Number.isSafeInteger(totalLocalBytes) ||
      !Number.isSafeInteger(totalCentralBytes) ||
      totalLocalBytes + totalCentralBytes + 22 > MAX_ZIP_BYTES
    ) {
      throw new TypeError("The ZIP export exceeds the supported size.");
    }
    prepared.push({ entry, name, sizeBytes });
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const { entry, name, sizeBytes } of prepared) {
    const bytes = Buffer.isBuffer(entry.bytes)
      ? entry.bytes
      : Buffer.from(
          entry.bytes.buffer,
          entry.bytes.byteOffset,
          entry.bytes.byteLength,
        );
    const timestamp = dosTimestamp(entry.modifiedAt ?? new Date(0));
    const checksum = crc32(bytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(STORED_METHOD, 8);
    local.writeUInt16LE(timestamp.time, 10);
    local.writeUInt16LE(timestamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(sizeBytes, 18);
    local.writeUInt32LE(sizeBytes, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(STORED_METHOD, 10);
    central.writeUInt16LE(timestamp.time, 12);
    central.writeUInt16LE(timestamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(sizeBytes, 20);
    central.writeUInt32LE(sizeBytes, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);

    localOffset += local.byteLength + name.byteLength + sizeBytes;
  }

  const centralOffset = localOffset;
  const centralSize = totalCentralBytes;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(
    [...localParts, ...centralParts, end],
    totalLocalBytes + totalCentralBytes + end.byteLength,
  );
}
