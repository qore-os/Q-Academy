import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import { ApiError } from "@/lib/api/errors";

export const WEB_KNOWLEDGE_SOURCE_LIMITS = Object.freeze({
  dnsTimeoutMs: 2_000,
  requestTimeoutMs: 7_000,
  maxResponseBytes: 512 * 1024,
  maxTextCharacters: 200_000,
  maxUrlCharacters: 2_048,
});

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export type ResolvedWebKnowledgeTarget = Readonly<{
  url: URL;
  address: string;
  family: 4 | 6;
}>;

export type WebKnowledgeResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: AsyncIterable<Uint8Array>;
  close: () => void;
}>;

export type WebKnowledgeSnapshot = Readonly<{
  sourceUrl: string;
  title: string;
  content: string;
  contentDigest: string;
  fetchedAt: Date;
}>;

type LookupAddress = { address: string; family: number };
type WebKnowledgeDependencies = Readonly<{
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
  open?: (
    target: ResolvedWebKnowledgeTarget,
  ) => Promise<WebKnowledgeResponse>;
  now?: () => Date;
}>;

const OMITTED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "textarea",
  "select",
  "button",
  "nav",
  "footer",
]);

const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "ol",
]);

function webSourceValidationError(message: string) {
  return new ApiError(422, "validation_error", message);
}

export function normalizeWebKnowledgeSourceUrl(value: string) {
  if (value.length > WEB_KNOWLEDGE_SOURCE_LIMITS.maxUrlCharacters) {
    throw webSourceValidationError(
      "Die Webquellen-URL darf hoechstens 2048 Zeichen lang sein.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw webSourceValidationError("Die Webquellen-URL ist ungueltig.");
  }
  if (url.protocol !== "https:") {
    throw webSourceValidationError("Webquellen muessen HTTPS verwenden.");
  }
  if (url.username || url.password) {
    throw webSourceValidationError(
      "Webquellen-URLs duerfen keine Zugangsdaten enthalten.",
    );
  }
  if (url.port && url.port !== "443") {
    throw webSourceValidationError(
      "Webquellen duerfen nur den HTTPS-Port 443 verwenden.",
    );
  }
  if (!url.hostname) {
    throw webSourceValidationError("Die Webquellen-URL benoetigt einen Hostnamen.");
  }
  url.hash = "";
  if (url.port === "443") url.port = "";
  return url;
}

function normalizedIpLiteral(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicUnicastWebAddress(value: string) {
  try {
    let address = ipaddr.parse(value);
    if (address.kind() === "ipv6") {
      const ipv6 = address as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) address = ipv6.toIPv4Address();
    }
    return address.range() === "unicast";
  } catch {
    return false;
  }
}

async function boundedLookup(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              webSourceValidationError(
                "Die Webquelle konnte nicht rechtzeitig sicher aufgeloest werden.",
              ),
            ),
          WEB_KNOWLEDGE_SOURCE_LIMITS.dnsTimeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw webSourceValidationError(
      "Die Webquelle konnte nicht sicher aufgeloest werden.",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolvePublicWebKnowledgeTarget(
  value: string,
  dependencies: Pick<WebKnowledgeDependencies, "lookup"> = {},
): Promise<ResolvedWebKnowledgeTarget> {
  const url = normalizeWebKnowledgeSourceUrl(value);
  const hostname = normalizedIpLiteral(url.hostname);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await (dependencies.lookup ?? boundedLookup)(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicUnicastWebAddress(address))
  ) {
    throw webSourceValidationError(
      "Webquellen duerfen nicht auf lokale, private oder reservierte Netze zeigen.",
    );
  }
  const pinned = addresses[0]!;
  return {
    url,
    address: pinned.address,
    family: pinned.family === 6 ? 6 : 4,
  };
}

function openPinnedHttpsResponse(
  target: ResolvedWebKnowledgeTarget,
): Promise<WebKnowledgeResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseClosed = false;
    const hostname = normalizedIpLiteral(target.url.hostname);
    const options: RequestOptions = {
      protocol: "https:",
      hostname,
      port: 443,
      family: target.family,
      method: "GET",
      path: `${target.url.pathname}${target.url.search}`,
      agent: false,
      servername: isIP(hostname) ? undefined : hostname,
      headers: {
        Accept: "text/html, text/plain;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "Q-Academy-Web-Knowledge/1.0",
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, target.address, target.family);
      },
    };
    const request = httpsRequest(options, (response) => {
      settled = true;
      const close = () => {
        if (responseClosed) return;
        responseClosed = true;
        clearTimeout(deadline);
        response.destroy();
      };
      response.once("end", () => clearTimeout(deadline));
      response.once("close", () => clearTimeout(deadline));
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        close,
      });
    });
    const deadline = setTimeout(() => {
      request.destroy(new Error("web_knowledge_request_timeout"));
    }, WEB_KNOWLEDGE_SOURCE_LIMITS.requestTimeoutMs);
    request.once("error", () => {
      clearTimeout(deadline);
      if (!settled) {
        reject(
          webSourceValidationError(
            "Die Webquelle konnte nicht innerhalb des Zeitlimits abgerufen werden.",
          ),
        );
      }
    });
    request.end();
  });
}

function singleHeader(
  headers: WebKnowledgeResponse["headers"],
  name: string,
) {
  const value = headers[name];
  return Array.isArray(value) ? null : value;
}

function validatedContentType(headers: WebKnowledgeResponse["headers"]) {
  const raw = singleHeader(headers, "content-type");
  if (!raw) {
    throw webSourceValidationError(
      "Die Webquelle muss einen eindeutigen Text-Content-Type liefern.",
    );
  }
  const [mediaType, ...parameters] = raw
    .split(";")
    .map((part) => part.trim().toLowerCase());
  if (mediaType !== "text/html" && mediaType !== "text/plain") {
    throw webSourceValidationError(
      "Webquellen muessen HTML oder Klartext liefern.",
    );
  }
  const charset = parameters
    .find((parameter) => parameter.startsWith("charset="))
    ?.slice("charset=".length)
    .replace(/^['"]|['"]$/g, "");
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    throw webSourceValidationError("Webquellen muessen UTF-8 verwenden.");
  }
  const contentEncoding = singleHeader(headers, "content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw webSourceValidationError(
      "Komprimierte Webquellen-Antworten werden nicht verarbeitet.",
    );
  }
  return mediaType;
}

async function readBoundedResponse(response: WebKnowledgeResponse) {
  const contentLength = singleHeader(response.headers, "content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > WEB_KNOWLEDGE_SOURCE_LIMITS.maxResponseBytes
    ) {
      throw webSourceValidationError("Die Webquelle ueberschreitet das Groessenlimit.");
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > WEB_KNOWLEDGE_SOURCE_LIMITS.maxResponseBytes) {
      throw webSourceValidationError("Die Webquelle ueberschreitet das Groessenlimit.");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks, total);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw webSourceValidationError("Die Webquelle enthaelt kein gueltiges UTF-8.");
  }
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function elementAttribute(node: HtmlElement, name: string) {
  return node.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function hiddenElement(node: HtmlElement) {
  return (
    elementAttribute(node, "hidden") !== null ||
    elementAttribute(node, "aria-hidden")?.toLowerCase() === "true"
  );
}

function findFirstElement(node: HtmlNode, tagNames: ReadonlySet<string>): HtmlElement | null {
  if (isElement(node) && tagNames.has(node.tagName)) return node;
  if (!("childNodes" in node)) return null;
  for (const child of node.childNodes) {
    const match = findFirstElement(child, tagNames);
    if (match) return match;
  }
  return null;
}

function appendReadableText(node: HtmlNode, output: string[]) {
  if (node.nodeName === "#text" && "value" in node) {
    output.push(node.value);
    return;
  }
  if (!("childNodes" in node)) return;
  if (isElement(node)) {
    if (OMITTED_ELEMENTS.has(node.tagName) || hiddenElement(node)) return;
    if (BLOCK_ELEMENTS.has(node.tagName)) output.push("\n");
  }
  for (const child of node.childNodes) appendReadableText(child, output);
  if (isElement(node) && BLOCK_ELEMENTS.has(node.tagName)) output.push("\n");
}

function compactReadableText(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundedTitle(value: string, fallback: string) {
  const compact = compactReadableText(value).replace(/\s+/g, " ");
  const title = compact || fallback;
  return Array.from(title).slice(0, 220).join("");
}

export function extractReadableWebKnowledge(input: {
  sourceUrl: string;
  mediaType: "text/html" | "text/plain";
  body: string;
}) {
  const url = new URL(input.sourceUrl);
  if (input.mediaType === "text/plain") {
    const content = compactReadableText(input.body);
    if (content.length < 10) {
      throw webSourceValidationError(
        "Die Webquelle enthaelt nicht genug lesbaren Text.",
      );
    }
    if (Array.from(content).length > WEB_KNOWLEDGE_SOURCE_LIMITS.maxTextCharacters) {
      throw webSourceValidationError("Die Webquelle enthaelt zu viel lesbaren Text.");
    }
    return { title: boundedTitle(url.hostname, "Webquelle"), content };
  }

  const document = parse(input.body);
  const body = findFirstElement(document, new Set(["body"])) ?? document;
  const output: string[] = [];
  appendReadableText(body, output);
  const content = compactReadableText(output.join(""));
  if (content.length < 10) {
    throw webSourceValidationError(
      "Die Webquelle enthaelt nicht genug lesbaren Text.",
    );
  }
  if (Array.from(content).length > WEB_KNOWLEDGE_SOURCE_LIMITS.maxTextCharacters) {
    throw webSourceValidationError("Die Webquelle enthaelt zu viel lesbaren Text.");
  }
  const titleElement =
    findFirstElement(document, new Set(["title"])) ??
    findFirstElement(body, new Set(["h1"]));
  const titleOutput: string[] = [];
  if (titleElement) appendReadableText(titleElement, titleOutput);
  return {
    title: boundedTitle(titleOutput.join(""), url.hostname),
    content,
  };
}

export async function fetchWebKnowledgeSnapshot(
  value: string,
  dependencies: WebKnowledgeDependencies = {},
): Promise<WebKnowledgeSnapshot> {
  const target = await resolvePublicWebKnowledgeTarget(value, dependencies);
  const response = await (dependencies.open ?? openPinnedHttpsResponse)(target);
  try {
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw webSourceValidationError(
        "Weiterleitungen sind fuer Webquellen nicht erlaubt.",
      );
    }
    if (response.statusCode !== 200) {
      throw webSourceValidationError(
        "Die Webquelle muss ohne Anmeldung direkt erreichbar sein.",
      );
    }
    const mediaType = validatedContentType(response.headers);
    const rawBody = await readBoundedResponse(response);
    const extracted = extractReadableWebKnowledge({
      sourceUrl: target.url.toString(),
      mediaType,
      body: rawBody,
    });
    return {
      sourceUrl: target.url.toString(),
      title: extracted.title,
      content: extracted.content,
      contentDigest: createHash("sha256")
        .update(extracted.content, "utf8")
        .digest("hex"),
      fetchedAt: (dependencies.now ?? (() => new Date()))(),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw webSourceValidationError(
      "Die Webquelle konnte nicht sicher verarbeitet werden.",
    );
  } finally {
    response.close();
  }
}
