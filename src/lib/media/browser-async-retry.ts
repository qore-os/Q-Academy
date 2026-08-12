export const TRANSCRIPT_POLLING_MAXIMUM_MS = 2 * 60 * 60 * 1_000;

export function waitForAbortableDelay(
  delayMs: number,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
