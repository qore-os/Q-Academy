import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readBoundedProviderJson } from "../src/lib/ai/bounded-provider-response";

import {
  MAX_GENERATED_VIDEO_DESCRIPTION_CHARACTERS,
  sanitizeGeneratedVideoDescription,
} from "../src/lib/ai/video-description-output";

test("generated video descriptions are capped at the prompted character limit", () => {
  const description = sanitizeGeneratedVideoDescription("x".repeat(5_000));
  assert.equal(
    Array.from(description).length,
    MAX_GENERATED_VIDEO_DESCRIPTION_CHARACTERS,
  );
});

test("generated descriptions normalize control characters and outer quotes", () => {
  assert.equal(
    sanitizeGeneratedVideoDescription('  "Ein\u0000  kurzer Text."  '),
    "Ein kurzer Text.",
  );
});

test("video description provider caps declared and chunked JSON responses", async () => {
  let cancelled = false;
  const declared = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { status: 200, headers: { "content-length": "262145" } },
  );
  await assert.rejects(readBoundedProviderJson(declared, 262_144), /bounded size/);
  assert.equal(cancelled, true);

  let pullCount = 0;
  let chunkedCancelled = false;
  const chunked = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(140_000));
      },
      cancel() {
        chunkedCancelled = true;
      },
    }),
    { status: 200 },
  );
  await assert.rejects(readBoundedProviderJson(chunked, 262_144), /bounded size/);
  assert.equal(chunkedCancelled, true);
  assert.ok(pullCount <= 3);
});

test("video descriptions use the shared bounded completion controls", () => {
  const provider = readFileSync(
    new URL("../src/lib/ai/video-description-provider.ts", import.meta.url),
    "utf8",
  );
  assert.match(provider, /const MAX_COMPLETION_TOKENS = 350;/);
  assert.match(
    provider,
    /aiChatCompletionControls\(model,\s*MAX_COMPLETION_TOKENS\)/,
  );
});
