import { NodeHttpHandler } from "@smithy/node-http-handler";

export const S3_CONNECTION_TIMEOUT_MS = 5_000;
export const S3_SOCKET_INACTIVITY_TIMEOUT_MS = 2 * 60_000;
export const S3_METADATA_DEADLINE_MS = 30_000;
export const S3_CLEANUP_COMMAND_DEADLINE_MS = 60_000;
export const S3_PREFLIGHT_COMMAND_DEADLINE_MS = 60_000;
export const S3_COPY_DEADLINE_MS = 10 * 60_000;
export const S3_HARD_DELETE_DEADLINE_MS = 10 * 60_000;
export const S3_SCAN_STREAM_DEADLINE_MS = 15 * 60_000;
export const S3_STREAM_CLOSE_MAX_WAIT_MS = 1_000;
export const S3_NODE_HTTP_HANDLER_OPTIONS = Object.freeze({
  connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
  socketTimeout: S3_SOCKET_INACTIVITY_TIMEOUT_MS,
  requestTimeout: S3_SCAN_STREAM_DEADLINE_MS,
  throwOnRequestTimeout: true,
});

export class S3OperationTimeoutError extends Error {
  readonly code = "s3_operation_timeout";

  constructor() {
    super("The S3 operation exceeded its deadline.");
    this.name = "S3OperationTimeoutError";
  }
}

export function createS3NodeHttpHandler() {
  return new NodeHttpHandler(S3_NODE_HTTP_HANDLER_OPTIONS);
}

function deadline(timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("The S3 operation deadline must be a positive integer.");
  }
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onTimeout: (() => void) | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new S3OperationTimeoutError();
      controller.abort(error);
      try {
        onTimeout?.();
      } finally {
        reject(error);
      }
    }, timeoutMs);
  });
  return {
    signal: controller.signal,
    race<T>(operation: Promise<T>) {
      return Promise.race([operation, expired]);
    },
    onTimeout(callback: () => void) {
      onTimeout = callback;
    },
    remainingMs() {
      return Math.max(0, expiresAt - Date.now());
    },
    complete() {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
    },
  };
}

async function returnIteratorBounded(
  iterator: AsyncIterator<Uint8Array>,
  remainingMs: number,
) {
  const completed = { done: true as const, value: undefined };
  let closing: Promise<IteratorResult<Uint8Array>> | undefined;
  try {
    const result = iterator.return?.();
    if (!result) return completed;
    closing = Promise.resolve(result);
  } catch {
    return completed;
  }
  if (remainingMs < 1) {
    void closing.catch(() => undefined);
    return completed;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closing.catch(() => completed),
      new Promise<typeof completed>((resolve) => {
        timer = setTimeout(
          () => resolve(completed),
          Math.min(remainingMs, S3_STREAM_CLOSE_MAX_WAIT_MS),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withS3OperationDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const state = deadline(timeoutMs);
  try {
    return await state.race(operation(state.signal));
  } finally {
    state.complete();
  }
}

function closeIterator(iterator: AsyncIterator<Uint8Array>) {
  try {
    const closing = iterator.return?.();
    if (closing) void Promise.resolve(closing).catch(() => undefined);
  } catch {
    // Cancellation is best effort and must not replace the timeout result.
  }
}

function destroyBody(body: AsyncIterable<Uint8Array>) {
  if ("destroy" in body && typeof body.destroy === "function") {
    try {
      body.destroy();
    } catch {
      // AbortSignal and iterator.return remain as independent cancellation paths.
    }
  }
}

export async function withS3StreamingOperationDeadline<T extends object>(
  timeoutMs: number,
  operation: (
    signal: AbortSignal,
  ) => Promise<T & { body: AsyncIterable<Uint8Array> }>,
): Promise<T & { body: AsyncIterable<Uint8Array> }> {
  const state = deadline(timeoutMs);
  let opened: T & { body: AsyncIterable<Uint8Array> };
  try {
    opened = await state.race(operation(state.signal));
  } catch (error) {
    state.complete();
    throw error;
  }
  const source = opened.body;
  const iterator = source[Symbol.asyncIterator]();
  let consumed = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    state.complete();
  };
  const cancel = () => {
    destroyBody(source);
    closeIterator(iterator);
  };
  state.onTimeout(cancel);
  const body: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      if (consumed) {
        throw new Error("The deadline-bound S3 stream can only be consumed once.");
      }
      consumed = true;
      return {
        async next() {
          try {
            const next = await state.race(iterator.next());
            if (next.done) close();
            return next;
          } catch (error) {
            cancel();
            close();
            throw error;
          }
        },
        async return() {
          try {
            return await returnIteratorBounded(iterator, state.remainingMs());
          } finally {
            destroyBody(source);
            close();
          }
        },
        async throw(error?: unknown) {
          try {
            if (iterator.throw) return await iterator.throw(error);
            throw error;
          } finally {
            destroyBody(source);
            close();
          }
        },
      };
    },
  };
  return { ...opened, body };
}
