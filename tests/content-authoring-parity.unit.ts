import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  exportWebVttTranscript,
  importWebVttTranscriptFile,
  MAX_WEB_VTT_FILE_BYTES,
  WebVttFileImportError,
  webVttExportFileName,
} from "../src/lib/content-blocks/transcript-file";
import { getCourseContentDefaults } from "../src/lib/i18n/course-content-defaults";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flattenKeys(value: unknown, prefix = "", keys: string[] = []) {
  if (Array.isArray(value)) {
    keys.push(prefix);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenKeys(child, prefix ? `${prefix}.${key}` : key, keys);
    }
    return keys;
  }
  keys.push(prefix);
  return keys;
}

function flattenStrings(value: unknown, result: string[] = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, result));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => flattenStrings(item, result));
  }
  return result;
}

test("new course content defaults have complete five-locale parity", () => {
  const german = getCourseContentDefaults("de");
  const germanKeys = flattenKeys(german);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = getCourseContentDefaults(locale);
    assert.deepEqual(flattenKeys(localized), germanKeys);
    assert.ok(flattenStrings(localized).every((value) => value.trim().length > 0));
    if (locale !== "de") {
      assert.notEqual(localized.paragraph, german.paragraph);
      assert.notEqual(localized.multipleChoice.prompt, german.multipleChoice.prompt);
      assert.notEqual(localized.submission.prompt, german.submission.prompt);
    }
  }

  const actionSource = readFileSync("src/lib/course-builder-actions.ts", "utf8");
  assert.match(actionSource, /getCourseContentDefaults\(locale\)/);
  for (const legacyDefault of [
    "Neue Ueberschrift",
    "Beschreibe hier den naechsten Lernimpuls.",
    "Welche Antwort ist richtig?",
    "Ergaenze den fehlenden Begriff.",
  ]) {
    assert.doesNotMatch(actionSource, new RegExp(legacyDefault.replace(/[.?]/g, "\\$&")));
  }
});

test("WebVTT files are bounded, strict UTF-8, parsed, and canonicalized", () => {
  const source = new TextEncoder().encode(
    "\uFEFFWEBVTT\r\n\r\n00:00:00.000 --> 00:00:02.000\r\n<v Instructor>Hello <b>world</b> &amp; <c.note>friends</c></v> &lt;5 <00:00:01.000>\r\n",
  );
  const imported = importWebVttTranscriptFile(source, "en-GB");
  assert.equal(imported.document.language, "en-gb");
  assert.deepEqual(imported.document.segments, [
    { startMs: 0, endMs: 2_000, text: "Hello world & friends <5" },
  ]);
  assert.match(imported.webVtt, /^WEBVTT\n\n1\n00:00:00\.000 --> 00:00:02\.000/);
  assert.match(imported.webVtt, /Hello world &amp; friends &lt;5/);

  assert.throws(
    () => importWebVttTranscriptFile(new Uint8Array(MAX_WEB_VTT_FILE_BYTES + 1), "en"),
    (error) => error instanceof WebVttFileImportError && error.code === "too_large",
  );
  assert.throws(
    () => importWebVttTranscriptFile(Uint8Array.from([0xc3, 0x28]), "en"),
    (error) => error instanceof WebVttFileImportError && error.code === "invalid_encoding",
  );
  assert.throws(
    () => importWebVttTranscriptFile(new TextEncoder().encode("not a transcript"), "en"),
    (error) => error instanceof WebVttFileImportError && error.code === "invalid_vtt",
  );
});

test("WebVTT export emits a safe file contract", () => {
  const transcript = {
    version: 1,
    language: "fr",
    segments: [{ startMs: 1_000, endMs: 2_500, text: "Bonjour" }],
  };
  const exported = exportWebVttTranscript(transcript);
  assert.ok(exported?.endsWith("\n"));
  assert.match(exported ?? "", /00:00:01\.000 --> 00:00:02\.500/);
  assert.equal(webVttExportFileName("EN_gb / unsafe"), "transcript-en-gb-unsafe.vtt");
  assert.equal(exportWebVttTranscript({ version: 1, segments: [] }), null);
});
