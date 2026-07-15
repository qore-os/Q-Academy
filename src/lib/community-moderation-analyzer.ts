import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII, URL } from "node:url";

export const COMMUNITY_MODERATION_MAX_INPUT_BYTES = 50 * 1024;
export const COMMUNITY_MODERATION_MAX_POLICY_LINKS = 100;
export const COMMUNITY_MODERATION_MAX_DETECTED_LINKS =
  COMMUNITY_MODERATION_MAX_POLICY_LINKS + 1;
export const COMMUNITY_MODERATION_MAX_DOMAINS = 64;
export const COMMUNITY_MODERATION_MAX_KNOWN_FINGERPRINTS = 10_000;

const MAX_NORMALIZED_CODE_UNITS = COMMUNITY_MODERATION_MAX_INPUT_BYTES * 4;
const MAX_LINK_CANDIDATES = 2_048;
const MAX_LINK_CANDIDATE_CODE_UNITS = 2_048;
const MAX_TENANT_ID_BYTES = 256;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4_096;

const DEFAULT_IGNORABLE_CHARACTERS =
  /[\u00ad\u034f\u061c\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]/gu;
const UNICODE_DOTS = /[\u3002\ufe52\uff0e\uff61]/gu;
const OBFUSCATED_DOT = /(?:\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\})/gu;
const OBFUSCATED_COLON = /(?:\[\s*:\s*\]|\(\s*:\s*\)|\{\s*:\s*\})/gu;
const OBFUSCATED_HTTP = /\bhxxps?(?=:\/\/)/gu;
const ADJACENT_EXPLICIT_LINK_SEPARATOR = /([,;])(?=(?:https?:\/\/|www\.))/gu;
const LINK_CANDIDATE_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}\.)+[\p{L}\p{N}-]{2,63})(?::[0-9]{1,5})?(?:\/[^\s<>"'`]*)?/giu;
const TRAILING_URL_CHARACTERS = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "\u2026",
  "]",
  ")",
  "}",
]);
const ASCII_DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HEX_FINGERPRINT = /^[a-f0-9]{64}$/u;

export type CommunityModerationReasonCode = "duplicate" | "link_limit";

export type CommunityModerationPolicy = Readonly<{
  maxLinks: number;
}>;

export type CommunityModerationAnalysis = Readonly<{
  fingerprint: string;
  linkCount: number;
  domains: readonly string[];
  reasonCodes: readonly CommunityModerationReasonCode[];
}>;

export type AnalyzeCommunityModerationInput = Readonly<{
  content: string;
  tenantId: string;
  secret: string | Uint8Array;
  policy: CommunityModerationPolicy;
  knownFingerprints?: ReadonlySet<string>;
}>;

function utf8Length(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function assertAnalyzerInput(input: AnalyzeCommunityModerationInput) {
  if (typeof input.content !== "string") {
    throw new TypeError("Community moderation content must be a string.");
  }
  if (
    input.content.length > COMMUNITY_MODERATION_MAX_INPUT_BYTES ||
    utf8Length(input.content) > COMMUNITY_MODERATION_MAX_INPUT_BYTES
  ) {
    throw new RangeError(
      `Community moderation content must not exceed ${COMMUNITY_MODERATION_MAX_INPUT_BYTES} UTF-8 bytes.`,
    );
  }
  if (typeof input.tenantId !== "string") {
    throw new TypeError("Community moderation tenantId must be a string.");
  }
  const tenantId = input.tenantId.normalize("NFKC").trim().toLowerCase();
  if (!tenantId || utf8Length(tenantId) > MAX_TENANT_ID_BYTES) {
    throw new RangeError("Community moderation tenantId is empty or too long.");
  }
  const secretBytes =
    typeof input.secret === "string"
      ? utf8Length(input.secret)
      : input.secret instanceof Uint8Array
        ? input.secret.byteLength
        : 0;
  if (secretBytes < MIN_SECRET_BYTES || secretBytes > MAX_SECRET_BYTES) {
    throw new RangeError(
      `Community moderation secret must contain ${MIN_SECRET_BYTES}-${MAX_SECRET_BYTES} bytes.`,
    );
  }
  if (
    !Number.isSafeInteger(input.policy.maxLinks) ||
    input.policy.maxLinks < 0 ||
    input.policy.maxLinks > COMMUNITY_MODERATION_MAX_POLICY_LINKS
  ) {
    throw new RangeError(
      `Community moderation maxLinks must be an integer between 0 and ${COMMUNITY_MODERATION_MAX_POLICY_LINKS}.`,
    );
  }
  if (
    input.knownFingerprints &&
    input.knownFingerprints.size > COMMUNITY_MODERATION_MAX_KNOWN_FINGERPRINTS
  ) {
    throw new RangeError("Community moderation fingerprint set is too large.");
  }
  return tenantId;
}

function normalizeContent(content: string) {
  const normalized = content
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  if (normalized.length > MAX_NORMALIZED_CODE_UNITS) {
    throw new RangeError(
      "Normalized community moderation content is too long.",
    );
  }
  return normalized;
}

function fingerprintContent(input: {
  normalizedContent: string;
  tenantId: string;
  secret: string | Uint8Array;
}) {
  const tenant = Buffer.from(input.tenantId, "utf8");
  return createHmac("sha256", input.secret)
    .update("q-academy:community-moderation:v1\0", "utf8")
    .update(String(tenant.byteLength), "ascii")
    .update("\0", "utf8")
    .update(tenant)
    .update("\0", "utf8")
    .update(input.normalizedContent, "utf8")
    .digest("hex");
}

function linkDetectionText(normalizedContent: string) {
  return normalizedContent
    .replace(UNICODE_DOTS, ".")
    .replace(OBFUSCATED_DOT, ".")
    .replace(OBFUSCATED_COLON, ":")
    .replace(OBFUSCATED_HTTP, (scheme) =>
      scheme === "hxxps" ? "https" : "http",
    )
    .replace(ADJACENT_EXPLICIT_LINK_SEPARATOR, "$1 ");
}

function trimLinkCandidate(value: string) {
  const candidate = value.slice(0, MAX_LINK_CANDIDATE_CODE_UNITS);
  let end = candidate.length;
  while (end > 0 && TRAILING_URL_CHARACTERS.has(candidate.charAt(end - 1))) {
    end -= 1;
  }
  return candidate.slice(0, end);
}

function validAsciiHostname(hostname: string) {
  if (!hostname || hostname.length > 253) return false;
  const unwrapped =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (isIP(unwrapped)) return true;
  return hostname
    .split(".")
    .every((label) => label.length <= 63 && ASCII_DOMAIN_LABEL.test(label));
}

function domainForCandidate(rawCandidate: string, precedingCharacter: string) {
  if (precedingCharacter === "@") return null;
  const candidate = trimLinkCandidate(rawCandidate);
  if (!candidate) return null;
  const hasScheme =
    candidate.startsWith("http://") || candidate.startsWith("https://");
  const urlValue = hasScheme ? candidate : `http://${candidate}`;
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const hostname = parsed.hostname.endsWith(".")
      ? parsed.hostname.slice(0, -1)
      : parsed.hostname;
    const ascii = domainToASCII(hostname).toLowerCase();
    if (!validAsciiHostname(ascii)) return null;
    return ascii;
  } catch {
    return null;
  }
}

function detectLinks(normalizedContent: string) {
  const text = linkDetectionText(normalizedContent);
  const domains: string[] = [];
  const knownDomains = new Set<string>();
  let linkCount = 0;
  let candidateCount = 0;

  for (const match of text.matchAll(LINK_CANDIDATE_PATTERN)) {
    candidateCount += 1;
    if (candidateCount > MAX_LINK_CANDIDATES) break;
    const index = match.index ?? 0;
    const domain = domainForCandidate(match[0], text[index - 1] ?? "");
    if (!domain) continue;
    linkCount += 1;
    if (
      domains.length < COMMUNITY_MODERATION_MAX_DOMAINS &&
      !knownDomains.has(domain)
    ) {
      knownDomains.add(domain);
      domains.push(domain);
    }
    if (linkCount >= COMMUNITY_MODERATION_MAX_DETECTED_LINKS) break;
  }

  return { linkCount, domains };
}

export function analyzeCommunityModerationContent(
  input: AnalyzeCommunityModerationInput,
): CommunityModerationAnalysis {
  const tenantId = assertAnalyzerInput(input);
  const normalizedContent = normalizeContent(input.content);
  const fingerprint = fingerprintContent({
    normalizedContent,
    tenantId,
    secret: input.secret,
  });
  const { linkCount, domains } = detectLinks(normalizedContent);
  const reasonCodes: CommunityModerationReasonCode[] = [];
  if (input.knownFingerprints?.has(fingerprint)) {
    reasonCodes.push("duplicate");
  }
  if (linkCount > input.policy.maxLinks) {
    reasonCodes.push("link_limit");
  }
  return {
    fingerprint,
    linkCount,
    domains,
    reasonCodes,
  };
}

export function isCommunityModerationFingerprint(value: string) {
  return HEX_FINGERPRINT.test(value);
}
