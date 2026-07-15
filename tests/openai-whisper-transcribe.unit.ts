import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  DEFAULT_OPENAI_API_KEY_FILE,
  OPENAI_API_BASE_URL,
  OPENAI_TRANSCRIPTIONS_URL,
  OPENAI_TRANSCRIPTION_MODEL,
  OpenAiTranscriptionError,
  mergeTranscriptChunks,
  parseFfmpegSegmentCsv,
  parseOpenAiTranscriptionArguments,
  readOpenAiApiKeyFile,
  redactedTranscriptionFailure,
  requestOpenAiTranscription,
  serializeTranscriptWebVtt,
  validateVerboseTranscriptionResponse,
  writeWebVttAtomically,
} from "../scripts/openai-whisper-transcribe-core";

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "q-academy-openai-stt-test-"));
}

function providerJson(
  body: unknown,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {},
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

test("OpenAI transcription CLI accepts only its bounded file-based contract", () => {
  const configuration = parseOpenAiTranscriptionArguments([
    "--input",
    "source.mp4",
    "--output-vtt",
    "transcript.vtt",
    "--language",
    "de-DE",
    "--temperature",
    "0",
  ]);
  assert.deepEqual(configuration, {
    mode: "transcribe",
    apiKeyFile: resolve(DEFAULT_OPENAI_API_KEY_FILE),
    inputPath: resolve("source.mp4"),
    outputVttPath: resolve("transcript.vtt"),
    language: "de-de",
    providerLanguage: "de",
    temperature: 0,
  });
  assert.deepEqual(
    parseOpenAiTranscriptionArguments([
      "--preflight",
      "--api-key-file",
      "provider.secret",
    ]),
    {
      mode: "preflight",
      apiKeyFile: resolve("provider.secret"),
      temperature: 0,
    },
  );
  assert.throws(
    () => parseOpenAiTranscriptionArguments(["--preflight", "--input", "secret"]),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "configuration_invalid",
  );
  assert.throws(
    () => parseOpenAiTranscriptionArguments(["--api-key", "must-not-be-accepted"]),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "configuration_invalid",
  );
});

test("the dedicated OpenAI credential is read from a private read-only file", async () => {
  const directory = await temporaryDirectory();
  const secretPath = join(directory, "openai.secret");
  try {
    await writeFile(secretPath, "sk-test-only-value\n", { mode: 0o400 });
    await chmod(secretPath, 0o400);
    assert.equal(await readOpenAiApiKeyFile(secretPath), "sk-test-only-value");
    if (process.platform !== "win32") {
      await chmod(secretPath, 0o600);
      await assert.rejects(
        readOpenAiApiKeyFile(secretPath),
        (error: unknown) =>
          error instanceof OpenAiTranscriptionError &&
          error.code === "secret_file_invalid",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("FFmpeg segment manifests are contiguous, deterministic and duration bounded", () => {
  assert.deepEqual(
    parseFfmpegSegmentCsv(
      [
        "chunk-0000.mp3,0.000000,1200.000000",
        '"chunk-0001.mp3",1200.000000,1201.250000',
        "",
      ].join("\n"),
    ),
    [
      {
        fileName: "chunk-0000.mp3",
        startSeconds: 0,
        endSeconds: 1200,
      },
      {
        fileName: "chunk-0001.mp3",
        startSeconds: 1200,
        endSeconds: 1201.25,
      },
    ],
  );
  assert.throws(
    () =>
      parseFfmpegSegmentCsv(
        "chunk-0000.mp3,0.000000,10.000000\nchunk-0002.mp3,10.000000,20.000000\n",
      ),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "audio_conversion_failed",
  );
  const oversizedManifest = Array.from({ length: 37 }, (_, index) => {
    const start = index * 1_200;
    const end = index === 36 ? 43_200.5 : start + 1_200;
    return `chunk-${String(index).padStart(4, "0")}.mp3,${start.toFixed(6)},${end.toFixed(6)}`;
  }).join("\n");
  assert.throws(
    () => parseFfmpegSegmentCsv(`${oversizedManifest}\n`),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "audio_duration_exceeded",
  );
});

test("verbose segment timestamps are validated, offset and serialized as bounded WebVTT", () => {
  const first = validateVerboseTranscriptionResponse(
    {
      duration: 10,
      segments: [{ start: 0.125, end: 2.5, text: " Hallo <Welt> & alle " }],
    },
    10,
  );
  const second = validateVerboseTranscriptionResponse(
    {
      duration: 5,
      segments: [{ start: 0.5, end: 1.25, text: "Weiter" }],
    },
    5,
  );
  const merged = mergeTranscriptChunks([
    {
      chunk: { path: "first.mp3", startSeconds: 0, endSeconds: 10 },
      transcript: first,
    },
    {
      chunk: { path: "second.mp3", startSeconds: 10, endSeconds: 15 },
      transcript: second,
    },
  ]);
  assert.deepEqual(merged, [
    {
      startMilliseconds: 125,
      endMilliseconds: 2_500,
      text: "Hallo <Welt> & alle",
    },
    {
      startMilliseconds: 10_500,
      endMilliseconds: 11_250,
      text: "Weiter",
    },
  ]);
  const webVtt = serializeTranscriptWebVtt(merged);
  assert.match(webVtt, /^WEBVTT\n\n1\n00:00:00\.125 --> 00:00:02\.500\n/);
  assert.match(webVtt, /Hallo &lt;Welt&gt; &amp; alle/);
  assert.match(webVtt, /00:00:10\.500 --> 00:00:11\.250/);
  assert.doesNotMatch(webVtt, /<Welt>/);
});

test("malformed provider schemas and timestamps fail closed", () => {
  for (const candidate of [
    { duration: "1", segments: [] },
    { duration: 1, segments: "none" },
    { duration: 1, segments: [{ start: -1, end: 1, text: "bad" }] },
    { duration: 1, segments: [{ start: 0.8, end: 0.7, text: "bad" }] },
  ]) {
    assert.throws(
      () => validateVerboseTranscriptionResponse(candidate, 1),
      (error: unknown) =>
        error instanceof OpenAiTranscriptionError &&
        error.code === "provider_response_invalid",
    );
  }
  assert.throws(
    () =>
      mergeTranscriptChunks([
        {
          chunk: { path: "silent.mp3", startSeconds: 0, endSeconds: 1 },
          transcript: { durationSeconds: 1, segments: [] },
        },
      ]),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "transcript_output_invalid",
  );
});

test("OpenAI upload uses the exact endpoint, fixed model and redirect-safe streamed form", async () => {
  const directory = await temporaryDirectory();
  const audioPath = join(directory, "chunk.mp3");
  const testCredential = "sk-test-never-log-this";
  let calls = 0;
  try {
    await writeFile(audioPath, Buffer.alloc(1_024, 0x31));
    const result = await requestOpenAiTranscription({
      apiKey: testCredential,
      audioPath,
      expectedDurationSeconds: 2,
      language: "de",
      temperature: 0,
      fetchImplementation: async (url, init) => {
        calls += 1;
        assert.equal(url, OPENAI_TRANSCRIPTIONS_URL);
        assert.equal(OPENAI_API_BASE_URL, "https://api.openai.com/v1");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        assert.ok(init?.signal instanceof AbortSignal);
        assert.equal(init.signal.aborted, false);
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), `Bearer ${testCredential}`);
        assert.match(headers.get("idempotency-key") ?? "", /^q-academy-stt-[a-f0-9]{64}$/);
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get("model"), OPENAI_TRANSCRIPTION_MODEL);
        assert.equal(init.body.get("response_format"), "verbose_json");
        assert.equal(init.body.get("timestamp_granularities[]"), "segment");
        assert.equal(init.body.get("language"), "de");
        assert.equal(init.body.get("temperature"), "0");
        const file = init.body.get("file");
        assert.ok(file instanceof Blob);
        assert.equal(file.size, 1_024);
        return providerJson({
          duration: 2,
          segments: [{ start: 0, end: 1, text: "Test" }],
        });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.segments[0]?.text, "Test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only 408, 429 and 5xx responses are retried with a capped Retry-After", async () => {
  const directory = await temporaryDirectory();
  const audioPath = join(directory, "chunk.mp3");
  const waits: number[] = [];
  let calls = 0;
  try {
    await writeFile(audioPath, Buffer.alloc(128, 0x32));
    const result = await requestOpenAiTranscription({
      apiKey: "sk-test-retry-value",
      audioPath,
      expectedDurationSeconds: 1,
      language: "en",
      temperature: 0,
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "999" },
          });
        }
        if (calls === 2) return new Response("", { status: 503 });
        return providerJson({
          duration: 1,
          segments: [{ start: 0, end: 0.5, text: "ready" }],
        });
      },
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    assert.equal(result.segments[0]?.text, "ready");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [10_000, 1_000]);

    calls = 0;
    await assert.rejects(
      requestOpenAiTranscription({
        apiKey: "sk-test-no-retry",
        audioPath,
        expectedDurationSeconds: 1,
        language: "en",
        temperature: 0,
        fetchImplementation: async () => {
          calls += 1;
          return new Response("", { status: 400 });
        },
        sleep: async () => assert.fail("A 400 response must not be retried."),
      }),
      (error: unknown) =>
        error instanceof OpenAiTranscriptionError &&
        error.code === "provider_request_rejected",
    );
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounded network failures and request timeouts retry at most three times", async () => {
  const directory = await temporaryDirectory();
  const audioPath = join(directory, "chunk.mp3");
  try {
    await writeFile(audioPath, Buffer.alloc(128, 0x34));
    let networkCalls = 0;
    const networkResult = await requestOpenAiTranscription({
      apiKey: "sk-test-network-retry",
      audioPath,
      expectedDurationSeconds: 1,
      language: "en",
      temperature: 0,
      fetchImplementation: async () => {
        networkCalls += 1;
        if (networkCalls < 3) throw new TypeError("simulated network failure");
        return providerJson({
          duration: 1,
          segments: [{ start: 0, end: 0.5, text: "recovered" }],
        });
      },
      sleep: async () => undefined,
    });
    assert.equal(networkCalls, 3);
    assert.equal(networkResult.segments[0]?.text, "recovered");

    let timeoutCalls = 0;
    await assert.rejects(
      requestOpenAiTranscription({
        apiKey: "sk-test-timeout-retry",
        audioPath,
        expectedDurationSeconds: 1,
        language: "en",
        temperature: 0,
        requestTimeoutMs: 5,
        fetchImplementation: async (_url, init) => {
          timeoutCalls += 1;
          assert.ok(init?.signal instanceof AbortSignal);
          return new Promise<Response>((_resolvePromise, reject) => {
            const rejectOnAbort = () => reject(init.signal?.reason);
            if (init.signal?.aborted) rejectOnAbort();
            else init.signal?.addEventListener("abort", rejectOnAbort, { once: true });
          });
        },
        sleep: async () => undefined,
      }),
      (error: unknown) =>
        error instanceof OpenAiTranscriptionError &&
        error.code === "provider_unavailable",
    );
    assert.equal(timeoutCalls, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inner FFmpeg remains in the outer media command process group", async () => {
  const source = await readFile(
    new URL("../scripts/openai-whisper-transcribe-core.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Keeping FFmpeg in it[\s\S]*detached: false/);
  assert.doesNotMatch(source, /process\.kill\(-/);
});

test("redirects, authentication failures and oversized responses have stable classes", async () => {
  const directory = await temporaryDirectory();
  const audioPath = join(directory, "chunk.mp3");
  try {
    await writeFile(audioPath, Buffer.alloc(128, 0x33));
    for (const [status, expectedCode] of [
      [302, "provider_redirect_rejected"],
      [401, "provider_authentication_failed"],
    ] as const) {
      let calls = 0;
      await assert.rejects(
        requestOpenAiTranscription({
          apiKey: "sk-test-status",
          audioPath,
          expectedDurationSeconds: 1,
          language: "en",
          temperature: 0,
          fetchImplementation: async () => {
            calls += 1;
            return new Response("", {
              status,
              headers: status === 302 ? { location: "https://invalid.example" } : {},
            });
          },
        }),
        (error: unknown) =>
          error instanceof OpenAiTranscriptionError &&
          error.code === expectedCode,
      );
      assert.equal(calls, 1);
    }

    await assert.rejects(
      requestOpenAiTranscription({
        apiKey: "sk-test-oversize",
        audioPath,
        expectedDurationSeconds: 1,
        language: "en",
        temperature: 0,
        fetchImplementation: async () =>
          new Response("{}", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(4 * 1_024 * 1_024 + 1),
            },
          }),
      }),
      (error: unknown) =>
        error instanceof OpenAiTranscriptionError &&
        error.code === "provider_response_oversize",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI failure records never expose provider or credential details", () => {
  const credential = "sk-test-must-stay-redacted";
  const providerDetail = `provider reflected ${credential}`;
  const known = JSON.stringify(
    redactedTranscriptionFailure(
      new OpenAiTranscriptionError("provider_authentication_failed", providerDetail),
    ),
  );
  const unknown = JSON.stringify(redactedTranscriptionFailure(new Error(providerDetail)));
  assert.equal(known, '{"ok":false,"code":"provider_authentication_failed"}');
  assert.equal(unknown, '{"ok":false,"code":"provider_unavailable"}');
  assert.doesNotMatch(`${known}${unknown}`, new RegExp(credential));
  assert.doesNotMatch(`${known}${unknown}`, /reflected/);
});

test("WebVTT publication replaces the destination atomically with private content", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "transcript.vtt");
  try {
    await writeFile(outputPath, "stale", { mode: 0o600 });
    const webVtt = serializeTranscriptWebVtt([
      {
        startMilliseconds: 0,
        endMilliseconds: 1_000,
        text: "Fertig",
      },
    ]);
    await writeWebVttAtomically(outputPath, webVtt);
    assert.equal(await readFile(outputPath, "utf8"), webVtt);
    if (process.platform !== "win32") {
      assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
