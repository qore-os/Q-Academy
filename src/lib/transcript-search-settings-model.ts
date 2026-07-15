import { z } from "zod";

export const MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS = 100;
export const MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_RAW_LENGTH = 160;
export const MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_LENGTH = 120;
export const MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_TOKENS = 12;
export const MAX_EXCLUDED_TRANSCRIPT_SEARCH_TEXT_LENGTH = 12_000;

export type TranscriptSearchSettings = {
  excludedSearchTerms: string[];
};

export const DEFAULT_TRANSCRIPT_SEARCH_SETTINGS: TranscriptSearchSettings = {
  excludedSearchTerms: [],
};

export function normalizeTranscriptSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedTokenCount(value: string) {
  return value ? value.split(" ").length : 0;
}

const excludedSearchTermSchema = z
  .string()
  .max(
    MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_RAW_LENGTH,
    `Ein Eintrag darf hoechstens ${MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_RAW_LENGTH} Zeichen enthalten.`,
  )
  .refine(
    (value) => !/[<>]/.test(value),
    "HTML ist in Suchausschluessen nicht erlaubt.",
  )
  .transform(normalizeTranscriptSearchText)
  .pipe(
    z
      .string()
      .min(1, "Ein Eintrag muss mindestens einen Buchstaben oder eine Zahl enthalten.")
      .max(
        MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_LENGTH,
        `Ein normalisierter Eintrag darf hoechstens ${MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_LENGTH} Zeichen enthalten.`,
      )
      .refine(
        (value) =>
          normalizedTokenCount(value) <=
          MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_TOKENS,
        `Eine Phrase darf hoechstens ${MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERM_TOKENS} Woerter enthalten.`,
      ),
  );

export const transcriptSearchSettingsInputSchema = z
  .object({
    excludedSearchTerms: z
      .array(excludedSearchTermSchema)
      .max(
        MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS,
        `Es sind hoechstens ${MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS} Eintraege erlaubt.`,
      )
      .transform((terms) =>
        [...new Set(terms)].sort((left, right) =>
          left.localeCompare(right, "de-DE"),
        ),
      ),
  })
  .strict();

export const transcriptSearchSettingsTextSchema = z
  .string()
  .max(
    MAX_EXCLUDED_TRANSCRIPT_SEARCH_TEXT_LENGTH,
    `Die Eingabe darf hoechstens ${MAX_EXCLUDED_TRANSCRIPT_SEARCH_TEXT_LENGTH} Zeichen enthalten.`,
  )
  .transform((value, context) => {
    const parsed = transcriptSearchSettingsInputSchema.safeParse({
      excludedSearchTerms: value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((term) => term.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
        });
      }
      return z.NEVER;
    }
    return parsed.data.excludedSearchTerms;
  });

export function sanitizeTranscriptSearchSettings(
  value: unknown,
): TranscriptSearchSettings {
  const parsed = transcriptSearchSettingsInputSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { ...DEFAULT_TRANSCRIPT_SEARCH_SETTINGS };
}

function containsTokenSequence(queryTokens: string[], termTokens: string[]) {
  if (!termTokens.length || termTokens.length > queryTokens.length) return false;
  for (let start = 0; start <= queryTokens.length - termTokens.length; start += 1) {
    if (
      termTokens.every(
        (termToken, offset) => queryTokens[start + offset] === termToken,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isTranscriptSearchQueryExcluded(
  query: string,
  excludedSearchTerms: readonly string[],
) {
  const normalizedQuery = normalizeTranscriptSearchText(query);
  if (!normalizedQuery) return false;
  const queryTokens = normalizedQuery.split(" ");
  return excludedSearchTerms.some((candidate) => {
    const normalizedTerm = normalizeTranscriptSearchText(candidate);
    return containsTokenSequence(
      queryTokens,
      normalizedTerm ? normalizedTerm.split(" ") : [],
    );
  });
}
