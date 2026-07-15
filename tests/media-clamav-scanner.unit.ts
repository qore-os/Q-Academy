import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import test from "node:test";

import {
  MediaMalwareScanError,
  scanMediaStreamWithClamAv,
} from "../src/lib/media/clamav-scanner";

async function listeningServer(onConnection: (socket: Socket) => void) {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection?.(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return {
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("ClamAV scan deadline cancels a body iterator that never resolves", async () => {
  const { close, port } = await listeningServer(() => undefined);
  let returned = false;
  const body: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
        async return() {
          returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const started = Date.now();
  try {
    await assert.rejects(
      scanMediaStreamWithClamAv({
        configuration: { host: "127.0.0.1", port, required: true },
        body,
        expectedSizeBytes: 1,
        timeoutMs: 50,
      }),
      (error: unknown) =>
        error instanceof MediaMalwareScanError &&
        error.code === "scanner_unavailable",
    );
    assert.ok(Date.now() - started < 500);
    assert.equal(returned, true);
  } finally {
    await close();
  }
});

test("ClamAV socket errors interrupt a stalled body without waiting for timeout", async () => {
  const { close, port } = await listeningServer((socket) => {
    socket.once("data", () => socket.destroy());
  });
  const body: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
      };
    },
  };
  const started = Date.now();
  try {
    await assert.rejects(
      scanMediaStreamWithClamAv({
        configuration: { host: "127.0.0.1", port, required: true },
        body,
        expectedSizeBytes: 1,
        timeoutMs: 1_000,
      }),
      (error: unknown) =>
        error instanceof MediaMalwareScanError &&
        error.code === "scanner_unavailable",
    );
    assert.ok(Date.now() - started < 500);
  } finally {
    await close();
  }
});
