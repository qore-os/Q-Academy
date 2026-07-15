import assert from "node:assert/strict";
import test from "node:test";

import { readLimitedRequestText } from "../src/lib/limited-request-body";

test("limited request reader accepts a body without Content-Length", async () => {
  const request = new Request("https://example.test/internal", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"query":"ki"}'));
        controller.close();
      },
    }),
    // Required by Node when a request streams its body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(request.headers.has("content-length"), false);
  assert.deepEqual(await readLimitedRequestText(request, 64), {
    ok: true,
    text: '{"query":"ki"}',
    byteLength: 14,
  });
});

test("limited request reader cancels an oversized streamed body", async () => {
  let cancelled = false;
  const request = new Request("https://example.test/internal", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(33).fill(65));
      },
      cancel() {
        cancelled = true;
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.deepEqual(await readLimitedRequestText(request, 32), {
    ok: false,
    reason: "too_large",
  });
  assert.equal(cancelled, true);
});
