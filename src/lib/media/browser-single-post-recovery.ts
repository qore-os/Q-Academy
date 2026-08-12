export class BrowserSingleUploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrowserSingleUploadError";
  }
}

const STRATO_COMPLETION_PROBE_DELAYS_MS = [500, 1_500] as const;

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function uploadStratoSinglePostWithRecovery(input: {
  signal: AbortSignal;
  upload: () => Promise<void>;
  complete: () => Promise<void>;
  isObjectMissing: (error: unknown) => boolean;
  isTransientCompletionFailure: (error: unknown) => boolean;
  waitForRetry: (delayMs: number, signal: AbortSignal) => Promise<void>;
}) {
  let uploadError: BrowserSingleUploadError | undefined;
  try {
    await input.upload();
  } catch (error) {
    if (isAbortError(error)) throw error;
    input.signal.throwIfAborted();
    if (
      !(error instanceof BrowserSingleUploadError) ||
      !error.retryable
    ) {
      throw error;
    }
    uploadError = error;
  }

  const maximumCompletionAttempts = STRATO_COMPLETION_PROBE_DELAYS_MS.length + 1;
  for (
    let completionAttempt = 1;
    completionAttempt <= maximumCompletionAttempts;
    completionAttempt += 1
  ) {
    try {
      await input.complete();
      return {
        completionAttempts: completionAttempt,
        recovered: Boolean(uploadError) || completionAttempt > 1,
      };
    } catch (completionError) {
      if (isAbortError(completionError)) throw completionError;
      input.signal.throwIfAborted();
      if (
        !input.isObjectMissing(completionError) &&
        !input.isTransientCompletionFailure(completionError)
      ) {
        throw completionError;
      }
      if (completionAttempt === maximumCompletionAttempts) {
        throw uploadError ?? completionError;
      }
    }

    await input.waitForRetry(
      STRATO_COMPLETION_PROBE_DELAYS_MS[completionAttempt - 1]!,
      input.signal,
    );
  }
  throw uploadError ?? new Error("STRATO completion retry exhausted.");
}
