import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createS3NodeHttpHandler,
  S3_CONNECTION_TIMEOUT_MS,
  S3_NODE_HTTP_HANDLER_OPTIONS,
  S3_SCAN_STREAM_DEADLINE_MS,
  S3_SOCKET_INACTIVITY_TIMEOUT_MS,
  S3_STREAM_CLOSE_MAX_WAIT_MS,
  S3OperationTimeoutError,
  withS3OperationDeadline,
  withS3StreamingOperationDeadline,
} from "../src/lib/media/s3-operation-timeout";

test("S3 transport has finite connection, inactivity, and request timeouts", () => {
  const handler = createS3NodeHttpHandler();
  assert.equal(
    S3_NODE_HTTP_HANDLER_OPTIONS.connectionTimeout,
    S3_CONNECTION_TIMEOUT_MS,
  );
  assert.equal(
    S3_NODE_HTTP_HANDLER_OPTIONS.socketTimeout,
    S3_SOCKET_INACTIVITY_TIMEOUT_MS,
  );
  assert.equal(
    S3_NODE_HTTP_HANDLER_OPTIONS.requestTimeout,
    S3_SCAN_STREAM_DEADLINE_MS,
  );
  assert.equal(S3_NODE_HTTP_HANDLER_OPTIONS.throwOnRequestTimeout, true);
  assert.ok(S3_SCAN_STREAM_DEADLINE_MS >= 10 * 60_000);
  assert.ok(S3_SCAN_STREAM_DEADLINE_MS <= 30 * 60_000);
  handler.destroy();
});

test("a never-resolving S3 operation is aborted at its total deadline", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(
    withS3OperationDeadline(25, (operationSignal) => {
      signal = operationSignal;
      return new Promise<never>(() => undefined);
    }),
    S3OperationTimeoutError,
  );
  assert.equal(signal?.aborted, true);
  assert.ok(signal?.reason instanceof S3OperationTimeoutError);
});

test("a stalled S3 body iterator is destroyed and returned on timeout", async () => {
  let signal: AbortSignal | undefined;
  let returned = false;
  let destroyed = false;
  const source = {
    destroy() {
      destroyed = true;
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          return new Promise<IteratorResult<Uint8Array>>(() => undefined);
        },
        async return() {
          returned = true;
          return { done: true as const, value: undefined };
        },
      };
    },
  };
  const opened = await withS3StreamingOperationDeadline(
    25,
    async (operationSignal) => {
      signal = operationSignal;
      return { body: source };
    },
  );
  const iterator = opened.body[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), S3OperationTimeoutError);
  assert.equal(signal?.aborted, true);
  assert.equal(destroyed, true);
  assert.equal(returned, true);
});

test("a fully consumed S3 stream clears its deadline without aborting", async () => {
  let signal: AbortSignal | undefined;
  const opened = await withS3StreamingOperationDeadline(
    25,
    async (operationSignal) => {
      signal = operationSignal;
      return {
        body: (async function* () {
          yield new Uint8Array([1, 2, 3]);
        })(),
      };
    },
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of opened.body) chunks.push(chunk);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(chunks, [new Uint8Array([1, 2, 3])]);
  assert.equal(signal?.aborted, false);
});

test("iterator return is bounded by the remaining stream deadline", async () => {
  let destroyed = false;
  const source = {
    destroy() {
      destroyed = true;
    },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: false as const, value: new Uint8Array([1]) };
        },
        return() {
          return new Promise<IteratorResult<Uint8Array>>(() => undefined);
        },
      };
    },
  };
  const opened = await withS3StreamingOperationDeadline(30, async () => ({
    body: source,
  }));
  const iterator = opened.body[Symbol.asyncIterator]();
  const startedAt = Date.now();
  const result = await iterator.return?.();
  const elapsed = Date.now() - startedAt;

  assert.equal(result?.done, true);
  assert.equal(destroyed, true);
  assert.ok(elapsed < S3_STREAM_CLOSE_MAX_WAIT_MS);
});
