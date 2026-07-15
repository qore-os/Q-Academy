import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BoundedJsonRequestError,
  parseBoundedJsonRequest,
  readBoundedRequestBody,
} from "../src/lib/bounded-json-request";

type StreamRequest = {
  request: Request;
  cancelled: () => boolean;
  pulls: () => number;
};

function streamRequest(
  chunks: Uint8Array[],
  headers?: HeadersInit,
): StreamRequest {
  let index = 0;
  let wasCancelled = false;
  let pullCount = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      const chunk = chunks[index];
      index += 1;
      if (chunk) controller.enqueue(chunk);
      if (index >= chunks.length) controller.close();
    },
    cancel() {
      wasCancelled = true;
    },
  });
  const request = new Request("https://academy.example.test/api", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return {
    request,
    cancelled: () => wasCancelled,
    pulls: () => pullCount,
  };
}

async function rejectsWithReason(
  operation: () => Promise<unknown>,
  reason: BoundedJsonRequestError["reason"],
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof BoundedJsonRequestError);
    assert.equal(error.reason, reason);
    return true;
  });
}

test("bounded JSON reader reuses one streamed body for hashing and parsing", async () => {
  const encoded = new TextEncoder().encode('{"query":"ki"}');
  const streamed = streamRequest([encoded]);

  const body = await readBoundedRequestBody(streamed.request, { maxBytes: 64 });
  assert.deepEqual(body, {
    text: '{"query":"ki"}',
    byteLength: encoded.byteLength,
    hasBody: true,
  });
  const pullsAfterRead = streamed.pulls();
  assert.deepEqual(
    await parseBoundedJsonRequest(streamed.request, { maxBytes: 64 }),
    { query: "ki" },
  );
  assert.equal(streamed.pulls(), pullsAfterRead);
});

test("oversized Content-Length is rejected before the request body is read", async () => {
  const streamed = streamRequest(
    [new TextEncoder().encode('{"query":"ki"}')],
    { "Content-Length": "65" },
  );

  await rejectsWithReason(
    () => readBoundedRequestBody(streamed.request, { maxBytes: 64 }),
    "too_large",
  );
  assert.equal(streamed.request.bodyUsed, false);
  assert.equal(streamed.cancelled(), false);
});

test("oversized chunked bodies are cancelled at the configured byte limit", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(20).fill(65));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://academy.example.test/api", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await rejectsWithReason(
    () => readBoundedRequestBody(request, { maxBytes: 32 }),
    "too_large",
  );
  assert.equal(cancelled, true);
});

test("cached request bodies still honor a stricter subsequent limit", async () => {
  const streamed = streamRequest([
    new TextEncoder().encode('{"query":"ki"}'),
  ]);
  await readBoundedRequestBody(streamed.request, { maxBytes: 64 });
  const pullsAfterRead = streamed.pulls();

  await rejectsWithReason(
    () => readBoundedRequestBody(streamed.request, { maxBytes: 8 }),
    "too_large",
  );
  assert.equal(streamed.pulls(), pullsAfterRead);
});

test("bounded JSON reader rejects malformed JSON and invalid UTF-8", async () => {
  const malformed = streamRequest([new TextEncoder().encode("{")]);
  await rejectsWithReason(
    () => parseBoundedJsonRequest(malformed.request, { maxBytes: 16 }),
    "invalid_json",
  );

  const invalidUtf8 = streamRequest([new Uint8Array([0xc3, 0x28])]);
  await rejectsWithReason(
    () => parseBoundedJsonRequest(invalidUtf8.request, { maxBytes: 16 }),
    "invalid_json",
  );
});

test("anonymous, API, and AI JSON paths use the bounded reader without clones", () => {
  for (const file of [
    "src/app/api/v1/password/forgot/route.ts",
    "src/app/api/v1/password/reset/route.ts",
    "src/app/api/ai/route.ts",
    "src/lib/api/handler.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /parseBoundedJsonRequest/, file);
    assert.doesNotMatch(source, /request\.json\(\)/, file);
    assert.doesNotMatch(source, /request\.clone\(\)\.text\(\)/, file);
  }
});
