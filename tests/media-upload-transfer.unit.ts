import assert from "node:assert/strict";
import test from "node:test";

import {
  isTerminalSessionMediaUploadError,
  uploadBrowserSessionMedia,
  type DirectPostUploadResume,
  type BrowserSessionMediaAsset,
  type BrowserSessionTransferStatus,
} from "../src/lib/media/browser-session-upload";

type UploadAuthorization = {
  method: "PUT" | "POST";
  fields?: Record<string, string>;
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function problemResponse(status: number, reason: string) {
  return new Response(
    JSON.stringify({
      detail: "The media object is missing.",
      errors: { reason },
    }),
    {
      status,
      headers: { "content-type": "application/problem+json" },
    },
  );
}

function readyAsset(status: BrowserSessionMediaAsset["status"]) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    purpose: "course_content" as const,
    kind: "video" as const,
    status,
    originalFileName: "lesson.mp4",
    safeFileName: "lesson.mp4",
    declaredMimeType: "video/mp4",
    declaredSizeBytes: 8,
    actualSizeBytes: status === "ready" ? 8 : null,
    durationMilliseconds: null,
  };
}

async function runSingleUpload(
  authorization: UploadAuthorization,
  options: Readonly<{
    attempts?: number;
    missingCompletionAttempts?: number;
    lostClaimResponses?: number;
    completionFailureStatus?: number;
    completionFailureReason?: string;
    expireIntentOnRetry?: boolean;
    abortBeforeSendAttempts?: number;
    abortAfterSendAttempts?: number;
    discardResumeBeforeAttempt?: number;
    replaceResumeBeforeAttempt?: number;
    synchronousSendFailureAttempts?: number;
  }> = {},
) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalXhr = globalThis.XMLHttpRequest;
  const transferStatuses: BrowserSessionTransferStatus[] = [];
  const stages: string[] = [];
  const legacyProgress: number[] = [];
  const requests: Array<{
    method: string;
    headers: Array<[string, string]>;
    hasProgressListener: boolean;
  }> = [];
  let createRequests = 0;
  let claimRequests = 0;
  let claimedToken: string | null = null;
  let directPostResume: DirectPostUploadResume | null = null;
  const resumeChanges: Array<DirectPostUploadResume | null> = [];
  const claimTokens: string[] = [];
  let completionRequests = 0;
  const errors: unknown[] = [];
  let currentAttempt = 0;
  let activeController: AbortController | null = null;

  class FakeXmlHttpRequest {
    method = "";
    status = 204;
    timeout = 0;
    headers: Array<[string, string]> = [];
    upload: {
      onprogress?: (event: {
        lengthComputable: boolean;
        loaded: number;
        total: number;
      }) => void;
    } = {};
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;

    open(method: string) {
      this.method = method;
    }

    setRequestHeader(name: string, value: string) {
      this.headers.push([name, value]);
    }

    send() {
      if (currentAttempt <= (options.synchronousSendFailureAttempts ?? 0)) {
        throw new TypeError("xhr.send failed synchronously");
      }
      requests.push({
        method: this.method,
        headers: [...this.headers],
        hasProgressListener: Boolean(this.upload.onprogress),
      });
      if (currentAttempt <= (options.abortAfterSendAttempts ?? 0)) {
        activeController?.abort();
        return;
      }
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 4,
        total: 8,
      });
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 7_999,
        total: 8_000,
      });
      this.onload?.();
    }

    abort() {
      this.onabort?.();
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "https://academy.example.test" },
      setTimeout: (handler: () => void) => {
        queueMicrotask(handler);
        return 1;
      },
      clearTimeout: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: FakeXmlHttpRequest,
  });
  globalThis.fetch = (async (
    resource: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.href
          : resource.url;
    if (url === "/api/media-assets") {
      createRequests += 1;
      if (options.expireIntentOnRetry && createRequests > 1) {
        return problemResponse(409, "upload_expired");
      }
      if (authorization.method === "POST") {
        return jsonResponse({
          ...readyAsset("pending"),
          statusUrl: "/status",
          completeUrl: "/complete",
          completionTransport: "direct-post",
          directPostClaimUrl: "/claim",
          directPostClaimState: claimedToken ? "claimed" : "available",
          upload: null,
        });
      }
      return jsonResponse({
        ...readyAsset("pending"),
        statusUrl: "/status",
        completeUrl: "/complete",
        upload: {
          transport: "s3",
          method: authorization.method,
          url: "https://storage.example.test/upload",
          headers:
            authorization.method === "PUT"
              ? { "content-type": "video/mp4" }
              : undefined,
          fields: authorization.fields,
        },
      });
    }
    if (url === "/claim") {
      claimRequests += 1;
      const body = JSON.parse(String(init?.body)) as { claimToken: string };
      claimTokens.push(body.claimToken);
      if (!claimedToken) claimedToken = body.claimToken;
      const state =
        body.claimToken === claimedToken
          ? "send_authorized"
          : "completion_pending";
      if (claimRequests <= (options.lostClaimResponses ?? 0)) {
        throw new TypeError("The committed response was lost.");
      }
      if (currentAttempt <= (options.abortBeforeSendAttempts ?? 0)) {
        activeController?.abort();
      }
      return jsonResponse(
        state === "send_authorized"
          ? {
              state,
              upload: {
                transport: "s3",
                method: "POST",
                url: "https://storage.example.test/upload",
                fields: authorization.fields,
              },
            }
          : { state },
      );
    }
    if (url === "/complete") {
      completionRequests += 1;
      if (completionRequests <= (options.missingCompletionAttempts ?? 0)) {
        return problemResponse(
          options.completionFailureStatus ?? 409,
          options.completionFailureReason ?? "object_missing",
        );
      }
      return jsonResponse({ completed: true });
    }
    if (url === "/status") return jsonResponse(readyAsset("ready"));
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    for (let attempt = 0; attempt < (options.attempts ?? 1); attempt += 1) {
      currentAttempt = attempt + 1;
      if (currentAttempt === options.discardResumeBeforeAttempt) {
        directPostResume = null;
      }
      if (currentAttempt === options.replaceResumeBeforeAttempt) {
        directPostResume = { claimToken: crypto.randomUUID() };
      }
      try {
        const controller = new AbortController();
        activeController = controller;
        await uploadBrowserSessionMedia({
          file: new File([new Uint8Array(8)], "lesson.mp4", {
            type: "video/mp4",
          }),
          purpose: "course_content",
          clientUploadId: "20000000-0000-4000-8000-000000000002",
          directPostResume,
          onDirectPostResumeChange: (resume) => {
            directPostResume = resume;
            resumeChanges.push(resume);
          },
          signal: controller.signal,
          onProgress: (progress) => legacyProgress.push(progress),
          onTransferStatus: (status) => transferStatuses.push(status),
          onStage: (stage) => stages.push(stage),
        });
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      value: originalXhr,
    });
  }

  return {
    claimRequests,
    claimTokens,
    completionRequests,
    createRequests,
    errors,
    legacyProgress,
    requests,
    resumeChanges,
    stages,
    transferStatuses,
  };
}

test("single PUT uploads reserve 100 percent for successful completion", async () => {
  const result = await runSingleUpload({ method: "PUT" });

  assert.deepEqual(result.transferStatuses, [
    { kind: "determinate", transport: "single-put", progress: 0 },
    { kind: "determinate", transport: "single-put", progress: 50 },
    { kind: "determinate", transport: "single-put", progress: 99 },
    { kind: "determinate", transport: "single-put", progress: 100 },
  ]);
  assert.deepEqual(result.legacyProgress, [50, 99, 100, 100]);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.hasProgressListener, true);
  assert.ok((result.requests[0]?.headers.length ?? 0) > 0);
});

test("direct POST uploads stay indeterminate and preserve the no-preflight request", async () => {
  const result = await runSingleUpload({
    method: "POST",
    fields: { key: "staging/video" },
  });

  assert.deepEqual(result.transferStatuses, [
    { kind: "indeterminate", transport: "direct-post" },
  ]);
  assert.deepEqual(result.legacyProgress, [0, 100, 100]);
  assert.deepEqual(result.requests, [
    { method: "POST", headers: [], hasProgressListener: false },
  ]);
  assert.equal(result.claimRequests, 1);
  assert.deepEqual(result.stages, ["preparing", "uploading", "processing"]);
});

test("a visible direct POST retry resumes completion without replaying the file", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    {
      attempts: 2,
      missingCompletionAttempts: 3,
    },
  );

  assert.equal(result.errors.length, 1);
  assert.equal(result.createRequests, 2);
  assert.equal(result.claimRequests, 1);
  assert.equal(result.completionRequests, 4);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.method, "POST");
});

test("a lost claim response reuses its token internally without replaying the POST", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    {
      attempts: 2,
      lostClaimResponses: 1,
      missingCompletionAttempts: 3,
    },
  );

  assert.equal(result.errors.length, 1);
  assert.equal(result.claimRequests, 2);
  assert.equal(result.claimTokens[0], result.claimTokens[1]);
  assert.equal(result.requests.length, 1);
  assert.equal(result.completionRequests, 4);
});

test("all lost claim responses preserve the cursor for one visible-retry POST", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    { attempts: 2, lostClaimResponses: 4 },
  );

  assert.equal(result.errors.length, 1);
  assert.equal(result.claimRequests, 5);
  assert.equal(new Set(result.claimTokens).size, 1);
  assert.equal(result.requests.length, 1);
  assert.equal(result.resumeChanges.at(-1), null);
});

test("an abort before send preserves the claim cursor for one later POST", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    { attempts: 2, abortBeforeSendAttempts: 1 },
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.claimRequests, 2);
  assert.equal(new Set(result.claimTokens).size, 1);
  assert.equal(result.requests.length, 1);
});

test("an abort after send clears the cursor and never replays the POST", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    { attempts: 2, abortAfterSendAttempts: 1 },
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.claimRequests, 1);
  assert.equal(result.requests.length, 1);
});

test("a synchronous send failure restores the claim cursor for one later POST", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    { attempts: 2, synchronousSendFailureAttempts: 1 },
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.claimRequests, 2);
  assert.equal(new Set(result.claimTokens).size, 1);
  assert.equal(result.requests.length, 1);
});

test("a lost or foreign claim cursor cannot obtain another POST authorization", async () => {
  for (const replacement of ["discard", "foreign"] as const) {
    const result = await runSingleUpload(
      { method: "POST", fields: { key: "staging/video" } },
      {
        attempts: 2,
        lostClaimResponses: 4,
        missingCompletionAttempts: 3,
        ...(replacement === "discard"
          ? { discardResumeBeforeAttempt: 2 }
          : { replaceResumeBeforeAttempt: 2 }),
      },
    );
    assert.equal(result.requests.length, 0);
  }
});

test("exhausted transient completion-only retries remain safe without replay", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    {
      attempts: 3,
      missingCompletionAttempts: 6,
      completionFailureStatus: 503,
      completionFailureReason: "storage_unavailable",
    },
  );

  assert.equal(result.errors.length, 2);
  assert.equal(isTerminalSessionMediaUploadError(result.errors[0]), false);
  assert.equal(isTerminalSessionMediaUploadError(result.errors[1]), false);
  assert.equal(result.requests.length, 1);
  assert.equal(result.completionRequests, 7);
});

test("an expired claimed intent is terminal after the one permitted POST", async () => {
  const result = await runSingleUpload(
    { method: "POST", fields: { key: "staging/video" } },
    {
      attempts: 2,
      expireIntentOnRetry: true,
      missingCompletionAttempts: 3,
    },
  );

  assert.equal(result.errors.length, 2);
  assert.equal(isTerminalSessionMediaUploadError(result.errors[0]), false);
  assert.equal(isTerminalSessionMediaUploadError(result.errors[1]), true);
  assert.equal(result.requests.length, 1);
});

test("completion claim races remain retryable without replaying the POST", async () => {
  for (const reason of [
    "completion_in_progress",
    "completion_claim_lost",
  ]) {
    const result = await runSingleUpload(
      { method: "POST", fields: { key: "staging/video" } },
      {
        attempts: 3,
        missingCompletionAttempts: 6,
        completionFailureStatus: 409,
        completionFailureReason: reason,
      },
    );
    assert.equal(result.errors.length, 2);
    assert.equal(isTerminalSessionMediaUploadError(result.errors[1]), false);
    assert.equal(result.requests.length, 1);
  }
});
