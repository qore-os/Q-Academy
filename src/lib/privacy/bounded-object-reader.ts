import { open } from "node:fs/promises";

export class BoundedObjectReadError extends Error {
  constructor(
    public readonly code:
      | "invalid_body"
      | "invalid_chunk"
      | "invalid_size"
      | "timeout",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BoundedObjectReadError";
  }
}

type BodyWithLifecycle = {
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  cancel?: (reason?: unknown) => unknown;
  destroy?: () => unknown;
  getReader?: () => {
    read: () => Promise<ReadableStreamReadResult<unknown>>;
    cancel: (reason?: unknown) => Promise<void>;
    releaseLock: () => void;
  };
};

function ignoreSettlement(value: unknown) {
  if (value && typeof (value as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(value).catch(() => undefined);
  }
}

export function disposeObjectBody(
  body: unknown,
  iterator?: AsyncIterator<unknown>,
  reason?: unknown,
) {
  const lifecycle = body as BodyWithLifecycle | null;
  try {
    lifecycle?.destroy?.();
  } catch {
    // Best-effort disposal must not replace the bounded-read failure.
  }
  try {
    ignoreSettlement(iterator?.return?.());
  } catch {
    // Best-effort disposal must not replace the bounded-read failure.
  }
  try {
    ignoreSettlement(lifecycle?.cancel?.(reason));
  } catch {
    // Best-effort disposal must not replace the bounded-read failure.
  }
}

function asyncIterator(body: unknown): AsyncIterator<unknown> {
  const lifecycle = body as BodyWithLifecycle | null;
  const iteratorFactory = lifecycle?.[Symbol.asyncIterator];
  if (typeof iteratorFactory === "function") {
    return iteratorFactory.call(lifecycle);
  }
  const getReader = lifecycle?.getReader;
  if (typeof getReader === "function") {
    const reader = getReader.call(lifecycle);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reader.releaseLock();
    };
    return {
      next: async () => {
        const result = await reader.read();
        if (result.done) release();
        return result;
      },
      return: async () => {
        await reader.cancel().catch(() => undefined);
        release();
        return { done: true, value: undefined };
      },
    };
  }
  throw new BoundedObjectReadError(
    "invalid_body",
    "The object body is not a supported streaming body.",
  );
}

function chunkBuffer(value: unknown) {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new BoundedObjectReadError(
    "invalid_chunk",
    "The object body yielded an invalid chunk.",
  );
}

export async function beforeDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new BoundedObjectReadError(
      "timeout",
      "The object read exceeded its total deadline.",
    );
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new BoundedObjectReadError(
                "timeout",
                "The object read exceeded its total deadline.",
              ),
            ),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function readBoundedObjectBody(input: {
  body: unknown;
  maxBytes: number;
  expectedBytes: number;
  deadlineAt: number;
  abortController?: AbortController;
}) {
  if (
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes <= 0 ||
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes <= 0 ||
    input.expectedBytes > input.maxBytes
  ) {
    throw new BoundedObjectReadError(
      "invalid_size",
      "The object read bounds are invalid.",
    );
  }

  const iterator = asyncIterator(input.body);
  const output = Buffer.allocUnsafe(input.expectedBytes);
  let received = 0;
  try {
    while (true) {
      const item = await beforeDeadline(iterator.next(), input.deadlineAt);
      if (item.done) break;
      const chunk = chunkBuffer(item.value);
      if (
        chunk.byteLength > input.maxBytes - received ||
        chunk.byteLength > input.expectedBytes - received
      ) {
        throw new BoundedObjectReadError(
          "invalid_size",
          "The object body exceeds its declared or configured size.",
        );
      }
      chunk.copy(output, received);
      received += chunk.byteLength;
    }
    if (received !== input.expectedBytes) {
      throw new BoundedObjectReadError(
        "invalid_size",
        "The object body does not match its declared size.",
      );
    }
    return output;
  } catch (error) {
    input.abortController?.abort(error);
    disposeObjectBody(input.body, iterator, error);
    throw error;
  }
}

type BoundedFileHandle = {
  stat: () => Promise<{
    isFile: () => boolean;
    size: number;
    dev: number | bigint;
    ino: number | bigint;
  }>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
};

export async function readBoundedFileHandle(input: {
  handle: BoundedFileHandle;
  maxBytes: number;
  deadlineAt: number;
}) {
  const stats = await beforeDeadline(input.handle.stat(), input.deadlineAt);
  if (
    !stats.isFile() ||
    !Number.isSafeInteger(stats.size) ||
    stats.size <= 0 ||
    stats.size > input.maxBytes
  ) {
    throw new BoundedObjectReadError(
      "invalid_size",
      "The local object has an invalid size.",
    );
  }
  const output = Buffer.allocUnsafe(stats.size);
  let offset = 0;
  while (offset < output.byteLength) {
    const result = await beforeDeadline(
      input.handle.read(output, offset, output.byteLength - offset, offset),
      input.deadlineAt,
    );
    if (result.bytesRead === 0) {
      throw new BoundedObjectReadError(
        "invalid_size",
        "The local object was truncated while it was read.",
      );
    }
    offset += result.bytesRead;
  }
  const probe = Buffer.allocUnsafe(1);
  const afterContent = await beforeDeadline(
    input.handle.read(probe, 0, 1, stats.size),
    input.deadlineAt,
  );
  const finalStats = await beforeDeadline(
    input.handle.stat(),
    input.deadlineAt,
  );
  if (
    afterContent.bytesRead !== 0 ||
    !finalStats.isFile() ||
    finalStats.dev !== stats.dev ||
    finalStats.ino !== stats.ino ||
    finalStats.size !== stats.size
  ) {
    throw new BoundedObjectReadError(
      "invalid_size",
      "The local object changed while it was read.",
    );
  }
  return output;
}

export async function readBoundedFile(input: {
  path: string;
  maxBytes: number;
  deadlineAt: number;
}) {
  const handle = await open(input.path, "r");
  try {
    return await readBoundedFileHandle({
      handle,
      maxBytes: input.maxBytes,
      deadlineAt: input.deadlineAt,
    });
  } finally {
    await handle.close().catch(() => undefined);
  }
}
