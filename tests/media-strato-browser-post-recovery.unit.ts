import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BrowserSingleUploadError,
  uploadStratoSinglePostWithRecovery,
} from "../src/lib/media/browser-single-post-recovery";
import {
  isMissingSessionMediaObject,
  isTransientSessionMediaCompletionFailure,
  SessionMediaRequestError,
} from "../src/lib/media/browser-session-upload";

const noDelay = async () => undefined;

test("a definite STRATO provider rejection remains the surfaced error", async () => {
  const controller = new AbortController();
  const providerError = new BrowserSingleUploadError(
    "Der Speicher lehnte den Upload ab (HTTP 403).",
    false,
  );
  let uploads = 0;
  let completions = 0;

  await assert.rejects(
    uploadStratoSinglePostWithRecovery({
      signal: controller.signal,
      upload: async () => {
        uploads += 1;
        throw providerError;
      },
      complete: async () => {
        completions += 1;
      },
      isObjectMissing: () => false,
      isTransientCompletionFailure:
        isTransientSessionMediaCompletionFailure,
      waitForRetry: noDelay,
    }),
    (error: unknown) => error === providerError,
  );
  assert.equal(uploads, 1);
  assert.equal(completions, 0);
});

test("an ambiguous STRATO POST is uploaded once while missing probes are bounded", async () => {
  const controller = new AbortController();
  const uploadError = new BrowserSingleUploadError(
    "ambiguous STRATO upload failure",
    true,
  );
  let uploads = 0;
  let completions = 0;
  let waits = 0;

  await assert.rejects(
    uploadStratoSinglePostWithRecovery({
      signal: controller.signal,
      upload: async () => {
        uploads += 1;
        throw uploadError;
      },
      complete: async () => {
        completions += 1;
        throw new SessionMediaRequestError(
          "The media object is missing.",
          409,
          "object_missing",
          undefined,
        );
      },
      isObjectMissing: isMissingSessionMediaObject,
      isTransientCompletionFailure:
        isTransientSessionMediaCompletionFailure,
      waitForRetry: async () => {
        waits += 1;
      },
    }),
    (error: unknown) => error === uploadError,
  );
  assert.equal(uploads, 1);
  assert.equal(completions, 3);
  assert.equal(waits, 2);
});

test("transient completion probes preserve the ambiguous STRATO upload failure", async () => {
  const probeErrors = [
    new SessionMediaRequestError(
      "Completion service unavailable.",
      503,
      "storage_unavailable",
      undefined,
    ),
    new SessionMediaRequestError(
      "Completion request timed out.",
      408,
      undefined,
      undefined,
    ),
    new TypeError("completion fetch failed"),
  ];

  for (const probeError of probeErrors) {
    const controller = new AbortController();
    const uploadError = new BrowserSingleUploadError(
      "ambiguous STRATO XHR failure",
      true,
    );
    let uploads = 0;
    let completions = 0;
    let waits = 0;

    await assert.rejects(
      uploadStratoSinglePostWithRecovery({
        signal: controller.signal,
        upload: async () => {
          uploads += 1;
          throw uploadError;
        },
        complete: async () => {
          completions += 1;
          throw probeError;
        },
        isObjectMissing: isMissingSessionMediaObject,
        isTransientCompletionFailure:
          isTransientSessionMediaCompletionFailure,
        waitForRetry: async () => {
          waits += 1;
        },
      }),
      (error: unknown) => error === uploadError,
    );
    assert.equal(uploads, 1);
    assert.equal(completions, 3);
    assert.equal(waits, 2);
  }
});

test("session completion exposes unavailable storage as a retryable service failure", () => {
  const service = readFileSync("src/lib/media/session-service.ts", "utf8");
  const start = service.indexOf(
    "export async function completeSessionMediaAsset",
  );
  const end = service.indexOf("\nexport async function ", start + 1);
  assert.ok(start >= 0 && end > start);
  const completion = service.slice(start, end);

  assert.match(
    completion,
    /error\.code === "storage_unavailable"[\s\S]*?503[\s\S]*?"internal_error"/,
  );
  assert.equal(
    isTransientSessionMediaCompletionFailure(
      new SessionMediaRequestError(
        "Completion service unavailable.",
        503,
        "storage_unavailable",
        undefined,
      ),
    ),
    true,
  );
});

test("a definitive completion rejection remains authoritative", async () => {
  const controller = new AbortController();
  const uploadError = new BrowserSingleUploadError(
    "ambiguous STRATO XHR failure",
    true,
  );
  const completionError = new SessionMediaRequestError(
    "Completion validation failed.",
    422,
    "object_mismatch",
    undefined,
  );

  await assert.rejects(
    uploadStratoSinglePostWithRecovery({
      signal: controller.signal,
      upload: async () => {
        throw uploadError;
      },
      complete: async () => {
        throw completionError;
      },
      isObjectMissing: isMissingSessionMediaObject,
      isTransientCompletionFailure:
        isTransientSessionMediaCompletionFailure,
      waitForRetry: noDelay,
    }),
    (error: unknown) => error === completionError,
  );
});

test("a transient missing object is recovered by probing without replaying the POST", async () => {
  const controller = new AbortController();
  let uploads = 0;
  const delays: number[] = [];
  let completions = 0;

  const result = await uploadStratoSinglePostWithRecovery({
    signal: controller.signal,
    upload: async () => {
      uploads += 1;
      throw new BrowserSingleUploadError("transient network failure", true);
    },
    complete: async () => {
      completions += 1;
      if (completions === 1) {
        throw new SessionMediaRequestError(
          "The media object is missing.",
          409,
          "object_missing",
          undefined,
        );
      }
    },
    isObjectMissing: isMissingSessionMediaObject,
    isTransientCompletionFailure: isTransientSessionMediaCompletionFailure,
    waitForRetry: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.deepEqual(result, { completionAttempts: 2, recovered: true });
  assert.equal(uploads, 1);
  assert.equal(completions, 2);
  assert.deepEqual(delays, [500]);
});

test("a stored STRATO object is recovered when XHR reports a failure", async () => {
  const controller = new AbortController();
  let uploads = 0;
  let completions = 0;
  let waits = 0;

  const result = await uploadStratoSinglePostWithRecovery({
    signal: controller.signal,
    upload: async () => {
      uploads += 1;
      throw new BrowserSingleUploadError("ambiguous CORS failure", true);
    },
    complete: async () => {
      completions += 1;
    },
    isObjectMissing: isMissingSessionMediaObject,
    isTransientCompletionFailure: isTransientSessionMediaCompletionFailure,
    waitForRetry: async () => {
      waits += 1;
    },
  });

  assert.deepEqual(result, { completionAttempts: 1, recovered: true });
  assert.equal(uploads, 1);
  assert.equal(completions, 1);
  assert.equal(waits, 0);
});

test("a successful STRATO POST retries a transiently missing object without replay", async () => {
  const controller = new AbortController();
  let uploads = 0;
  let completions = 0;
  const delays: number[] = [];

  const result = await uploadStratoSinglePostWithRecovery({
    signal: controller.signal,
    upload: async () => {
      uploads += 1;
    },
    complete: async () => {
      completions += 1;
      if (completions === 1) {
        throw new SessionMediaRequestError(
          "The media object is missing.",
          409,
          "object_missing",
          undefined,
        );
      }
    },
    isObjectMissing: isMissingSessionMediaObject,
    isTransientCompletionFailure: isTransientSessionMediaCompletionFailure,
    waitForRetry: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.deepEqual(result, { completionAttempts: 2, recovered: true });
  assert.equal(uploads, 1);
  assert.equal(completions, 2);
  assert.deepEqual(delays, [500]);
});

test("an aborted STRATO POST is never completed or retried", async () => {
  const controller = new AbortController();
  const abortError = new DOMException("Upload aborted", "AbortError");
  let uploads = 0;
  let completions = 0;
  let waits = 0;

  await assert.rejects(
    uploadStratoSinglePostWithRecovery({
      signal: controller.signal,
      upload: async () => {
        uploads += 1;
        throw abortError;
      },
      complete: async () => {
        completions += 1;
      },
      isObjectMissing: isMissingSessionMediaObject,
      isTransientCompletionFailure:
        isTransientSessionMediaCompletionFailure,
      waitForRetry: async () => {
        waits += 1;
      },
    }),
    (error: unknown) => error === abortError,
  );
  assert.equal(uploads, 1);
  assert.equal(completions, 0);
  assert.equal(waits, 0);
});
