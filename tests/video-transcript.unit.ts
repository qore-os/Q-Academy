import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTranscriptTimestamp,
  parseWebVttTranscript,
  sanitizeVideoTranscriptDocument,
  searchVideoTranscript,
  serializeWebVttTranscript,
} from "../src/lib/content-blocks/video-transcript";
import { contentBlockCreateSchema } from "../src/lib/api/schemas";

const webVtt = `WEBVTT

intro
00:00:01.250 --> 00:00:04.500 align:start
Die Ausgangslage wird zuerst geklaert.

00:04.500 --> 00:08.000
Danach folgt das Qualitaetskriterium.
`;

test("WebVTT parsing, serialization and search preserve safe time cues", () => {
  const parsed = parseWebVttTranscript(webVtt, "de-DE");
  assert.ok(parsed);
  assert.equal(parsed.language, "de-de");
  assert.deepEqual(parsed.segments, [
    {
      startMs: 1_250,
      endMs: 4_500,
      text: "Die Ausgangslage wird zuerst geklaert.",
    },
    {
      startMs: 4_500,
      endMs: 8_000,
      text: "Danach folgt das Qualitaetskriterium.",
    },
  ]);
  assert.equal(
    searchVideoTranscript(parsed, "QUALITAET kriterium")[0]?.startMs,
    4_500,
  );
  assert.deepEqual(
    searchVideoTranscript(parsed, "QUALITAET kriterium", ["qualitaet"]),
    [],
  );
  assert.equal(
    searchVideoTranscript(parsed, "Qualitaetskriterium", ["qualitaet"])[0]
      ?.startMs,
    4_500,
  );
  assert.equal(formatTranscriptTimestamp(3_665_000), "1:01:05");

  const roundTrip = parseWebVttTranscript(serializeWebVttTranscript(parsed), "de-de");
  assert.deepEqual(roundTrip, parsed);
});

test("transcript sanitation removes cue markup and rejects invalid timing", () => {
  const sanitized = sanitizeVideoTranscriptDocument({
    version: 1,
    language: "not a language",
    segments: [
      { startMs: 2_000, endMs: 1_000, text: "Rueckwaerts" },
      {
        startMs: 0,
        endMs: 1_000,
        text: "<script>alert(1)</script> Sicher\u0000",
      },
      {
        startMs: 0,
        endMs: 1_000,
        text: "<script>alert(1)</script> Sicher\u0000",
      },
    ],
  });
  assert.ok(sanitized);
  assert.equal(sanitized.language, "de");
  assert.deepEqual(sanitized.segments, [
    { startMs: 0, endMs: 1_000, text: "alert(1) Sicher" },
  ]);

  assert.equal(
    parseWebVttTranscript(
      "WEBVTT\n\n00:00:05.000 --> 00:00:01.000\nUngueltig\n",
    ),
    null,
  );
});

test("REST video blocks normalize transcript documents and reject empty cues", () => {
  const valid = contentBlockCreateSchema.safeParse({
    type: "video",
    data: {
      videoUrl: "https://example.com/lesson.mp4",
      transcript: {
        version: 1,
        language: "de",
        segments: [
          {
            startMs: 0,
            endMs: 2_000,
            text: "<b>Ein sicherer Abschnitt</b>",
          },
        ],
      },
    },
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(
      valid.data.data.transcript?.segments[0]?.text,
      "Ein sicherer Abschnitt",
    );
  }
  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "video",
      data: {
        videoUrl: "https://example.com/lesson.mp4",
        transcript: { version: 1, language: "de", segments: [] },
      },
    }).success,
    false,
  );
});
