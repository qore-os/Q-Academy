import { sanitizeAiReferenceText } from "@/lib/ai/grounding";

export const AI_AGENT_PREVIEW_SAFE_OUTPUT =
  "Fuer diese Vorschau liegt keine sichere Antwort vor.";

const MAX_OUTPUT_CHARACTERS = 16_000;
const MAX_OUTPUT_BYTES = 64_000;
const MAX_PROTECTED_VALUES = 64;
const MAX_PROTECTED_VALUE_CHARACTERS = 4_000;
const MAX_PROTECTED_VALUE_BYTES = 16_000;
const MAX_PROTECTED_CHARACTERS = 32_000;
const MAX_PROTECTED_BYTES = 64_000;
const MAX_PROTECTED_FRAGMENTS = 256;
const MAX_REGEX_REPLACEMENTS = 256;
const MAX_SOURCE_PREFIX_CHARACTERS = 4_000;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const INTERNAL_ACADEMY_PATH_PATTERN =
  /\/(?:academy|admin|api)(?:\/[a-z0-9._~!$&'()*+,;=:@%/?#-]*)?/gi;

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function protectedFragments(protectedValues: readonly string[]) {
  if (protectedValues.length > MAX_PROTECTED_VALUES) return null;
  const fragments = new Set<string>();
  let totalCharacters = 0;
  let totalBytes = 0;
  for (const protectedValue of protectedValues) {
    if (
      typeof protectedValue !== "string" ||
      protectedValue.length > MAX_PROTECTED_VALUE_CHARACTERS
    ) {
      return null;
    }
    const valueBytes = utf8Bytes(protectedValue);
    if (valueBytes > MAX_PROTECTED_VALUE_BYTES) return null;
    totalCharacters += protectedValue.length;
    totalBytes += valueBytes;
    if (totalCharacters > MAX_PROTECTED_CHARACTERS) return null;
    if (totalBytes > MAX_PROTECTED_BYTES) return null;
    const normalized = protectedValue.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const candidates = [normalized, ...normalized.split(/[.!?]\s+/)];
    for (const candidate of candidates) {
      const fragment = candidate.trim();
      if (fragment.length < 8) continue;
      fragments.add(fragment);
      if (
        fragments.size > MAX_PROTECTED_FRAGMENTS ||
        fragments.size > MAX_REGEX_REPLACEMENTS
      ) {
        return null;
      }
    }
  }
  return [...fragments].sort((left, right) => right.length - left.length);
}

function containsInternalReference(value: string) {
  UUID_PATTERN.lastIndex = 0;
  INTERNAL_ACADEMY_PATH_PATTERN.lastIndex = 0;
  return UUID_PATTERN.test(value) || INTERNAL_ACADEMY_PATH_PATTERN.test(value);
}

export function sanitizeAiAgentDraftPreviewProviderText(
  value: unknown,
  limit: number,
) {
  if (
    typeof value !== "string" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 4_000 ||
    value.length > 4_000 ||
    utf8Bytes(value) > MAX_PROTECTED_VALUE_BYTES
  ) {
    return "";
  }
  const redacted = sanitizeAiReferenceText(value, limit)
    .replace(UUID_PATTERN, "[interne Referenz entfernt]")
    .replace(INTERNAL_ACADEMY_PATH_PATTERN, "[interner Pfad entfernt]");
  const safe = sanitizeAiReferenceText(redacted, limit).trim();
  return safe && !containsInternalReference(safe) ? safe : "";
}

export function sanitizeAiAgentDraftPreviewSourceText(value: unknown) {
  if (typeof value !== "string") return "";
  return sanitizeAiReferenceText(
    value.slice(0, MAX_SOURCE_PREFIX_CHARACTERS),
    1_600,
  );
}

export function sanitizeAiAgentDraftPreviewOutput(
  value: unknown,
  protectedValues: readonly string[],
  limit = 2_400,
) {
  if (
    typeof value !== "string" ||
    value.length > MAX_OUTPUT_CHARACTERS ||
    utf8Bytes(value) > MAX_OUTPUT_BYTES ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_OUTPUT_CHARACTERS
  ) {
    return AI_AGENT_PREVIEW_SAFE_OUTPUT;
  }
  const fragments = protectedFragments(protectedValues);
  if (!fragments) return AI_AGENT_PREVIEW_SAFE_OUTPUT;

  try {
    let redacted = value;
    for (const fragment of fragments) {
      redacted = redacted.replace(
        new RegExp(regexEscape(fragment).replace(/ /g, "\\s+"), "gi"),
        "[geschuetzter Inhalt]",
      );
    }
    redacted = redacted
      .replace(UUID_PATTERN, "[interne Referenz entfernt]")
      .replace(INTERNAL_ACADEMY_PATH_PATTERN, "[interner Pfad entfernt]");
    const safe = sanitizeAiReferenceText(redacted, limit).trim();
    if (!safe || containsInternalReference(safe)) {
      return AI_AGENT_PREVIEW_SAFE_OUTPUT;
    }
    return safe;
  } catch {
    return AI_AGENT_PREVIEW_SAFE_OUTPUT;
  }
}
