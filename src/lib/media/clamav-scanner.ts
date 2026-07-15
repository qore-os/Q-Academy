import { createConnection } from "node:net";

import {
  createClamAvChunkFrame,
  createClamAvEndFrame,
  parseClamAvResponse,
  type ClamAvScanResult,
} from "@/lib/media/clamav-protocol";
import type { ClamAvConfiguration } from "@/lib/media/storage-configuration";

const MAX_CLAMAV_RESPONSE_BYTES = 8 * 1024;
const DEFAULT_SCAN_TIMEOUT_MS = 10 * 60_000;

export class MediaMalwareScanError extends Error {
  readonly code: "invalid_size" | "scanner_unavailable" | "scanner_protocol";

  constructor(
    code: MediaMalwareScanError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MediaMalwareScanError";
    this.code = code;
  }
}

function writeSocket(socket: ReturnType<typeof createConnection>, data: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (error) => (error ? reject(error) : resolve()));
  });
}

class ScannerTransportFailure extends Error {}

export async function scanMediaStreamWithClamAv(input: {
  configuration: ClamAvConfiguration;
  body: AsyncIterable<Uint8Array>;
  expectedSizeBytes: number;
  timeoutMs?: number;
}): Promise<ClamAvScanResult> {
  if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0) {
    throw new MediaMalwareScanError(
      "invalid_size",
      "The media scan size is invalid.",
    );
  }

  const socket = createConnection({
    host: input.configuration.host,
    port: input.configuration.port,
  });
  socket.setNoDelay(true);
  const timeoutMs = input.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  const iterator = input.body[Symbol.asyncIterator]();
  let bodyFailure: unknown;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const closeIterator = () => {
    try {
      const closing = iterator.return?.();
      if (closing) void Promise.resolve(closing).catch(() => undefined);
    } catch {
      // Best-effort cancellation must not mask the scan result.
    }
  };

  try {
    const operation = async () => {
      let rejectTransport!: (error: ScannerTransportFailure) => void;
      const transportFailure = new Promise<never>((_resolve, reject) => {
        rejectTransport = reject;
      });
      socket.once("error", (error) => {
        rejectTransport(
          new ScannerTransportFailure("scanner socket error", { cause: error }),
        );
      });
      socket.once("close", () => {
        rejectTransport(
          new ScannerTransportFailure("scanner socket closed unexpectedly"),
        );
      });
      await Promise.race([
        new Promise<void>((resolve) => socket.once("connect", resolve)),
        transportFailure,
      ]);

      const response = new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let length = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks, length).toString("utf8"));
        };
        socket.on("data", (chunk: Buffer) => {
          length += chunk.byteLength;
          if (length > MAX_CLAMAV_RESPONSE_BYTES) {
            settled = true;
            reject(new ScannerTransportFailure("scanner response too large"));
            socket.destroy();
            return;
          }
          chunks.push(chunk);
          if (chunk.includes(0) || chunk.includes(0x0a)) finish();
        });
        socket.once("end", finish);
        socket.once("error", (error) => {
          if (!settled) reject(error);
        });
      });
      void response.catch(() => undefined);

      await writeSocket(socket, Buffer.from("zINSTREAM\0", "ascii")).catch(
        (error) => {
          throw new ScannerTransportFailure("scanner write failed", {
            cause: error,
          });
        },
      );
      let received = 0;
      while (true) {
        let next: IteratorResult<Uint8Array>;
        try {
          next = await Promise.race([iterator.next(), transportFailure]);
        } catch (error) {
          if (error instanceof ScannerTransportFailure) throw error;
          bodyFailure = error;
          throw error;
        }
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        if (!chunk.byteLength) continue;
        received += chunk.byteLength;
        if (received > input.expectedSizeBytes) {
          throw new MediaMalwareScanError(
            "invalid_size",
            "The media scan stream exceeds its expected size.",
          );
        }
        await writeSocket(socket, createClamAvChunkFrame(chunk)).catch(
          (error) => {
            throw new ScannerTransportFailure("scanner write failed", {
              cause: error,
            });
          },
        );
      }
      if (received !== input.expectedSizeBytes) {
        throw new MediaMalwareScanError(
          "invalid_size",
          "The media scan stream does not match its expected size.",
        );
      }
      await writeSocket(socket, createClamAvEndFrame()).catch((error) => {
        throw new ScannerTransportFailure("scanner write failed", {
          cause: error,
        });
      });
      const rawResponse = await Promise.race([response, transportFailure]);
      try {
        return parseClamAvResponse(rawResponse);
      } catch (error) {
        throw new MediaMalwareScanError(
          "scanner_protocol",
          "The malware scanner returned an invalid response.",
          error instanceof Error ? { cause: error } : undefined,
        );
      }
    };

    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        socket.destroy();
        closeIterator();
        reject(new ScannerTransportFailure("scan timeout"));
      }, timeoutMs);
      timeout.unref?.();
    });
    return await Promise.race([operation(), deadline]);
  } catch (error) {
    if (error === bodyFailure) throw error;
    if (error instanceof MediaMalwareScanError) throw error;
    throw new MediaMalwareScanError(
      "scanner_unavailable",
      "The malware scanner is unavailable.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    socket.destroy();
    closeIterator();
  }
}
