import { PRIVACY_EXPORT_DOWNLOAD_MAX_DURATION_MS } from "@/lib/privacy/export-limits";

const DEFAULT_CHUNK_BYTES = 64 * 1024;

export function createPrivacyExportDownloadStream(input: {
  bytes: Uint8Array;
  release: () => Promise<void>;
  chunkBytes?: number;
  maxDurationMs?: number;
}) {
  const chunkBytes = input.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const maxDurationMs =
    input.maxDurationMs ?? PRIVACY_EXPORT_DOWNLOAD_MAX_DURATION_MS;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new TypeError("The privacy export response chunk size is invalid.");
  }
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs <= 0) {
    throw new TypeError("The privacy export response deadline is invalid.");
  }

  let source: Uint8Array | null = input.bytes;
  const release = input.release;
  let offset = 0;
  let releasePromise: Promise<void> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stopDeadline = () => {
    if (!deadline) return;
    clearTimeout(deadline);
    deadline = null;
  };
  const releaseOnce = () => {
    stopDeadline();
    source = null;
    releasePromise ??= Promise.resolve().then(release);
    return releasePromise;
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        deadline = setTimeout(() => {
          const error = new Error(
            "The privacy export response exceeded its total deadline.",
          );
          try {
            controller.error(error);
          } catch {
            // The response may already be closed or cancelled.
          }
          void releaseOnce().catch(() => undefined);
        }, maxDurationMs);
        deadline.unref?.();
      },
      async pull(controller) {
        if (!source) {
          controller.close();
          await releaseOnce();
          return;
        }
        const end = Math.min(source.byteLength, offset + chunkBytes);
        // Copy the slice so queued network chunks do not retain the complete
        // backing buffer after the source has closed.
        controller.enqueue(Uint8Array.from(source.subarray(offset, end)));
        offset = end;
        if (offset === source.byteLength) {
          source = null;
          controller.close();
          await releaseOnce();
        }
      },
      async cancel() {
        await releaseOnce();
      },
    },
    { highWaterMark: 0 },
  );

  return {
    stream,
    async abort(reason?: unknown) {
      try {
        streamController?.error(reason);
      } catch {
        // The stream may already be closed or cancelled.
      }
      await releaseOnce();
    },
  };
}
