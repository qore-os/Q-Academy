import type { Entry } from "yauzl";
import { fromBufferPromise } from "yauzl";
import { SaxesParser } from "saxes";

import { MediaContentInspectionError } from "@/lib/media/content-inspection";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";

const MEBIBYTE = 1024 * 1024;

export const MAX_OOXML_PACKAGE_BYTES = 100 * MEBIBYTE;

const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_CONTENT_TYPES_BYTES = 512 * 1024;
const MAX_PACKAGE_RELATIONSHIPS_BYTES = 512 * 1024;
const MAX_ROOT_ELEMENT_PREFIX_BYTES = 256 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * MEBIBYTE;
const MAX_COMPRESSION_RATIO = 200;
const COMPRESSION_RATIO_FLOOR_BYTES = 16 * MEBIBYTE;
const MAX_ENTRY_NAME_LENGTH = 1024;
const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOCUMENT_RELATIONSHIP_TYPES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
]);

export const OOXML_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const satisfies readonly AllowedMediaMimeType[];

export type OoxmlMimeType = (typeof OOXML_MIME_TYPES)[number];

type PackageDefinition = Readonly<{
  rootPart: string;
  mainContentType: string;
  rootElement: string;
  rootNamespaces: readonly string[];
}>;

const PACKAGE_DEFINITIONS: Readonly<Record<OoxmlMimeType, PackageDefinition>> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    rootPart: "word/document.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    rootElement: "document",
    rootNamespaces: [
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "http://purl.oclc.org/ooxml/wordprocessingml/main",
    ],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    rootPart: "xl/workbook.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    rootElement: "workbook",
    rootNamespaces: [
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "http://purl.oclc.org/ooxml/spreadsheetml/main",
    ],
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    rootPart: "ppt/presentation.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    rootElement: "presentation",
    rootNamespaces: [
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "http://purl.oclc.org/ooxml/presentationml/main",
    ],
  },
};

const KNOWN_ROOT_PARTS = new Set(
  Object.values(PACKAGE_DEFINITIONS).map(({ rootPart }) => rootPart),
);

function invalidOoxml(message: string): never {
  throw new MediaContentInspectionError("signature_mismatch", message);
}

export function isOoxmlMimeType(
  mimeType: AllowedMediaMimeType,
): mimeType is OoxmlMimeType {
  return OOXML_MIME_TYPES.includes(mimeType as OoxmlMimeType);
}

function isUnsafeArchiveName(fileName: string) {
  if (
    !fileName ||
    fileName.length > MAX_ENTRY_NAME_LENGTH ||
    fileName.startsWith("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(fileName) ||
    /^[a-z]:/i.test(fileName) ||
    fileName.includes("//")
  ) {
    return true;
  }

  const path = fileName.endsWith("/") ? fileName.slice(0, -1) : fileName;
  const segments = path.split("/");
  return (
    !path ||
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  );
}

function isUnixSymbolicLink(entry: Entry) {
  const platform = entry.versionMadeBy >>> 8;
  const unixFileType = (entry.externalFileAttributes >>> 16) & 0xf000;
  return platform === 3 && unixFileType === 0xa000;
}

function assertEntryMetadata(entry: Entry) {
  if (isUnsafeArchiveName(entry.fileName)) {
    invalidOoxml("The OOXML package contains an unsafe archive path.");
  }
  if (entry.isEncrypted()) {
    invalidOoxml("Encrypted OOXML package entries are not supported.");
  }
  if (isUnixSymbolicLink(entry)) {
    invalidOoxml("OOXML package links are not supported.");
  }
  if (![0, 8].includes(entry.compressionMethod) || !entry.canDecodeFileData()) {
    invalidOoxml("The OOXML package uses an unsupported compression method.");
  }
  if (
    !Number.isSafeInteger(entry.compressedSize) ||
    entry.compressedSize < 0 ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0
  ) {
    invalidOoxml("The OOXML package contains invalid entry sizes.");
  }

  if (
    entry.uncompressedSize > COMPRESSION_RATIO_FLOOR_BYTES &&
    entry.uncompressedSize >
      Math.max(1, entry.compressedSize) * MAX_COMPRESSION_RATIO
  ) {
    invalidOoxml("The OOXML package exceeds the compression-ratio limit.");
  }
}

function decodeXmlAttribute(value: string) {
  const decoded = value.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) =>
      ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      })[entity] ?? entity,
  );
  if (decoded.includes("&")) {
    invalidOoxml("The OOXML XML metadata contains an unsafe entity.");
  }
  return decoded;
}

function parseTag(source: string) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(source[index] ?? "")) index += 1;
  };
  const readName = () => {
    const match = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(source.slice(index));
    if (!match) {
      invalidOoxml("The OOXML XML metadata is malformed.");
    }
    index += match[0].length;
    return match[0];
  };

  skipWhitespace();
  const name = readName();
  const attributes = new Map<string, string>();

  while (index < source.length) {
    skipWhitespace();
    if (index >= source.length) break;
    const attributeName = readName();
    if (attributes.has(attributeName)) {
      invalidOoxml("The OOXML content-types manifest repeats an attribute.");
    }
    skipWhitespace();
    if (source[index] !== "=") {
      invalidOoxml("The OOXML XML metadata is malformed.");
    }
    index += 1;
    skipWhitespace();
    const quote = source[index];
    if (quote !== '"' && quote !== "'") {
      invalidOoxml("The OOXML XML metadata is malformed.");
    }
    index += 1;
    const end = source.indexOf(quote, index);
    if (end < 0) {
      invalidOoxml("The OOXML XML metadata is malformed.");
    }
    const value = source.slice(index, end);
    if (value.includes("<")) {
      invalidOoxml("The OOXML XML metadata is malformed.");
    }
    attributes.set(attributeName, decodeXmlAttribute(value));
    index = end + 1;
  }

  return { name, attributes };
}

function findTagEnd(xml: string, start: number) {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "<") {
      invalidOoxml("The OOXML content-types manifest is malformed.");
    } else if (character === ">") {
      return index;
    }
  }
  invalidOoxml("The OOXML content-types manifest is malformed.");
}

type ContentTypesManifest = Readonly<{
  overrides: ReadonlyMap<string, string>;
  contentTypes: readonly string[];
}>;

function qualifiedName(name: string) {
  const parts = name.split(":");
  if (parts.length === 1) return { prefix: "", localName: parts[0] };
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { prefix: parts[0], localName: parts[1] };
  }
  invalidOoxml("The OOXML XML metadata has an invalid name.");
}

function decodeUtf8Xml(bytes: Buffer, subject: string) {
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalidOoxml(`The ${subject} is not valid UTF-8.`);
  }
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(xml)) {
    invalidOoxml(`The ${subject} contains unsafe controls.`);
  }
  return xml;
}

function parseContentTypesManifest(bytes: Buffer): ContentTypesManifest {
  const xml = decodeUtf8Xml(bytes, "OOXML content-types manifest");

  const overrides = new Map<string, string>();
  const contentTypes: string[] = [];
  const stack: string[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let declarationSeen = false;
  let elementPrefix = "";
  let cursor = 0;

  while (cursor < xml.length) {
    const nextTag = xml.indexOf("<", cursor);
    const textEnd = nextTag < 0 ? xml.length : nextTag;
    if (xml.slice(cursor, textEnd).trim()) {
      invalidOoxml("The OOXML content-types manifest contains unexpected text.");
    }
    if (nextTag < 0) break;

    if (xml.startsWith("<!--", nextTag)) {
      const end = xml.indexOf("-->", nextTag + 4);
      if (end < 0 || xml.slice(nextTag + 4, end).includes("--")) {
        invalidOoxml("The OOXML content-types manifest has an invalid comment.");
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", nextTag)) {
      const end = xml.indexOf("?>", nextTag + 2);
      if (end < 0 || rootSeen || declarationSeen) {
        invalidOoxml("The OOXML content-types manifest is malformed.");
      }
      const instruction = xml.slice(nextTag + 2, end).trim();
      if (
        !/^xml(?:\s|$)/i.test(instruction) ||
        /\bencoding\s*=\s*(['"])(?!utf-8\1)[^'"]+\1/i.test(instruction)
      ) {
        invalidOoxml("The OOXML content-types manifest has an unsafe declaration.");
      }
      declarationSeen = true;
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith("<!", nextTag)) {
      invalidOoxml("DTD and entity declarations are not allowed in OOXML.");
    }

    const end = findTagEnd(xml, nextTag + 1);
    let body = xml.slice(nextTag + 1, end).trim();
    const closing = body.startsWith("/");
    const selfClosing = !closing && body.endsWith("/");
    if (closing) body = body.slice(1).trim();
    if (selfClosing) body = body.slice(0, -1).trim();
    const parsed = parseTag(body);

    if (closing) {
      if (
        parsed.attributes.size ||
        selfClosing ||
        stack.pop() !== parsed.name
      ) {
        invalidOoxml("The OOXML content-types manifest has mismatched elements.");
      }
      if (!stack.length) rootClosed = true;
      cursor = end + 1;
      continue;
    }

    if (!rootSeen) {
      const rootName = qualifiedName(parsed.name);
      const namespaceAttribute = rootName.prefix
        ? `xmlns:${rootName.prefix}`
        : "xmlns";
      if (
        rootClosed ||
        rootName.localName !== "Types" ||
        selfClosing ||
        parsed.attributes.get(namespaceAttribute) !== CONTENT_TYPES_NAMESPACE ||
        [...parsed.attributes.keys()].some(
          (name) => name !== "xmlns" && !name.startsWith("xmlns:"),
        )
      ) {
        invalidOoxml("The OOXML content-types manifest has an invalid root.");
      }
      rootSeen = true;
      elementPrefix = rootName.prefix;
      stack.push(parsed.name);
      cursor = end + 1;
      continue;
    }

    if (rootClosed || stack.length !== 1) {
      invalidOoxml("The OOXML content-types manifest has invalid nesting.");
    }
    const childName = qualifiedName(parsed.name);
    if (
      childName.prefix !== elementPrefix ||
      (childName.localName !== "Default" && childName.localName !== "Override")
    ) {
      invalidOoxml("The OOXML content-types manifest has an unknown element.");
    }

    const allowedAttributes =
      childName.localName === "Override"
        ? new Set(["PartName", "ContentType"])
        : new Set(["Extension", "ContentType"]);
    if (
      [...parsed.attributes.keys()].some(
        (attribute) => !allowedAttributes.has(attribute),
      )
    ) {
      invalidOoxml("The OOXML content-types manifest has unknown attributes.");
    }
    const contentType = parsed.attributes.get("ContentType");
    if (!contentType) {
      invalidOoxml("The OOXML content-types manifest omits a content type.");
    }
    contentTypes.push(contentType);

    if (childName.localName === "Override") {
      const partName = parsed.attributes.get("PartName");
      if (
        !partName ||
        !partName.startsWith("/") ||
        overrides.has(partName)
      ) {
        invalidOoxml("The OOXML content-types manifest has an invalid override.");
      }
      overrides.set(partName, contentType);
    } else if (!parsed.attributes.get("Extension")) {
      invalidOoxml("The OOXML content-types manifest has an invalid default.");
    }

    if (!selfClosing) stack.push(parsed.name);
    cursor = end + 1;
  }

  if (!rootSeen || !rootClosed || stack.length) {
    invalidOoxml("The OOXML content-types manifest is incomplete.");
  }
  return { overrides, contentTypes };
}

function canonicalRelationshipTarget(target: string) {
  if (
    !target ||
    target !== target.trim() ||
    /[\u0000-\u001f\u007f\\?#]/.test(target)
  ) {
    invalidOoxml("The OOXML package relationship has an unsafe target.");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    invalidOoxml("The OOXML package relationship target is malformed.");
  }
  if (
    !decoded ||
    decoded.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded) ||
    /[\u0000-\u001f\u007f\\?#]/.test(decoded)
  ) {
    invalidOoxml("The OOXML package relationship has an unsafe target.");
  }

  const segments = decoded.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    invalidOoxml("The OOXML package relationship target traverses the package.");
  }
  return segments.join("/");
}

function parsePackageRelationships(bytes: Buffer, expectedRootPart: string) {
  const xml = decodeUtf8Xml(bytes, "OOXML package relationships manifest");
  const stack: string[] = [];
  const relationshipIds = new Set<string>();
  let relationshipCount = 0;
  let officeDocumentRelationships = 0;
  let rootSeen = false;
  let rootClosed = false;
  let declarationSeen = false;
  let elementPrefix = "";
  let cursor = 0;

  while (cursor < xml.length) {
    const nextTag = xml.indexOf("<", cursor);
    const textEnd = nextTag < 0 ? xml.length : nextTag;
    if (xml.slice(cursor, textEnd).trim()) {
      invalidOoxml("The OOXML package relationships contain unexpected text.");
    }
    if (nextTag < 0) break;

    if (xml.startsWith("<!--", nextTag)) {
      const end = xml.indexOf("-->", nextTag + 4);
      if (end < 0 || xml.slice(nextTag + 4, end).includes("--")) {
        invalidOoxml("The OOXML package relationships have an invalid comment.");
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", nextTag)) {
      const end = xml.indexOf("?>", nextTag + 2);
      if (end < 0 || rootSeen || declarationSeen) {
        invalidOoxml("The OOXML package relationships are malformed.");
      }
      const instruction = xml.slice(nextTag + 2, end).trim();
      if (
        !/^xml(?:\s|$)/i.test(instruction) ||
        /\bencoding\s*=\s*(['"])(?!utf-8\1)[^'"]+\1/i.test(instruction)
      ) {
        invalidOoxml("The OOXML package relationships have an unsafe declaration.");
      }
      declarationSeen = true;
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith("<!", nextTag)) {
      invalidOoxml("DTD and entity declarations are not allowed in OOXML.");
    }

    const end = findTagEnd(xml, nextTag + 1);
    let body = xml.slice(nextTag + 1, end).trim();
    const closing = body.startsWith("/");
    const selfClosing = !closing && body.endsWith("/");
    if (closing) body = body.slice(1).trim();
    if (selfClosing) body = body.slice(0, -1).trim();
    const parsed = parseTag(body);

    if (closing) {
      if (parsed.attributes.size || stack.pop() !== parsed.name) {
        invalidOoxml("The OOXML package relationships have mismatched elements.");
      }
      if (!stack.length) rootClosed = true;
      cursor = end + 1;
      continue;
    }

    if (!rootSeen) {
      const rootName = qualifiedName(parsed.name);
      const namespaceAttribute = rootName.prefix
        ? `xmlns:${rootName.prefix}`
        : "xmlns";
      if (
        rootClosed ||
        rootName.localName !== "Relationships" ||
        selfClosing ||
        parsed.attributes.get(namespaceAttribute) !==
          PACKAGE_RELATIONSHIPS_NAMESPACE ||
        [...parsed.attributes.keys()].some(
          (name) => name !== "xmlns" && !name.startsWith("xmlns:"),
        )
      ) {
        invalidOoxml("The OOXML package relationships have an invalid root.");
      }
      rootSeen = true;
      elementPrefix = rootName.prefix;
      stack.push(parsed.name);
      cursor = end + 1;
      continue;
    }

    const childName = qualifiedName(parsed.name);
    if (
      rootClosed ||
      stack.length !== 1 ||
      childName.prefix !== elementPrefix ||
      childName.localName !== "Relationship"
    ) {
      invalidOoxml("The OOXML package relationships have invalid nesting.");
    }
    relationshipCount += 1;
    if (relationshipCount > MAX_ARCHIVE_ENTRIES) {
      invalidOoxml("The OOXML package has too many root relationships.");
    }

    const allowedAttributes = new Set([
      "Id",
      "Type",
      "Target",
      "TargetMode",
    ]);
    if (
      [...parsed.attributes.keys()].some(
        (attribute) => !allowedAttributes.has(attribute),
      )
    ) {
      invalidOoxml("The OOXML package relationship has unknown attributes.");
    }
    const id = parsed.attributes.get("Id");
    const type = parsed.attributes.get("Type");
    const target = parsed.attributes.get("Target");
    const targetMode = parsed.attributes.get("TargetMode");
    if (
      !id ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/.test(id) ||
      relationshipIds.has(id) ||
      !type ||
      /[\u0000-\u0020\u007f]/.test(type) ||
      !target
    ) {
      invalidOoxml("The OOXML package relationship is malformed or duplicated.");
    }
    relationshipIds.add(id);
    if (targetMode !== undefined && targetMode !== "Internal") {
      invalidOoxml("External OOXML package relationships are not supported.");
    }
    const canonicalTarget = canonicalRelationshipTarget(target);
    if (OFFICE_DOCUMENT_RELATIONSHIP_TYPES.has(type)) {
      officeDocumentRelationships += 1;
      if (
        officeDocumentRelationships > 1 ||
        canonicalTarget !== expectedRootPart
      ) {
        invalidOoxml("The OOXML office-document relationship is ambiguous.");
      }
    }

    if (!selfClosing) stack.push(parsed.name);
    cursor = end + 1;
  }

  if (
    !rootSeen ||
    !rootClosed ||
    stack.length ||
    officeDocumentRelationships !== 1
  ) {
    invalidOoxml("The OOXML package has no unique office-document relationship.");
  }
}

function findPartialTagEnd(xml: string, start: number) {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "<") {
      invalidOoxml("The OOXML root document is malformed.");
    } else if (character === ">") {
      return index;
    }
  }
  return null;
}

function firstXmlElement(xml: string) {
  let cursor = 0;
  let declarationSeen = false;
  while (cursor < xml.length) {
    const nextTag = xml.indexOf("<", cursor);
    if (nextTag < 0) {
      if (xml.slice(cursor).trim()) {
        invalidOoxml("The OOXML root document contains text before its root.");
      }
      return null;
    }
    if (xml.slice(cursor, nextTag).trim()) {
      invalidOoxml("The OOXML root document contains text before its root.");
    }

    const remainder = xml.slice(nextTag);
    if ("<!--".startsWith(remainder)) return null;
    if (xml.startsWith("<!--", nextTag)) {
      const end = xml.indexOf("-->", nextTag + 4);
      if (end < 0) return null;
      if (xml.slice(nextTag + 4, end).includes("--")) {
        invalidOoxml("The OOXML root document has an invalid comment.");
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", nextTag)) {
      const end = xml.indexOf("?>", nextTag + 2);
      if (end < 0) return null;
      if (declarationSeen) {
        invalidOoxml("The OOXML root document repeats its declaration.");
      }
      const instruction = xml.slice(nextTag + 2, end).trim();
      if (
        !/^xml(?:\s|$)/i.test(instruction) ||
        /\bencoding\s*=\s*(['"])(?!utf-8\1)[^'"]+\1/i.test(instruction)
      ) {
        invalidOoxml("The OOXML root document has an unsafe declaration.");
      }
      declarationSeen = true;
      cursor = end + 2;
      continue;
    }
    if (remainder === "<" || remainder === "<!") return null;
    if (xml.startsWith("<!", nextTag)) {
      invalidOoxml("DTD and entity declarations are not allowed in OOXML.");
    }
    if (xml.startsWith("</", nextTag)) {
      invalidOoxml("The OOXML root document starts with a closing element.");
    }

    const end = findPartialTagEnd(xml, nextTag + 1);
    if (end === null) return null;
    let body = xml.slice(nextTag + 1, end).trim();
    if (body.endsWith("/")) body = body.slice(0, -1).trim();
    return parseTag(body);
  }
  return null;
}

async function assertRootPart(
  zipFile: Awaited<ReturnType<typeof fromBufferPromise>>,
  entry: Entry,
  definition: PackageDefinition,
) {
  if (entry.uncompressedSize <= 0) {
    invalidOoxml("The OOXML root document is empty.");
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let prefix = "";
  let inspectedBytes = 0;

  try {
    for await (const sourceChunk of stream) {
      const chunk = Buffer.from(sourceChunk);
      const remaining = MAX_ROOT_ELEMENT_PREFIX_BYTES - inspectedBytes;
      if (remaining <= 0) {
        invalidOoxml("The OOXML root element exceeds the inspection limit.");
      }
      const inspected = chunk.subarray(0, remaining);
      inspectedBytes += inspected.length;
      let decoded = decoder.decode(inspected, { stream: true });
      if (!prefix && decoded.charCodeAt(0) === 0xfeff) decoded = decoded.slice(1);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded)) {
        invalidOoxml("The OOXML root document contains unsafe controls.");
      }
      prefix += decoded;

      const root = firstXmlElement(prefix);
      if (root) {
        const rootName = qualifiedName(root.name);
        const namespaceAttribute = rootName.prefix
          ? `xmlns:${rootName.prefix}`
          : "xmlns";
        const namespace = root.attributes.get(namespaceAttribute);
        if (
          rootName.localName !== definition.rootElement ||
          !namespace ||
          !definition.rootNamespaces.includes(namespace)
        ) {
          invalidOoxml("The OOXML root element does not match its document type.");
        }
        return;
      }
      if (inspected.length !== chunk.length) {
        invalidOoxml("The OOXML root element exceeds the inspection limit.");
      }
    }

    const decoded = decoder.decode();
    if (decoded) prefix += decoded;
    if (!firstXmlElement(prefix)) {
      invalidOoxml("The OOXML root document has no root element.");
    }
  } catch (error) {
    if (error instanceof MediaContentInspectionError) throw error;
    invalidOoxml("The OOXML root document is malformed or not valid UTF-8.");
  } finally {
    stream.destroy();
  }
}

async function readEntry(
  zipFile: Awaited<ReturnType<typeof fromBufferPromise>>,
  entry: Entry,
  maximumBytes: number,
  subject: string,
) {
  if (entry.uncompressedSize > maximumBytes) {
    invalidOoxml(`The ${subject} is too large.`);
  }

  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const sourceChunk of stream) {
    const chunk = Buffer.from(sourceChunk);
    length += chunk.length;
    if (length > maximumBytes) {
      stream.destroy();
      invalidOoxml(`The ${subject} is too large.`);
    }
    chunks.push(chunk);
  }
  if (length !== entry.uncompressedSize) {
    invalidOoxml(`The ${subject} has an invalid size.`);
  }
  return Buffer.concat(chunks, length);
}

export async function assertValidOoxmlPackage(
  mimeType: OoxmlMimeType,
  packageBytes: Buffer,
) {
  if (!packageBytes.length || packageBytes.length > MAX_OOXML_PACKAGE_BYTES) {
    invalidOoxml("The OOXML package exceeds the inspection limit.");
  }

  let zipFile: Awaited<ReturnType<typeof fromBufferPromise>> | null = null;
  try {
    zipFile = await fromBufferPromise(packageBytes, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount <= 0 || zipFile.entryCount > MAX_ARCHIVE_ENTRIES) {
      invalidOoxml("The OOXML package has an invalid number of entries.");
    }

    const entries = new Map<string, Entry>();
    const foldedNames = new Set<string>();
    let contentTypesEntry: Entry | null = null;
    let packageRelationshipsEntry: Entry | null = null;
    let entryCount = 0;
    let totalCompressed = 0;
    let totalUncompressed = 0;

    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        invalidOoxml("The OOXML package has too many entries.");
      }
      assertEntryMetadata(entry);

      const foldedName = entry.fileName.normalize("NFC").toLocaleLowerCase("en-US");
      if (entries.has(entry.fileName) || foldedNames.has(foldedName)) {
        invalidOoxml("The OOXML package repeats an archive path.");
      }
      entries.set(entry.fileName, entry);
      foldedNames.add(foldedName);

      totalCompressed += entry.compressedSize;
      totalUncompressed += entry.uncompressedSize;
      if (
        !Number.isSafeInteger(totalCompressed) ||
        !Number.isSafeInteger(totalUncompressed) ||
        totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES
      ) {
        invalidOoxml("The OOXML package exceeds the expanded-size limit.");
      }

      if (entry.fileName === "[Content_Types].xml") {
        contentTypesEntry = entry;
      }
      if (entry.fileName === "_rels/.rels") {
        packageRelationshipsEntry = entry;
      }
      if (/(?:^|\/)vbaProject\.bin$/i.test(entry.fileName)) {
        invalidOoxml("Macro-enabled OOXML packages are not supported.");
      }
    }

    if (entryCount !== zipFile.entryCount) {
      invalidOoxml("The OOXML package central directory is inconsistent.");
    }
    if (
      totalUncompressed > COMPRESSION_RATIO_FLOOR_BYTES &&
      totalUncompressed > Math.max(1, totalCompressed) * MAX_COMPRESSION_RATIO
    ) {
      invalidOoxml("The OOXML package exceeds the compression-ratio limit.");
    }
    if (!contentTypesEntry) {
      invalidOoxml("The OOXML package has no content-types manifest.");
    }
    if (!packageRelationshipsEntry) {
      invalidOoxml("The OOXML package has no package relationships manifest.");
    }

    const definition = PACKAGE_DEFINITIONS[mimeType];
    const rootEntry = entries.get(definition.rootPart);
    if (!rootEntry) {
      invalidOoxml("The OOXML package has no matching root document.");
    }
    for (const rootPart of KNOWN_ROOT_PARTS) {
      if (rootPart !== definition.rootPart && entries.has(rootPart)) {
        invalidOoxml("The OOXML package contains a conflicting root document.");
      }
    }

    const manifestBytes = await readEntry(
      zipFile,
      contentTypesEntry,
      MAX_CONTENT_TYPES_BYTES,
      "OOXML content-types manifest",
    );
    const manifest = parseContentTypesManifest(manifestBytes);
    if (
      manifest.overrides.get(`/${definition.rootPart}`) !==
      definition.mainContentType
    ) {
      invalidOoxml("The OOXML root document has the wrong content type.");
    }
    if (
      manifest.contentTypes.some((contentType) =>
        /(?:macroenabled|vbaproject)/i.test(contentType),
      )
    ) {
      invalidOoxml("Macro-enabled OOXML packages are not supported.");
    }
    const relationshipsBytes = await readEntry(
      zipFile,
      packageRelationshipsEntry,
      MAX_PACKAGE_RELATIONSHIPS_BYTES,
      "OOXML package relationships manifest",
    );
    parsePackageRelationships(relationshipsBytes, definition.rootPart);
    await assertRootPart(zipFile, rootEntry, definition);
  } catch (error) {
    if (error instanceof MediaContentInspectionError) throw error;
    invalidOoxml("The uploaded OOXML package is malformed.");
  } finally {
    zipFile?.close();
  }
}

const MAX_EXTRACTED_XML_ENTRY_BYTES = 8 * MEBIBYTE;
const MAX_EXTRACTED_XML_TOTAL_BYTES = 32 * MEBIBYTE;
const MAX_EXTRACTED_TEXT_CHARACTERS = 2_000_000;

function extractXmlText(bytes: Buffer) {
  const xml = decodeUtf8Xml(bytes, "OOXML knowledge document");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    invalidOoxml("The OOXML knowledge document contains a forbidden declaration.");
  }
  const fragments: string[] = [];
  let characters = 0;
  const parser = new SaxesParser({ xmlns: true });
  const append = (value: string) => {
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) return;
    characters += compact.length + 1;
    if (characters > MAX_EXTRACTED_TEXT_CHARACTERS) {
      invalidOoxml("The OOXML extracted text exceeds the knowledge-source limit.");
    }
    fragments.push(compact);
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("doctype", () =>
    invalidOoxml("The OOXML knowledge document contains a forbidden doctype."),
  );
  parser.write(xml).close();
  return fragments.join(" ");
}

function isKnowledgeXmlEntry(mimeType: OoxmlMimeType, fileName: string) {
  switch (mimeType) {
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(
        fileName,
      );
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(
        fileName,
      );
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return /^(?:xl\/sharedStrings|xl\/workbook|xl\/worksheets\/sheet\d+)\.xml$/.test(
        fileName,
      );
  }
}

export async function extractOoxmlKnowledgeText(
  mimeType: OoxmlMimeType,
  packageBytes: Buffer,
) {
  await assertValidOoxmlPackage(mimeType, packageBytes);
  const zipFile = await fromBufferPromise(packageBytes, {
    autoClose: false,
    lazyEntries: true,
    decodeStrings: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  try {
    const entries: Entry[] = [];
    for await (const entry of zipFile.eachEntry()) {
      assertEntryMetadata(entry);
      if (isKnowledgeXmlEntry(mimeType, entry.fileName)) entries.push(entry);
    }
    entries.sort((left, right) =>
      left.fileName.localeCompare(right.fileName, "en", { numeric: true }),
    );
    let totalBytes = 0;
    const text: string[] = [];
    for (const entry of entries) {
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_EXTRACTED_XML_TOTAL_BYTES) {
        invalidOoxml("The OOXML knowledge document exceeds the extraction limit.");
      }
      const extracted = extractXmlText(
        await readEntry(
          zipFile,
          entry,
          MAX_EXTRACTED_XML_ENTRY_BYTES,
          "OOXML knowledge XML entry",
        ),
      );
      if (extracted) text.push(extracted);
    }
    const combined = text.join("\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!combined) {
      invalidOoxml("The OOXML knowledge document contains no extractable text.");
    }
    if (combined.length > MAX_EXTRACTED_TEXT_CHARACTERS) {
      invalidOoxml("The OOXML extracted text exceeds the knowledge-source limit.");
    }
    return combined;
  } finally {
    zipFile.close();
  }
}

export class OoxmlStreamValidator {
  readonly #mimeType: OoxmlMimeType;
  readonly #expectedSizeBytes: number;
  readonly #buffer: Buffer | null;
  #offset = 0;

  constructor(mimeType: OoxmlMimeType, expectedSizeBytes: number) {
    this.#mimeType = mimeType;
    this.#expectedSizeBytes = expectedSizeBytes;
    this.#buffer =
      Number.isSafeInteger(expectedSizeBytes) &&
      expectedSizeBytes > 0 &&
      expectedSizeBytes <= MAX_OOXML_PACKAGE_BYTES
        ? Buffer.allocUnsafe(expectedSizeBytes)
        : null;
  }

  observe(chunk: Uint8Array) {
    if (this.#buffer && this.#offset + chunk.byteLength <= this.#buffer.length) {
      Buffer.from(chunk).copy(this.#buffer, this.#offset);
    }
    this.#offset += chunk.byteLength;
  }

  async finalize() {
    if (
      !this.#buffer ||
      this.#offset !== this.#expectedSizeBytes ||
      this.#offset !== this.#buffer.length
    ) {
      invalidOoxml("The OOXML package exceeds the inspection limit.");
    }
    await assertValidOoxmlPackage(this.#mimeType, this.#buffer);
  }
}
