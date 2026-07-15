import assert from "node:assert/strict";
import test from "node:test";

import {
  isTranscriptSearchQueryExcluded,
  MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS,
  normalizeTranscriptSearchText,
  sanitizeTranscriptSearchSettings,
  transcriptSearchSettingsInputSchema,
  transcriptSearchSettingsTextSchema,
} from "../src/lib/transcript-search-settings-model";

test("transcript exclusions normalize Unicode, case and punctuation", () => {
  assert.equal(
    normalizeTranscriptSearchText("  KU\u0308NSTLICHE---Intelligenz  "),
    "kunstliche intelligenz",
  );
  assert.equal(
    normalizeTranscriptSearchText(
      "\u041f\u0440\u0438\u0432\u0435\u0442, \u041c\u0418\u0420",
    ),
    "\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440",
  );

  const parsed = transcriptSearchSettingsInputSchema.parse({
    excludedSearchTerms: ["^KI$", "ki", "Interne Roadmap"],
  });
  assert.deepEqual(parsed.excludedSearchTerms, ["interne roadmap", "ki"]);
});

test("a blocked word matches a complete query token but not a partial word", () => {
  assert.equal(isTranscriptSearchQueryExcluded("KI", ["ki"]), true);
  assert.equal(
    isTranscriptSearchQueryExcluded("Grundlagen KI kompakt", ["ki"]),
    true,
  );
  assert.equal(isTranscriptSearchQueryExcluded("Kinder", ["ki"]), false);
  assert.equal(
    isTranscriptSearchQueryExcluded("Grundlagen fuer Kinder", ["ki"]),
    false,
  );
});

test("a blocked phrase matches only as a contiguous token sequence", () => {
  assert.equal(
    isTranscriptSearchQueryExcluded(
      "Unsere INTERNE-Roadmap fuer 2026",
      ["interne roadmap"],
    ),
    true,
  );
  assert.equal(
    isTranscriptSearchQueryExcluded(
      "interne neue roadmap",
      ["interne roadmap"],
    ),
    false,
  );
  assert.equal(
    isTranscriptSearchQueryExcluded("Roadmap intern", ["interne roadmap"]),
    false,
  );
});

test("transcript exclusion schemas enforce limits and reject empty entries", () => {
  assert.equal(
    transcriptSearchSettingsInputSchema.safeParse({
      excludedSearchTerms: Array.from(
        { length: MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS + 1 },
        (_, index) => `term ${index}`,
      ),
    }).success,
    false,
  );
  assert.equal(
    transcriptSearchSettingsInputSchema.safeParse({
      excludedSearchTerms: [".*"],
    }).success,
    false,
  );
  assert.equal(
    transcriptSearchSettingsInputSchema.safeParse({
      excludedSearchTerms: ["<script>alert(1)</script>"],
    }).success,
    false,
  );
  assert.equal(
    transcriptSearchSettingsInputSchema.safeParse({
      excludedSearchTerms: ["eins zwei drei vier fuenf sechs sieben acht neun zehn elf zwoelf dreizehn"],
    }).success,
    false,
  );
});

test("textarea input is line based and malformed legacy settings fail closed to no exclusions", () => {
  assert.deepEqual(
    transcriptSearchSettingsTextSchema.parse(" KI \r\n\r\nInterne Roadmap\nki"),
    ["interne roadmap", "ki"],
  );
  assert.deepEqual(sanitizeTranscriptSearchSettings(null), {
    excludedSearchTerms: [],
  });
  assert.deepEqual(
    sanitizeTranscriptSearchSettings({ excludedSearchTerms: ["KU\u0308NSTLICH"] }),
    { excludedSearchTerms: ["kunstlich"] },
  );
});
