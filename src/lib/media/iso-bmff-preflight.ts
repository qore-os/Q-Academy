import { MediaContentInspectionError } from "@/lib/media/content-inspection";

const MEBIBYTE = 1024 * 1024;

export const ISO_BMFF_COMPLEXITY_LIMITS = Object.freeze({
  topLevelBoxes: 16_384,
  nestedBoxes: 100_000,
  nestingDepth: 32,
  metadataBoxBytes: 64 * MEBIBYTE,
  metadataBytes: 256 * MEBIBYTE,
  tableBoxes: 1024,
  entriesPerBox: 250_000,
  totalTableEntries: 4_000_000,
  tracks: 128,
  samplesPerTrack: 1_500_000,
  totalSamples: 2_000_000,
  nalUnitsPerConfiguration: 65_536,
  flacMetadataBlocks: 1_024,
  metadataStringBytes: MEBIBYTE,
  parserChunkBytes: 64 * 1024,
});

export type ApprovedIsoBmffChunk = Readonly<{
  bytes: Uint8Array;
  fileStart: number;
}>;

type CountKind = "generic" | "sample" | "table";

type BoxInfo = Readonly<{
  end: number;
  headerSize: number;
  payloadStart: number;
  size: number;
  start: number;
  type: string;
}>;

type PendingTopLevelBox = Readonly<{
  end: number;
  parts: Buffer[] | null;
  size: number;
  start: number;
  type: string;
}>;

const PURE_CONTAINERS = new Set([
  "moov",
  "trak",
  "edts",
  "mdia",
  "minf",
  "dinf",
  "stbl",
  "mvex",
  "moof",
  "traf",
  "vttc",
  "mfra",
  "meco",
  "hnti",
  "hinf",
  "strk",
  "strd",
  "sinf",
  "rinf",
  "schi",
  "trgr",
  "udta",
  "iprp",
  "ipco",
  "grpl",
  "j2kH",
  "etyp",
  "povd",
  "tapt",
  "wave",
  "tref",
]);

const VISUAL_SAMPLE_ENTRIES = new Set([
  "avc1", "avc2", "avc3", "avc4", "av01", "dav1", "hvc1", "hvc2",
  "hev1", "hev2", "hvt1", "lhe1", "lhv1", "lvc1", "dvh1", "dvhe",
  "vvc1", "vvi1", "vvs1", "vvcN", "vp08", "vp09", "avs3", "j2ki",
  "mjp2", "mjpg", "uncv", "mp4v", "encv", "resv",
]);

const AUDIO_SAMPLE_ENTRIES = new Set([
  "mp4a", "m4ae", "ac-3", "ac-4", "ec-3", "Opus", "mha1", "mha2",
  "mhm1", "mhm2", "fLaC", "enca",
]);

const SYSTEM_SAMPLE_ENTRIES = new Set(["mp4s", "encs", "wvtt"]);
const TWO_STRING_SAMPLE_ENTRIES = new Set(["mett", "sbtt", "stxt"]);
const THREE_STRING_SAMPLE_ENTRIES = new Set(["metx", "stpp"]);

const ENTITY_GROUP_BOXES = new Set([
  "aebr", "afbr", "albc", "altr", "brst", "dobr", "eqiv", "favc",
  "fobr", "iaug", "pano", "slid", "ster", "tsyn", "wbbr", "prgr",
  "pymd",
]);

function invalidPreflight(message: string): never {
  throw new MediaContentInspectionError("signature_mismatch", message);
}

function requireRange(info: BoxInfo, offset: number, length: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset < info.payloadStart ||
    offset + length > info.end
  ) {
    invalidPreflight(`The ISO media ${info.type} box is truncated.`);
  }
}

function readBoxHeader(bytes: Buffer, start: number, parentEnd: number): BoxInfo {
  if (start + 8 > parentEnd) {
    invalidPreflight("The ISO media box tree has a truncated header.");
  }
  const size32 = bytes.readUInt32BE(start);
  const type = bytes.toString("ascii", start + 4, start + 8);
  let headerSize = size32 === 1 ? 16 : 8;
  if (type === "uuid") headerSize += 16;
  if (start + headerSize > parentEnd) {
    invalidPreflight("The ISO media box tree has a truncated extended header.");
  }

  let size: number;
  if (size32 === 0) {
    size = parentEnd - start;
  } else if (size32 === 1) {
    const extendedSize = bytes.readBigUInt64BE(start + 8);
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      invalidPreflight("The ISO media file declares an unsafe box size.");
    }
    size = Number(extendedSize);
  } else {
    size = size32;
  }

  const end = start + size;
  if (
    !Number.isSafeInteger(size) ||
    size < headerSize ||
    !Number.isSafeInteger(end) ||
    end > parentEnd
  ) {
    invalidPreflight("The ISO media box tree has invalid dimensions.");
  }
  return {
    start,
    end,
    size,
    type,
    headerSize,
    payloadStart: start + headerSize,
  };
}

function fullBox(bytes: Buffer, info: BoxInfo) {
  requireRange(info, info.payloadStart, 4);
  return {
    dataStart: info.payloadStart + 4,
    flags: bytes.readUInt32BE(info.payloadStart) & 0xffffff,
    version: bytes[info.payloadStart] ?? 0,
  };
}

class StructureBudget {
  boxes = 0;
  entries = 0;
  samples = 0;
  tableBoxes = 0;
  quickTime = false;

  addBox(depth: number) {
    if (depth > ISO_BMFF_COMPLEXITY_LIMITS.nestingDepth) {
      invalidPreflight("The ISO media box tree exceeds the nesting limit.");
    }
    this.boxes += 1;
    if (this.boxes > ISO_BMFF_COMPLEXITY_LIMITS.nestedBoxes) {
      invalidPreflight("The ISO media file exceeds the nested-box limit.");
    }
  }

  addCount(count: number, kind: CountKind) {
    const perBoxLimit =
      kind === "generic"
        ? ISO_BMFF_COMPLEXITY_LIMITS.entriesPerBox
        : ISO_BMFF_COMPLEXITY_LIMITS.samplesPerTrack;
    if (!Number.isSafeInteger(count) || count < 0 || count > perBoxLimit) {
      invalidPreflight("The ISO media entry table exceeds its entry-count limit.");
    }
    this.entries += count;
    if (this.entries > ISO_BMFF_COMPLEXITY_LIMITS.totalTableEntries) {
      invalidPreflight("The ISO media file exceeds the total entry limit.");
    }
    if (kind === "sample") {
      this.samples += count;
      if (this.samples > ISO_BMFF_COMPLEXITY_LIMITS.totalSamples) {
        invalidPreflight("The ISO media file exceeds the total sample limit.");
      }
    }
    if (kind !== "generic") {
      this.tableBoxes += 1;
      if (this.tableBoxes > ISO_BMFF_COMPLEXITY_LIMITS.tableBoxes) {
        invalidPreflight("The ISO media file exceeds the sample-table limit.");
      }
    }
  }
}

function assertFixedEntries(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  countOffset: number,
  entriesStart: number,
  bytesPerEntry: number,
  kind: CountKind,
) {
  requireRange(info, countOffset, 4);
  const count = bytes.readUInt32BE(countOffset);
  budget.addCount(count, kind);
  const required = count * bytesPerEntry;
  if (!Number.isSafeInteger(required)) {
    invalidPreflight("The ISO media entry table has unsafe dimensions.");
  }
  requireRange(info, entriesStart, required);
  return count;
}

function addFixedPayloadCount(
  info: BoxInfo,
  budget: StructureBudget,
  entriesStart: number,
  bytesPerEntry: number,
  kind: CountKind,
) {
  requireRange(info, entriesStart, 0);
  const remaining = info.end - entriesStart;
  if (remaining % bytesPerEntry !== 0) {
    invalidPreflight(`The ISO media ${info.type} entry table is malformed.`);
  }
  budget.addCount(remaining / bytesPerEntry, kind);
}

function inspectCountedLeaf(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
) {
  const full = () => fullBox(bytes, info);
  switch (info.type) {
    case "ftyp":
    case "styp":
      requireRange(info, info.payloadStart, 8);
      addFixedPayloadCount(info, budget, info.payloadStart + 8, 4, "generic");
      return;
    case "pdin":
      addFixedPayloadCount(info, budget, full().dataStart, 8, "generic");
      return;
    case "stdp":
      addFixedPayloadCount(info, budget, full().dataStart, 2, "sample");
      return;
    case "sdtp":
      addFixedPayloadCount(info, budget, full().dataStart, 1, "sample");
      return;
    case "stri": {
      const { dataStart } = full();
      requireRange(info, dataStart, 8);
      addFixedPayloadCount(info, budget, dataStart + 8, 4, "generic");
      return;
    }
    case "tsel": {
      const { dataStart } = full();
      requireRange(info, dataStart, 4);
      addFixedPayloadCount(info, budget, dataStart + 4, 4, "generic");
      return;
    }
    case "tyco":
      addFixedPayloadCount(info, budget, info.payloadStart, 4, "generic");
      return;
    case "stsz": {
      const { dataStart } = full();
      requireRange(info, dataStart, 8);
      const sampleSize = bytes.readUInt32BE(dataStart);
      const count = bytes.readUInt32BE(dataStart + 4);
      budget.addCount(count, "sample");
      if (sampleSize === 0) requireRange(info, dataStart + 8, count * 4);
      return;
    }
    case "stz2": {
      const { dataStart } = full();
      requireRange(info, dataStart, 8);
      const fieldSize = bytes[dataStart + 3];
      const count = bytes.readUInt32BE(dataStart + 4);
      budget.addCount(count, "sample");
      if (fieldSize !== 4 && fieldSize !== 8 && fieldSize !== 16) {
        invalidPreflight("The ISO media compact sample table is malformed.");
      }
      requireRange(info, dataStart + 8, Math.ceil((count * fieldSize) / 8));
      return;
    }
    case "stco":
    case "stss":
      assertFixedEntries(bytes, info, budget, full().dataStart, full().dataStart + 4, 4, "table");
      return;
    case "co64":
      assertFixedEntries(bytes, info, budget, full().dataStart, full().dataStart + 4, 8, "table");
      return;
    case "stsc":
      assertFixedEntries(bytes, info, budget, full().dataStart, full().dataStart + 4, 12, "table");
      return;
    case "stts":
    case "ctts":
    case "stsh":
      assertFixedEntries(bytes, info, budget, full().dataStart, full().dataStart + 4, 8, "table");
      return;
    case "elst": {
      const box = full();
      assertFixedEntries(
        bytes,
        info,
        budget,
        box.dataStart,
        box.dataStart + 4,
        box.version === 1 ? 20 : 12,
        "generic",
      );
      return;
    }
    case "sbgp": {
      const box = full();
      requireRange(info, box.dataStart, box.version === 1 ? 12 : 8);
      const countOffset = box.dataStart + (box.version === 1 ? 8 : 4);
      assertFixedEntries(bytes, info, budget, countOffset, countOffset + 4, 8, "generic");
      return;
    }
    case "sgpd": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      let cursor = box.dataStart + 4;
      let defaultLength = 0;
      if (box.version === 1) {
        requireRange(info, cursor, 4);
        defaultLength = bytes.readUInt32BE(cursor);
        cursor += 4;
      }
      if (box.version >= 2) {
        requireRange(info, cursor, 4);
        cursor += 4;
      }
      requireRange(info, cursor, 4);
      const count = bytes.readUInt32BE(cursor);
      budget.addCount(count, "generic");
      cursor += 4;
      if (box.version === 1) {
        if (defaultLength) {
          requireRange(info, cursor, count * defaultLength);
        } else {
          for (let index = 0; index < count; index += 1) {
            requireRange(info, cursor, 4);
            const descriptionLength = bytes.readUInt32BE(cursor);
            cursor += 4;
            requireRange(info, cursor, descriptionLength);
            cursor += descriptionLength;
          }
        }
      }
      return;
    }
    case "subs": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      const count = bytes.readUInt32BE(box.dataStart);
      budget.addCount(count, "table");
      let cursor = box.dataStart + 4;
      for (let index = 0; index < count; index += 1) {
        requireRange(info, cursor, 6);
        const subsampleCount = bytes.readUInt16BE(cursor + 4);
        budget.addCount(subsampleCount, "generic");
        cursor += 6;
        const entryBytes = box.version === 1 ? 10 : 8;
        requireRange(info, cursor, subsampleCount * entryBytes);
        cursor += subsampleCount * entryBytes;
      }
      return;
    }
    case "saio": {
      const box = full();
      const cursor = box.dataStart + (box.flags & 1 ? 8 : 0);
      assertFixedEntries(
        bytes,
        info,
        budget,
        cursor,
        cursor + 4,
        box.version === 0 ? 4 : 8,
        "table",
      );
      return;
    }
    case "saiz": {
      const box = full();
      let cursor = box.dataStart + (box.flags & 1 ? 8 : 0);
      requireRange(info, cursor, 5);
      const defaultSize = bytes[cursor] ?? 0;
      cursor += 1;
      const count = bytes.readUInt32BE(cursor);
      budget.addCount(count, "sample");
      cursor += 4;
      if (defaultSize === 0) requireRange(info, cursor, count);
      return;
    }
    case "senc": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      budget.addCount(bytes.readUInt32BE(box.dataStart), "sample");
      return;
    }
    case "trun": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      const count = bytes.readUInt32BE(box.dataStart);
      budget.addCount(count, "sample");
      let cursor = box.dataStart + 4;
      if (box.flags & 1) cursor += 4;
      if (box.flags & 4) cursor += 4;
      const fields = [0x100, 0x200, 0x400, 0x800].filter(
        (flag) => box.flags & flag,
      ).length;
      requireRange(info, cursor, count * fields * 4);
      return;
    }
    case "padb": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      const count = bytes.readUInt32BE(box.dataStart);
      budget.addCount(count, "sample");
      requireRange(info, box.dataStart + 4, Math.ceil(count / 2));
      return;
    }
    case "tfra": {
      const box = full();
      requireRange(info, box.dataStart, 12);
      const lengths = bytes[box.dataStart + 7] ?? 0;
      const count = bytes.readUInt32BE(box.dataStart + 8);
      budget.addCount(count, "table");
      const variableBytes =
        ((lengths >> 4) & 3) + 1 +
        ((lengths >> 2) & 3) + 1 +
        (lengths & 3) + 1;
      requireRange(
        info,
        box.dataStart + 12,
        count * ((box.version === 1 ? 16 : 8) + variableBytes),
      );
      return;
    }
    case "pssh": {
      const box = full();
      requireRange(info, box.dataStart, 16);
      let cursor = box.dataStart + 16;
      if (box.version > 0) {
        requireRange(info, cursor, 4);
        const count = bytes.readUInt32BE(cursor);
        budget.addCount(count, "generic");
        cursor += 4;
        requireRange(info, cursor, count * 16);
        cursor += count * 16;
      }
      requireRange(info, cursor, 4);
      const dataSize = bytes.readUInt32BE(cursor);
      requireRange(info, cursor + 4, dataSize);
      return;
    }
    case "keys": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      const count = bytes.readUInt32BE(box.dataStart);
      budget.addCount(count, "generic");
      let cursor = box.dataStart + 4;
      for (let index = 0; index < count; index += 1) {
        requireRange(info, cursor, 4);
        const keySize = bytes.readUInt32BE(cursor);
        if (keySize < 4) {
          invalidPreflight("The QuickTime metadata key has invalid dimensions.");
        }
        requireRange(info, cursor, keySize);
        cursor += keySize;
      }
      return;
    }
    case "ipma": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      const count = bytes.readUInt32BE(box.dataStart);
      budget.addCount(count, "generic");
      let cursor = box.dataStart + 4;
      for (let index = 0; index < count; index += 1) {
        const idBytes = box.version < 1 ? 2 : 4;
        requireRange(info, cursor, idBytes + 1);
        cursor += idBytes;
        const associationCount = bytes[cursor] ?? 0;
        budget.addCount(associationCount, "generic");
        cursor += 1;
        const associationBytes = box.flags & 1 ? 2 : 1;
        requireRange(info, cursor, associationCount * associationBytes);
        cursor += associationCount * associationBytes;
      }
      return;
    }
    case "cmpd": {
      requireRange(info, info.payloadStart, 4);
      const count = bytes.readUInt32BE(info.payloadStart);
      budget.addCount(count, "generic");
      requireRange(info, info.payloadStart + 4, count * 2);
      return;
    }
    case "uncC": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      if (box.version === 0) {
        requireRange(info, box.dataStart + 4, 4);
        const count = bytes.readUInt32BE(box.dataStart + 4);
        budget.addCount(count, "generic");
        requireRange(info, box.dataStart + 8, count * 5);
      }
      return;
    }
    case "ssix": {
      const box = full();
      requireRange(info, box.dataStart, 4);
      const count = bytes.readUInt32BE(box.dataStart);
      budget.addCount(count, "generic");
      let cursor = box.dataStart + 4;
      for (let index = 0; index < count; index += 1) {
        requireRange(info, cursor, 4);
        const rangeCount = bytes.readUInt32BE(cursor);
        budget.addCount(rangeCount, "generic");
        cursor += 4;
        requireRange(info, cursor, rangeCount * 4);
        cursor += rangeCount * 4;
      }
      return;
    }
    case "sbpm": {
      const box = full();
      requireRange(info, box.dataStart, 2);
      const componentCount = bytes.readUInt16BE(box.dataStart);
      budget.addCount(componentCount, "generic");
      let cursor = box.dataStart + 2;
      requireRange(info, cursor, componentCount * 2);
      cursor += componentCount * 2;
      requireRange(info, cursor, 13);
      cursor += 1;
      const badRowCount = bytes.readUInt32BE(cursor);
      const badColumnCount = bytes.readUInt32BE(cursor + 4);
      const badPixelCount = bytes.readUInt32BE(cursor + 8);
      budget.addCount(badRowCount, "generic");
      budget.addCount(badColumnCount, "generic");
      budget.addCount(badPixelCount, "generic");
      cursor += 12;
      requireRange(
        info,
        cursor,
        badRowCount * 4 + badColumnCount * 4 + badPixelCount * 8,
      );
      return;
    }
    default:
      if (ENTITY_GROUP_BOXES.has(info.type)) {
        const box = full();
        requireRange(info, box.dataStart, 8);
        const count = bytes.readUInt32BE(box.dataStart + 4);
        budget.addCount(count, "generic");
        requireRange(
          info,
          box.dataStart + 8,
          count * (info.type === "pymd" ? 10 : 4),
        );
      }
  }
}

function parseChildren(
  bytes: Buffer,
  start: number,
  end: number,
  budget: StructureBudget,
  depth: number,
  declaredCount?: number,
) {
  let cursor = start;
  let count = 0;
  while (cursor < end) {
    const child = readBoxHeader(bytes, cursor, end);
    inspectBox(bytes, child, budget, depth);
    cursor = child.end;
    count += 1;
    if (declaredCount !== undefined && count > declaredCount) {
      invalidPreflight("The ISO media container has more entries than declared.");
    }
  }
  if (cursor !== end || (declaredCount !== undefined && count !== declaredCount)) {
    invalidPreflight("The ISO media container entry count is inconsistent.");
  }
}

function skipCString(bytes: Buffer, info: BoxInfo, start: number) {
  const end = bytes.indexOf(0, start);
  if (end < 0 || end >= info.end) {
    invalidPreflight(`The ISO media ${info.type} sample entry is malformed.`);
  }
  return end + 1;
}

function inspectSampleEntry(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
) {
  budget.addBox(depth);
  let childStart: number | null = null;
  if (VISUAL_SAMPLE_ENTRIES.has(info.type)) {
    childStart = info.payloadStart + 78;
  } else if (AUDIO_SAMPLE_ENTRIES.has(info.type)) {
    requireRange(info, info.payloadStart, 28);
    const version = bytes.readUInt16BE(info.payloadStart + 8);
    const extension = budget.quickTime ? (version === 1 ? 16 : version === 2 ? 36 : 0) : 0;
    childStart = info.payloadStart + 28 + extension;
  } else if (SYSTEM_SAMPLE_ENTRIES.has(info.type)) {
    childStart = info.payloadStart + 8;
  } else if (TWO_STRING_SAMPLE_ENTRIES.has(info.type)) {
    requireRange(info, info.payloadStart, 8);
    childStart = skipCString(bytes, info, info.payloadStart + 8);
    childStart = skipCString(bytes, info, childStart);
  } else if (THREE_STRING_SAMPLE_ENTRIES.has(info.type)) {
    requireRange(info, info.payloadStart, 8);
    childStart = skipCString(bytes, info, info.payloadStart + 8);
    childStart = skipCString(bytes, info, childStart);
    childStart = skipCString(bytes, info, childStart);
  } else if (info.type === "tx3g") {
    childStart = info.payloadStart + 38;
  }

  if (childStart !== null) {
    requireRange(info, childStart, 0);
    parseChildren(bytes, childStart, info.end, budget, depth + 1);
  }
}

function parseSampleEntries(
  bytes: Buffer,
  start: number,
  end: number,
  count: number,
  budget: StructureBudget,
  depth: number,
) {
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    const entry = readBoxHeader(bytes, cursor, end);
    inspectSampleEntry(bytes, entry, budget, depth);
    cursor = entry.end;
  }
  if (cursor !== end) {
    invalidPreflight("The ISO media sample-description count is inconsistent.");
  }
}

function inspectDeclaredChildContainer(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
  countBytes: 2 | 4,
  sampleEntries = false,
) {
  const box = fullBox(bytes, info);
  requireRange(info, box.dataStart, countBytes);
  const count =
    countBytes === 2
      ? bytes.readUInt16BE(box.dataStart)
      : bytes.readUInt32BE(box.dataStart);
  budget.addCount(count, "generic");
  const childrenStart = box.dataStart + countBytes;
  if (sampleEntries) {
    parseSampleEntries(bytes, childrenStart, info.end, count, budget, depth + 1);
  } else {
    parseChildren(bytes, childrenStart, info.end, budget, depth + 1, count);
  }
}

function inspectItemReferences(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
) {
  const box = fullBox(bytes, info);
  let cursor = box.dataStart;
  while (cursor < info.end) {
    const reference = readBoxHeader(bytes, cursor, info.end);
    budget.addBox(depth + 1);
    const fromIdBytes = box.version === 0 ? 2 : 4;
    requireRange(reference, reference.payloadStart, fromIdBytes + 2);
    const count = bytes.readUInt16BE(reference.payloadStart + fromIdBytes);
    budget.addCount(count, "generic");
    requireRange(
      reference,
      reference.payloadStart + fromIdBytes + 2,
      count * fromIdBytes,
    );
    cursor = reference.end;
  }
}

function inspectIlst(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
) {
  let cursor = info.payloadStart;
  while (cursor < info.end) {
    requireRange(info, cursor, 8);
    const size = bytes.readUInt32BE(cursor);
    if (size < 16 || cursor + size > info.end) {
      invalidPreflight("The QuickTime item-list box is malformed.");
    }
    const value = readBoxHeader(bytes, cursor + 8, cursor + size);
    inspectBox(bytes, value, budget, depth + 1);
    if (value.end !== cursor + size) {
      invalidPreflight("The QuickTime item-list entry is inconsistent.");
    }
    cursor += size;
  }
}

function inspectIloc(bytes: Buffer, info: BoxInfo, budget: StructureBudget) {
  const box = fullBox(bytes, info);
  requireRange(info, box.dataStart, 2);
  const first = bytes[box.dataStart] ?? 0;
  const second = bytes[box.dataStart + 1] ?? 0;
  const offsetSize = first >> 4;
  const lengthSize = first & 0xf;
  const baseOffsetSize = second >> 4;
  const indexSize = box.version === 1 || box.version === 2 ? second & 0xf : 0;
  if (
    ![0, 4, 8].includes(offsetSize) ||
    ![0, 4, 8].includes(lengthSize) ||
    ![0, 4, 8].includes(baseOffsetSize) ||
    ![0, 4, 8].includes(indexSize)
  ) {
    invalidPreflight("The ISO media item-location dimensions are unsupported.");
  }
  let cursor = box.dataStart + 2;
  const countBytes = box.version < 2 ? 2 : 4;
  requireRange(info, cursor, countBytes);
  const itemCount =
    countBytes === 2 ? bytes.readUInt16BE(cursor) : bytes.readUInt32BE(cursor);
  budget.addCount(itemCount, "generic");
  cursor += countBytes;

  for (let item = 0; item < itemCount; item += 1) {
    const itemIdBytes = box.version < 2 ? 2 : 4;
    const constructionBytes = box.version === 1 || box.version === 2 ? 2 : 0;
    requireRange(
      info,
      cursor,
      itemIdBytes + constructionBytes + 2 + baseOffsetSize + 2,
    );
    cursor += itemIdBytes + constructionBytes + 2 + baseOffsetSize;
    const extentCount = bytes.readUInt16BE(cursor);
    budget.addCount(extentCount, "generic");
    cursor += 2;
    const extentBytes = indexSize + offsetSize + lengthSize;
    requireRange(info, cursor, extentCount * extentBytes);
    cursor += extentCount * extentBytes;
  }
}

function inspectNalArrays(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  start: number,
  arrayCount: number,
  vvc = false,
) {
  let cursor = start;
  let totalNalus = 0;
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    requireRange(info, cursor, 1);
    const header = bytes[cursor] ?? 0;
    cursor += 1;
    const naluType = vvc ? header & 0x1f : header & 0x3f;
    let naluCount = 1;
    if (!vvc || (naluType !== 12 && naluType !== 13)) {
      requireRange(info, cursor, 2);
      naluCount = bytes.readUInt16BE(cursor);
      cursor += 2;
    }
    totalNalus += naluCount;
    if (
      totalNalus > ISO_BMFF_COMPLEXITY_LIMITS.nalUnitsPerConfiguration
    ) {
      invalidPreflight(
        "The ISO media codec configuration exceeds its NAL-unit limit.",
      );
    }
    budget.addCount(naluCount, "generic");
    for (let naluIndex = 0; naluIndex < naluCount; naluIndex += 1) {
      requireRange(info, cursor, 2);
      const length = bytes.readUInt16BE(cursor);
      cursor += 2;
      requireRange(info, cursor, length);
      cursor += length;
    }
  }
  if (cursor !== info.end) {
    invalidPreflight(
      `The ISO media ${info.type} codec configuration is malformed.`,
    );
  }
}

function inspectHevcConfiguration(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
) {
  requireRange(info, info.payloadStart, 23);
  const arrayCount = bytes[info.payloadStart + 22] ?? 0;
  inspectNalArrays(bytes, info, budget, info.payloadStart + 23, arrayCount);
}

function inspectLcevcConfiguration(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
) {
  requireRange(info, info.payloadStart, 15);
  if (
    bytes[info.payloadStart] !== 1 ||
    ((bytes[info.payloadStart + 4] ?? 0) & 0x3f) !== 0x3f ||
    ((bytes[info.payloadStart + 13] ?? 0) & 0x1f) !== 0x1f
  ) {
    invalidPreflight("The ISO media lvcC configuration is unsupported.");
  }
  const arrayCount = bytes[info.payloadStart + 14] ?? 0;
  let cursor = info.payloadStart + 15;
  let totalNalus = 0;
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    requireRange(info, cursor, 1);
    if (((bytes[cursor] ?? 0) >> 6) !== 0) {
      invalidPreflight("The ISO media lvcC configuration is malformed.");
    }
    cursor += 1;
    requireRange(info, cursor, 2);
    const naluCount = bytes.readUInt16BE(cursor);
    cursor += 2;
    totalNalus += naluCount;
    budget.addCount(naluCount, "generic");
    if (
      totalNalus > ISO_BMFF_COMPLEXITY_LIMITS.nalUnitsPerConfiguration
    ) {
      invalidPreflight(
        "The ISO media codec configuration exceeds its NAL-unit limit.",
      );
    }
    for (let naluIndex = 0; naluIndex < naluCount; naluIndex += 1) {
      requireRange(info, cursor, 2);
      const length = bytes.readUInt16BE(cursor);
      cursor += 2;
      requireRange(info, cursor, length);
      cursor += length;
    }
  }
  if (cursor !== info.end) {
    invalidPreflight("The ISO media lvcC configuration is malformed.");
  }
}

function inspectLayeredHevcConfiguration(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
) {
  requireRange(info, info.payloadStart, 6);
  const arrayCount = bytes[info.payloadStart + 5] ?? 0;
  inspectNalArrays(bytes, info, budget, info.payloadStart + 6, arrayCount);
}

function inspectVvcConfiguration(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
) {
  const box = fullBox(bytes, info);
  requireRange(info, box.dataStart, 1);
  const configuration = bytes[box.dataStart] ?? 0;
  const ptlPresent = (configuration & 1) === 1;
  let cursor = box.dataStart + 1;
  if (ptlPresent) {
    requireRange(info, cursor, 2);
    const layerData = bytes.readUInt16BE(cursor);
    const sublayers = (layerData >> 4) & 0x7;
    cursor += 2;
    requireRange(info, cursor, 1);
    cursor += 1;
    requireRange(info, cursor, 2);
    const profileData = bytes.readUInt16BE(cursor);
    const constraintBytes = (profileData >> 8) & 0x3f;
    cursor += 2;
    requireRange(info, cursor, 2);
    cursor += 2;
    const extraConstraintBytes = Math.max(0, constraintBytes - 1);
    requireRange(info, cursor, extraConstraintBytes);
    cursor += extraConstraintBytes;
    if (sublayers > 1) {
      requireRange(info, cursor, 1);
      const mask = bytes[cursor] ?? 0;
      cursor += 1;
      let presentLevels = 0;
      for (let index = 0; index < sublayers - 1; index += 1) {
        if (mask & (1 << (7 - index))) presentLevels += 1;
      }
      requireRange(info, cursor, presentLevels);
      cursor += presentLevels;
    }
    requireRange(info, cursor, 1);
    const subProfileCount = bytes[cursor] ?? 0;
    budget.addCount(subProfileCount, "generic");
    cursor += 1;
    requireRange(info, cursor, subProfileCount * 4 + 6);
    cursor += subProfileCount * 4 + 6;
  }
  requireRange(info, cursor, 1);
  const arrayCount = bytes[cursor] ?? 0;
  inspectNalArrays(bytes, info, budget, cursor + 1, arrayCount, true);
}

function inspectFlacConfiguration(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
) {
  const { dataStart } = fullBox(bytes, info);
  let cursor = dataStart;
  let blocks = 0;
  let continued = true;
  while (continued) {
    requireRange(info, cursor, 1);
    const flagAndType = bytes[cursor] ?? 0;
    cursor += 1;
    blocks += 1;
    if (blocks > ISO_BMFF_COMPLEXITY_LIMITS.flacMetadataBlocks) {
      invalidPreflight(
        "The ISO media FLAC configuration exceeds its block limit.",
      );
    }
    if ((flagAndType & 0x7f) === 0) {
      requireRange(info, cursor, 37);
      cursor += 37;
    } else {
      requireRange(info, cursor, 3);
      const length = bytes.readUIntBE(cursor, 3);
      cursor += 3;
      requireRange(info, cursor, length);
      cursor += length;
    }
    continued = (flagAndType & 0x80) !== 0;
  }
  budget.addCount(blocks, "generic");
  if (cursor !== info.end) {
    invalidPreflight("The ISO media FLAC configuration is malformed.");
  }
}

function inspectStereoVideoContainer(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
) {
  const { dataStart } = fullBox(bytes, info);
  requireRange(info, dataStart, 12);
  const stringLength = bytes.readUInt32BE(dataStart + 8);
  if (stringLength > ISO_BMFF_COMPLEXITY_LIMITS.metadataStringBytes) {
    invalidPreflight("The ISO media stereo metadata string is too large.");
  }
  const childrenStart = dataStart + 12 + stringLength;
  requireRange(info, dataStart + 12, stringLength);
  parseChildren(bytes, childrenStart, info.end, budget, depth + 1);
}

function inspectTrackExtensionContainer(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
) {
  const { dataStart } = fullBox(bytes, info);
  requireRange(info, dataStart, 4);
  parseChildren(bytes, dataStart + 4, info.end, budget, depth + 1);
}

function inspectBox(
  bytes: Buffer,
  info: BoxInfo,
  budget: StructureBudget,
  depth: number,
) {
  budget.addBox(depth);
  inspectCountedLeaf(bytes, info, budget);

  if (info.type === "ftyp") {
    requireRange(info, info.payloadStart, 4);
    budget.quickTime = bytes.toString("ascii", info.payloadStart, info.payloadStart + 4).includes("qt");
    return;
  }
  if (PURE_CONTAINERS.has(info.type)) {
    parseChildren(bytes, info.payloadStart, info.end, budget, depth + 1);
    return;
  }
  if (info.type === "meta") {
    const qtChildTypes = new Set(["hdlr", "mhdr", "keys", "ilst", "ctry", "lang"]);
    let childStart = info.payloadStart;
    if (
      info.end - info.payloadStart < 8 ||
      !qtChildTypes.has(bytes.toString("ascii", info.payloadStart + 4, info.payloadStart + 8))
    ) {
      childStart += 4;
    }
    requireRange(info, childStart, 0);
    parseChildren(bytes, childStart, info.end, budget, depth + 1);
    return;
  }
  if (info.type === "dref") {
    inspectDeclaredChildContainer(bytes, info, budget, depth, 4);
  } else if (info.type === "stsd") {
    inspectDeclaredChildContainer(bytes, info, budget, depth, 4, true);
  } else if (info.type === "iinf") {
    const version = fullBox(bytes, info).version;
    inspectDeclaredChildContainer(bytes, info, budget, depth, version === 0 ? 2 : 4);
  } else if (info.type === "iref") {
    inspectItemReferences(bytes, info, budget, depth);
  } else if (info.type === "ilst") {
    inspectIlst(bytes, info, budget, depth);
  } else if (info.type === "iloc") {
    inspectIloc(bytes, info, budget);
  } else if (info.type === "stvi") {
    inspectStereoVideoContainer(bytes, info, budget, depth);
  } else if (info.type === "trep") {
    inspectTrackExtensionContainer(bytes, info, budget, depth);
  } else if (info.type === "hvcC") {
    inspectHevcConfiguration(bytes, info, budget);
  } else if (info.type === "lvcC") {
    inspectLcevcConfiguration(bytes, info, budget);
  } else if (info.type === "lhvC") {
    inspectLayeredHevcConfiguration(bytes, info, budget);
  } else if (info.type === "vvcC") {
    inspectVvcConfiguration(bytes, info, budget);
  } else if (info.type === "dfLa") {
    inspectFlacConfiguration(bytes, info, budget);
  }
}

function inspectMetadataBox(bytes: Buffer, budget: StructureBudget) {
  const top = readBoxHeader(bytes, 0, bytes.length);
  if (top.end !== bytes.length) {
    invalidPreflight("The ISO media top-level box is incomplete.");
  }
  inspectBox(bytes, top, budget, 1);
}

export class IsoBmffPreflightGuard {
  readonly #expectedSizeBytes: number;
  readonly #budget = new StructureBudget();
  #position = 0;
  #header = Buffer.alloc(0);
  #headerStart = 0;
  #headerBytesRequired = 8;
  #currentBox: PendingTopLevelBox | null = null;
  #currentBytes = 0;
  #topLevelBoxes = 0;
  #metadataBytes = 0;

  constructor(expectedSizeBytes: number) {
    if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0) {
      invalidPreflight("The ISO media file has an invalid declared size.");
    }
    this.#expectedSizeBytes = expectedSizeBytes;
  }

  observe(source: Uint8Array): ApprovedIsoBmffChunk[] {
    const chunk = Buffer.from(source);
    const approved: ApprovedIsoBmffChunk[] = [];
    let cursor = 0;

    while (cursor < chunk.length) {
      if (this.#currentBox) {
        const remaining = this.#currentBox.end - this.#position;
        const length = Math.min(remaining, chunk.length - cursor);
        const segment = Buffer.from(chunk.subarray(cursor, cursor + length));
        if (this.#currentBox.parts) {
          this.#currentBox.parts.push(segment);
          this.#currentBytes += segment.length;
        } else {
          approved.push({ bytes: segment, fileStart: this.#position });
        }
        cursor += length;
        this.#position += length;
        if (this.#position === this.#currentBox.end) {
          this.#finishTopLevelBox(approved);
        }
        continue;
      }

      if (!this.#header.length) {
        this.#headerStart = this.#position;
        this.#headerBytesRequired = 8;
      }
      const headerBytes = Math.min(
        this.#headerBytesRequired - this.#header.length,
        chunk.length - cursor,
      );
      this.#header = Buffer.concat([
        this.#header,
        chunk.subarray(cursor, cursor + headerBytes),
      ]);
      cursor += headerBytes;
      this.#position += headerBytes;

      if (this.#header.length >= 8) {
        const size32 = this.#header.readUInt32BE(0);
        const type = this.#header.toString("ascii", 4, 8);
        this.#headerBytesRequired =
          (size32 === 1 ? 16 : 8) + (type === "uuid" ? 16 : 0);
      }
      if (this.#header.length < this.#headerBytesRequired) continue;
      this.#startTopLevelBox(approved);
    }
    return approved;
  }

  finalize() {
    if (
      this.#position !== this.#expectedSizeBytes ||
      this.#header.length ||
      this.#currentBox ||
      !this.#topLevelBoxes
    ) {
      invalidPreflight("The ISO media file has an incomplete box layout.");
    }
  }

  #startTopLevelBox(approved: ApprovedIsoBmffChunk[]) {
    const size32 = this.#header.readUInt32BE(0);
    const type = this.#header.toString("ascii", 4, 8);
    let size: number;
    if (size32 === 0) {
      size = this.#expectedSizeBytes - this.#headerStart;
    } else if (size32 === 1) {
      const extendedSize = this.#header.readBigUInt64BE(8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        invalidPreflight("The ISO media file declares an unsafe box size.");
      }
      size = Number(extendedSize);
    } else {
      size = size32;
    }
    const end = this.#headerStart + size;
    if (
      !Number.isSafeInteger(size) ||
      size < this.#headerBytesRequired ||
      !Number.isSafeInteger(end) ||
      end > this.#expectedSizeBytes ||
      this.#position > end
    ) {
      invalidPreflight("The ISO media file has an invalid top-level box.");
    }

    this.#topLevelBoxes += 1;
    if (this.#topLevelBoxes > ISO_BMFF_COMPLEXITY_LIMITS.topLevelBoxes) {
      invalidPreflight("The ISO media file exceeds the top-level box limit.");
    }

    const streaming = type === "mdat";
    if (!streaming) {
      if (size > ISO_BMFF_COMPLEXITY_LIMITS.metadataBoxBytes) {
        invalidPreflight("The ISO media metadata box exceeds its size limit.");
      }
      this.#metadataBytes += size;
      if (this.#metadataBytes > ISO_BMFF_COMPLEXITY_LIMITS.metadataBytes) {
        invalidPreflight("The ISO media file exceeds the metadata-size limit.");
      }
    }
    const parts = streaming ? null : [Buffer.from(this.#header)];
    this.#currentBytes = streaming ? 0 : this.#header.length;
    this.#currentBox = { start: this.#headerStart, end, size, type, parts };
    if (streaming) {
      approved.push({ bytes: Buffer.from(this.#header), fileStart: this.#headerStart });
    }
    this.#header = Buffer.alloc(0);
    if (this.#position === end) this.#finishTopLevelBox(approved);
  }

  #finishTopLevelBox(approved: ApprovedIsoBmffChunk[]) {
    const current = this.#currentBox;
    if (!current) return;
    if (current.parts) {
      if (this.#currentBytes !== current.size) {
        invalidPreflight("The ISO media metadata box changed during buffering.");
      }
      const bytes = Buffer.concat(current.parts, current.size);
      inspectMetadataBox(bytes, this.#budget);
      approved.push({ bytes, fileStart: current.start });
    }
    this.#currentBox = null;
    this.#currentBytes = 0;
  }
}
