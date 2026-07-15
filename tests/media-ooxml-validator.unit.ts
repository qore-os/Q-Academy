import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { MediaContentInspectionError } from "../src/lib/media/content-inspection";
import {
  extractOoxmlKnowledgeText,
  type OoxmlMimeType,
} from "../src/lib/media/ooxml-validator";
import { inspectAndScanMediaStream } from "../src/lib/media/scan-core";

type ZipEntryInput = Readonly<{
  name: string;
  data: Uint8Array | string;
  flags?: number;
  compressionMethod?: number;
  declaredCompressedSize?: number;
  declaredUncompressedSize?: number;
  externalFileAttributes?: number;
}>;

const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOCUMENT_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

const PACKAGE_DEFINITIONS: Readonly<
  Record<
    OoxmlMimeType,
    Readonly<{
      rootPart: string;
      mainContentType: string;
      rootElement: string;
      rootPrefix: string;
      rootNamespace: string;
    }>
  >
> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    rootPart: "word/document.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    rootElement: "document",
    rootPrefix: "w",
    rootNamespace:
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    rootPart: "xl/workbook.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    rootElement: "workbook",
    rootPrefix: "",
    rootNamespace:
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    rootPart: "ppt/presentation.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    rootElement: "presentation",
    rootPrefix: "p",
    rootNamespace:
      "http://schemas.openxmlformats.org/presentationml/2006/main",
  },
};

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: readonly ZipEntryInput[], declaredEntryCount?: number) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const input of entries) {
    const name = Buffer.from(input.name, "utf8");
    const uncompressedData = Buffer.from(input.data);
    const flags = input.flags ?? 0;
    const compressionMethod = input.compressionMethod ?? 0;
    const data =
      compressionMethod === 8 ? deflateRawSync(uncompressedData) : uncompressedData;
    const compressedSize = input.declaredCompressedSize ?? data.length;
    const uncompressedSize =
      input.declaredUncompressedSize ?? uncompressedData.length;
    const checksum = crc32(uncompressedData);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(input.externalFileAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const count = declaredEntryCount ?? entries.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function contentTypesXml(rootPart: string, mainContentType: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Types xmlns="${CONTENT_TYPES_NAMESPACE}">`,
    '<Default Extension="xml" ContentType="application/xml"/>',
    `<Override PartName="/${rootPart}" ContentType="${mainContentType}"/>`,
    "</Types>",
  ].join("");
}

function packageRelationshipsXml(
  rootPart: string,
  attributes = "",
  additionalRelationships = "",
) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">`,
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_RELATIONSHIP_TYPE}" `,
    `Target="${rootPart}"${attributes}/>`,
    additionalRelationships,
    "</Relationships>",
  ].join("");
}

function rootDocumentXml(definition: (typeof PACKAGE_DEFINITIONS)[OoxmlMimeType]) {
  const qualifiedName = definition.rootPrefix
    ? `${definition.rootPrefix}:${definition.rootElement}`
    : definition.rootElement;
  const namespaceAttribute = definition.rootPrefix
    ? `xmlns:${definition.rootPrefix}`
    : "xmlns";
  return `<?xml version="1.0" encoding="UTF-8"?><${qualifiedName} ${namespaceAttribute}="${definition.rootNamespace}"/>`;
}

function packageEntries(
  mimeType: OoxmlMimeType,
  overrides: Readonly<{
    mainContentType?: string;
    relationships?: string;
    rootDocument?: Uint8Array | string;
    rootFlags?: number;
  }> = {},
) {
  const definition = PACKAGE_DEFINITIONS[mimeType];
  return [
    {
      name: "[Content_Types].xml",
      data: contentTypesXml(
        definition.rootPart,
        overrides.mainContentType ?? definition.mainContentType,
      ),
      compressionMethod: 8,
    },
    {
      name: "_rels/.rels",
      data:
        overrides.relationships ??
        packageRelationshipsXml(definition.rootPart),
      compressionMethod: 8,
    },
    {
      name: definition.rootPart,
      data: overrides.rootDocument ?? rootDocumentXml(definition),
      compressionMethod: 8,
      flags: overrides.rootFlags,
    },
  ] satisfies ZipEntryInput[];
}

function validPackage(
  mimeType: OoxmlMimeType,
  additionalEntries: readonly ZipEntryInput[] = [],
) {
  return buildZip([...packageEntries(mimeType), ...additionalEntries]);
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

test("OOXML knowledge extraction reads structured document text", async () => {
  const mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const definition = PACKAGE_DEFINITIONS[mimeType];
  const document = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<w:document xmlns:w="${definition.rootNamespace}">`,
    "<w:body><w:p><w:r><w:t>Sichere Wissensquelle</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>Nur gepruefte Aussagen.</w:t></w:r></w:p></w:body>",
    "</w:document>",
  ].join("");
  const packageBytes = buildZip([
    ...packageEntries(mimeType, { rootDocument: document }),
  ]);
  assert.equal(
    await extractOoxmlKnowledgeText(mimeType, packageBytes),
    "Sichere Wissensquelle Nur gepruefte Aussagen.",
  );
});

async function inspectOoxml(
  bytes: Uint8Array,
  mimeType: OoxmlMimeType,
  scanner?: Parameters<typeof inspectAndScanMediaStream>[0]["scanner"],
) {
  return inspectAndScanMediaStream({
    body: splitBytes(bytes, [1, 2, 3, 5, 8, 13, 257]),
    expectedSizeBytes: bytes.length,
    mimeType,
    scanner,
  });
}

async function rejectsAsContentMismatch(
  bytes: Uint8Array,
  mimeType: OoxmlMimeType,
) {
  await assert.rejects(
    inspectOoxml(bytes, mimeType),
    (error: unknown) =>
      error instanceof MediaContentInspectionError &&
      error.code === "signature_mismatch",
  );
}

test("OOXML inspection accepts exact DOCX, XLSX, and PPTX package roots", async () => {
  for (const mimeType of Object.keys(PACKAGE_DEFINITIONS) as OoxmlMimeType[]) {
    const bytes = validPackage(mimeType);
    const result = await inspectOoxml(bytes, mimeType);
    assert.equal(result.clean, true);
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
});

test("OOXML inspection accepts a namespace-prefixed content-types manifest", async () => {
  const mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const definition = PACKAGE_DEFINITIONS[mimeType];
  const manifest = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ct:Types xmlns:ct="${CONTENT_TYPES_NAMESPACE}">`,
    '<ct:Override PartName="/word/document.xml" ',
    `ContentType="${definition.mainContentType}"/>`,
    "</ct:Types>",
  ].join("");
  const entries = packageEntries(mimeType);
  entries[0] = {
    name: "[Content_Types].xml",
    data: manifest,
    compressionMethod: 8,
  };
  const bytes = buildZip(entries);

  const result = await inspectOoxml(bytes, mimeType);
  assert.equal(result.clean, true);
});

test("OOXML inspection forwards every byte exactly once to the scanner", async () => {
  const mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const bytes = validPackage(mimeType);
  const scanned: Buffer[] = [];
  const result = await inspectOoxml(bytes, mimeType, async (body, expectedSize) => {
    assert.equal(expectedSize, bytes.length);
    for await (const chunk of body) scanned.push(Buffer.from(chunk));
    return { clean: true, signature: null };
  });

  assert.equal(result.scanner, "clamav");
  assert.deepEqual(Buffer.concat(scanned), bytes);
});

test("OOXML inspection rejects generic ZIPs, wrong roots, and wrong content types", async () => {
  const docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const xlsx =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  await rejectsAsContentMismatch(
    buildZip([{ name: "readme.txt", data: "not office" }]),
    docx,
  );
  await rejectsAsContentMismatch(validPackage(xlsx), docx);
  await rejectsAsContentMismatch(
    buildZip(packageEntries(docx, { mainContentType: "application/octet-stream" })),
    docx,
  );
  await rejectsAsContentMismatch(
    validPackage(docx, [{ name: "xl/workbook.xml", data: "<root/>" }]),
    docx,
  );
});

test("OOXML inspection rejects macros, encryption, unsafe names, and XML entities", async () => {
  const docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const definition = PACKAGE_DEFINITIONS[docx];

  await rejectsAsContentMismatch(
    validPackage(docx, [{ name: "word/vbaProject.bin", data: "macro" }]),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        mainContentType:
          "application/vnd.ms-word.document.macroEnabled.main+xml",
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(packageEntries(docx, { rootFlags: 1 })),
    docx,
  );
  await rejectsAsContentMismatch(
    validPackage(docx, [{ name: "../outside.xml", data: "unsafe" }]),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip([
      {
        name: "[Content_Types].xml",
        data: `<!DOCTYPE Types [<!ENTITY x "${definition.mainContentType}">]><Types xmlns="${CONTENT_TYPES_NAMESPACE}"><Override PartName="/${definition.rootPart}" ContentType="&x;"/></Types>`,
      },
      { name: definition.rootPart, data: "<root/>" },
    ]),
    docx,
  );
});

test("OOXML inspection rejects extreme entry counts, expansion, and ratios", async () => {
  const docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const baseEntries = packageEntries(docx);

  await rejectsAsContentMismatch(buildZip(baseEntries, 4097), docx);
  await rejectsAsContentMismatch(
    buildZip([
      ...baseEntries,
      {
        name: "word/media/oversized.bin",
        data: "x",
        compressionMethod: 8,
        declaredCompressedSize: 1,
        declaredUncompressedSize: 513 * 1024 * 1024,
      },
    ]),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip([
      ...baseEntries,
      {
        name: "word/media/bomb.bin",
        data: "x",
        compressionMethod: 8,
        declaredCompressedSize: 1,
        declaredUncompressedSize: 32 * 1024 * 1024,
      },
    ]),
    docx,
  );
});

test("OOXML inspection requires a unique safe office-document relationship", async () => {
  const docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const definition = PACKAGE_DEFINITIONS[docx];

  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx).filter((entry) => entry.name !== "_rels/.rels"),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        relationships: packageRelationshipsXml("xl/workbook.xml"),
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        relationships: packageRelationshipsXml(
          definition.rootPart,
          ' TargetMode="External"',
        ),
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        relationships: packageRelationshipsXml("../word/document.xml"),
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        relationships: packageRelationshipsXml(
          definition.rootPart,
          "",
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
        ),
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        relationships: packageRelationshipsXml(
          definition.rootPart,
          "",
          `<Relationship Id="rId2" Type="${OFFICE_DOCUMENT_RELATIONSHIP_TYPE}" Target="${definition.rootPart}"/>`,
        ),
      }),
    ),
    docx,
  );
});

test("OOXML inspection verifies the typed XML root and namespace", async () => {
  const docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const definition = PACKAGE_DEFINITIONS[docx];

  await rejectsAsContentMismatch(
    buildZip(packageEntries(docx, { rootDocument: "<root/>" })),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        rootDocument: '<w:document xmlns:w="urn:not-wordprocessing"/>',
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        rootDocument: `<!DOCTYPE w:document [<!ENTITY x "unsafe">]><w:document xmlns:w="${definition.rootNamespace}">&x;</w:document>`,
      }),
    ),
    docx,
  );
  await rejectsAsContentMismatch(
    buildZip(
      packageEntries(docx, {
        rootDocument: Buffer.concat([
          Buffer.from('<w:document xmlns:w="'),
          Buffer.from([0xff]),
          Buffer.from('"/>'),
        ]),
      }),
    ),
    docx,
  );
});

test("OOXML structural failures still consume the complete scanner stream", async () => {
  const mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const bytes = buildZip([{ name: "generic.txt", data: "generic ZIP" }]);
  const scanned: Buffer[] = [];

  await assert.rejects(
    inspectOoxml(bytes, mimeType, async (body) => {
      for await (const chunk of body) scanned.push(Buffer.from(chunk));
      return { clean: true, signature: null };
    }),
    MediaContentInspectionError,
  );
  assert.deepEqual(Buffer.concat(scanned), bytes);
});
