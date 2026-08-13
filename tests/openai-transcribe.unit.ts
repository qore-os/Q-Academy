import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  DEFAULT_OPENAI_API_KEY_FILE,
  OPENAI_API_BASE_URL,
  OPENAI_TRANSCRIPTIONS_URL,
  OpenAiTranscriptionError,
  mergeTranscriptChunks,
  openAiTranscriptionRequestDigest,
  parseFfmpegSegmentCsv,
  parseOpenAiTranscriptionArguments,
  readOpenAiApiKeyFile,
  redactedTranscriptionFailure,
  requestOpenAiTranscription,
  serializeTranscriptWebVtt,
  validateDiarizedTranscriptionResponse,
  writeWebVttAtomically,
} from "../scripts/openai-transcribe-core";
import {
  AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN,
  automaticTranscriptionDurationSupported,
  BUNDLED_OPENAI_TRANSCRIPT_EXECUTABLE,
  BUNDLED_OPENAI_TRANSCRIPT_SCRIPT,
  configuredTranscriptionProviderId,
  MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS,
  normalizeAutomaticTranscriptionLanguage,
  normalizeLegacyAutomaticTranscriptionLanguage,
  OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
  OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
  OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
  OPENAI_TRANSCRIPTION_RESULT_PROVIDER,
  TRANSCRIPT_PROCESSING_PROVIDER,
} from "../src/lib/media/transcription-contract";

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

function diarizedTranscript(
  input: Readonly<{
    duration: number;
    text: string;
    start?: number;
    end?: number;
    id?: string;
  }>,
) {
  return {
    task: "transcribe",
    duration: input.duration,
    text: input.text,
    segments: input.text
      ? [
          {
            type: "transcript.text.segment",
            id: input.id ?? "seg_001",
            start: input.start ?? 0,
            end: input.end ?? input.duration,
            text: input.text,
            speaker: "A",
          },
        ]
      : [],
  };
}

test("OpenAI transcription CLI accepts only its bounded file-based contract", () => {
  const configuration = parseOpenAiTranscriptionArguments([
    "--input",
    "source.mp4",
    "--output-vtt",
    "transcript.vtt",
    "--language",
    "de",
  ]);
  assert.deepEqual(configuration, {
    mode: "transcribe",
    apiKeyFile: resolve(DEFAULT_OPENAI_API_KEY_FILE),
    inputPath: resolve("source.mp4"),
    outputVttPath: resolve("transcript.vtt"),
    language: "de",
    providerLanguage: "de",
  });
  assert.equal(
    parseOpenAiTranscriptionArguments([
      "--input",
      "source.mp4",
      "--output-vtt",
      "transcript.vtt",
      "--language",
      "en",
    ]).mode,
    "transcribe",
  );
  assert.deepEqual(
    parseOpenAiTranscriptionArguments([
      "--preflight",
      "--api-key-file",
      "provider.secret",
    ]),
    {
      mode: "preflight",
      apiKeyFile: resolve("provider.secret"),
    },
  );
  assert.throws(
    () =>
      parseOpenAiTranscriptionArguments(["--preflight", "--input", "secret"]),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "configuration_invalid",
  );
  assert.throws(
    () =>
      parseOpenAiTranscriptionArguments(["--api-key", "must-not-be-accepted"]),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "configuration_invalid",
  );
  assert.throws(
    () => parseOpenAiTranscriptionArguments(["--temperature", "0"]),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "configuration_invalid",
  );
  for (const invalidLanguage of ["deu", "de-DE", "DE"]) {
    assert.throws(
      () =>
        parseOpenAiTranscriptionArguments([
          "--input",
          "source.mp4",
          "--output-vtt",
          "transcript.vtt",
          "--language",
          invalidLanguage,
        ]),
      (error: unknown) =>
        error instanceof OpenAiTranscriptionError &&
        error.code === "configuration_invalid",
    );
  }
});

test("automatic transcription languages normalize only ISO-639-1 codes", () => {
  assert.match("de", AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN);
  assert.match("en", AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN);
  assert.equal(normalizeAutomaticTranscriptionLanguage("de"), "de");
  assert.equal(normalizeAutomaticTranscriptionLanguage("en"), "en");
  assert.equal(normalizeAutomaticTranscriptionLanguage(" EN "), null);
  assert.equal(normalizeAutomaticTranscriptionLanguage("deu"), null);
  assert.equal(normalizeAutomaticTranscriptionLanguage("de-DE"), null);
  assert.equal(normalizeLegacyAutomaticTranscriptionLanguage("en-US"), "en");
  assert.equal(normalizeLegacyAutomaticTranscriptionLanguage("de-DE"), "de");
  assert.equal(normalizeLegacyAutomaticTranscriptionLanguage("eng"), null);
  assert.equal(normalizeLegacyAutomaticTranscriptionLanguage("deu"), null);
});

test("request identity binds the complete diarized transcription contract", () => {
  assert.equal(
    OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
    "openai-diarized-transcription-v1",
  );
  const contentSha256 = "a".repeat(64);
  const german = openAiTranscriptionRequestDigest({
    contentSha256,
    language: "de",
  });
  assert.match(german, /^[a-f0-9]{64}$/);
  assert.equal(
    german,
    openAiTranscriptionRequestDigest({ contentSha256, language: "de" }),
  );
  assert.notEqual(
    german,
    openAiTranscriptionRequestDigest({ contentSha256, language: "en" }),
  );
});

test("automatic transcription duration is capped before provider work", () => {
  assert.equal(MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS, 7_200_000);
  assert.equal(
    automaticTranscriptionDurationSupported(
      MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS,
    ),
    true,
  );
  assert.equal(
    automaticTranscriptionDurationSupported(
      MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS + 1,
    ),
    false,
  );
  assert.equal(automaticTranscriptionDurationSupported(null), false);
});

test("persisted transcription provenance distinguishes bundled OpenAI from other providers", () => {
  const bundledEnvironment = {
    MEDIA_TRANSCRIPTION_ENABLED: "true",
    MEDIA_TRANSCRIPT_COMMAND: BUNDLED_OPENAI_TRANSCRIPT_EXECUTABLE,
    MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON: JSON.stringify([
      BUNDLED_OPENAI_TRANSCRIPT_SCRIPT,
      "--input",
      "{input}",
      "--output-vtt",
      "{output}",
      "--language",
      "{language}",
    ]),
  };
  assert.equal(
    configuredTranscriptionProviderId(bundledEnvironment),
    OPENAI_TRANSCRIPTION_RESULT_PROVIDER,
  );
  assert.equal(
    configuredTranscriptionProviderId({
      ...bundledEnvironment,
      MEDIA_TRANSCRIPTION_ENABLED: "false",
    }),
    "disabled-v1",
  );
  assert.equal(
    configuredTranscriptionProviderId({
      ...bundledEnvironment,
      MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY: "/fixtures",
    }),
    "deterministic-sidecar-v1",
  );
  assert.equal(
    configuredTranscriptionProviderId({
      MEDIA_TRANSCRIPTION_ENABLED: "true",
      MEDIA_TRANSCRIPT_COMMAND: "/opt/custom-transcriber",
      MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON: "[]",
    }),
    "local-command-v1",
  );
  assert.equal(
    configuredTranscriptionProviderId({
      MEDIA_TRANSCRIPTION_ENABLED: "true",
      MEDIA_TRANSCRIPT_COMMAND: BUNDLED_OPENAI_TRANSCRIPT_EXECUTABLE,
      MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON: "not-json",
    }),
    "unconfigured-v1",
  );
  assert.equal(configuredTranscriptionProviderId({}), "disabled-v1");
  assert.equal(
    TRANSCRIPT_PROCESSING_PROVIDER,
    "configured-transcript-webvtt-v2",
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
        "chunk-0000.mp3,0.000000,300.000000",
        '"chunk-0001.mp3",300.000000,301.250000',
        "",
      ].join("\n"),
    ),
    [
      {
        fileName: "chunk-0000.mp3",
        startSeconds: 0,
        endSeconds: 300,
      },
      {
        fileName: "chunk-0001.mp3",
        startSeconds: 300,
        endSeconds: 301.25,
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
  const maximumManifest = Array.from({ length: 24 }, (_, index) => {
    const start = index * 300;
    return `chunk-${String(index).padStart(4, "0")}.mp3,${start.toFixed(6)},${(start + 300).toFixed(6)}`;
  }).join("\n");
  assert.equal(
    parseFfmpegSegmentCsv(`${maximumManifest}\n`).length,
    24,
  );
  const oversizedManifest = Array.from({ length: 25 }, (_, index) => {
    const start = index * 300;
    const end = index === 24 ? 7_200.5 : start + 300;
    return `chunk-${String(index).padStart(4, "0")}.mp3,${start.toFixed(6)},${end.toFixed(6)}`;
  }).join("\n");
  assert.throws(
    () => parseFfmpegSegmentCsv(`${oversizedManifest}\n`),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "audio_duration_exceeded",
  );
});

test("diarized segment timestamps are validated, offset and serialized as bounded WebVTT", () => {
  const first = validateDiarizedTranscriptionResponse(
    diarizedTranscript({
      duration: 10,
      start: 0.125,
      end: 2.5,
      text: " Hallo <Welt> & alle ",
    }),
    10,
  );
  const second = validateDiarizedTranscriptionResponse(
    diarizedTranscript({
      duration: 5,
      start: 0.5,
      end: 1.25,
      text: "Weiter",
    }),
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

test("long diarized speaker turns split deterministically into timed WebVTT cues", () => {
  const text = Array.from(
    { length: 160 },
    (_, index) => `Wort${String(index).padStart(3, "0")}`,
  ).join(" ");
  const transcript = validateDiarizedTranscriptionResponse(
    diarizedTranscript({ duration: 60, start: 5, end: 55, text }),
    60,
  );
  assert.ok(transcript.segments.length > 1);
  assert.equal(
    transcript.segments.map((segment) => segment.text).join(" "),
    text,
  );
  assert.equal(transcript.segments[0]?.startSeconds, 5);
  assert.equal(transcript.segments.at(-1)?.endSeconds, 55);
  for (const [index, segment] of transcript.segments.entries()) {
    assert.ok(segment.text.length <= 240);
    assert.ok(segment.endSeconds > segment.startSeconds);
    if (index > 0) {
      assert.equal(
        segment.startSeconds,
        transcript.segments[index - 1]?.endSeconds,
      );
    }
  }
  assert.deepEqual(
    transcript,
    validateDiarizedTranscriptionResponse(
      diarizedTranscript({ duration: 60, start: 5, end: 55, text }),
      60,
    ),
  );
});

test("malformed provider schemas and timestamps fail closed", () => {
  const valid = diarizedTranscript({ duration: 1, text: "ok", end: 0.9 });
  for (const candidate of [
    { ...valid, duration: "1" },
    { ...valid, segments: "none" },
    { ...valid, task: "translate" },
    { ...valid, segments: [{ ...valid.segments[0], start: -1 }] },
    { ...valid, segments: [{ ...valid.segments[0], start: 0.8, end: 0.7 }] },
    { ...valid, segments: [{ ...valid.segments[0], speaker: "" }] },
    { ...valid, segments: [{ ...valid.segments[0], type: "other" }] },
    { ...valid, segments: [{ ...valid.segments[0], end: 1.1 }] },
  ]) {
    assert.throws(
      () => validateDiarizedTranscriptionResponse(candidate, 1),
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
  assert.throws(
    () =>
      validateDiarizedTranscriptionResponse(
        diarizedTranscript({ duration: 1, text: "truncated", end: 1 }),
        20,
      ),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "provider_response_invalid",
  );
  assert.throws(
    () =>
      validateDiarizedTranscriptionResponse(
        {
          ...diarizedTranscript({ duration: 1, text: "eins zwei" }),
          segments: [
            {
              type: "transcript.text.segment",
              id: "seg_partial",
              start: 0,
              end: 1,
              text: "eins",
              speaker: "A",
            },
          ],
        },
        1,
      ),
    (error: unknown) =>
      error instanceof OpenAiTranscriptionError &&
      error.code === "provider_response_invalid",
  );
  const whitespaceEquivalent = validateDiarizedTranscriptionResponse(
    {
      ...diarizedTranscript({ duration: 1, text: "eins\n\tzwei" }),
      segments: [
        {
          type: "transcript.text.segment",
          id: "seg_first",
          start: 0,
          end: 0.5,
          text: "eins",
          speaker: "A",
        },
        {
          type: "transcript.text.segment",
          id: "seg_second",
          start: 0.5,
          end: 1,
          text: "zwei",
          speaker: "A",
        },
      ],
    },
    1,
  );
  assert.deepEqual(
    whitespaceEquivalent.segments.map((segment) => segment.text),
    ["eins", "zwei"],
  );
  const speakerLabeledAggregate = validateDiarizedTranscriptionResponse(
    {
      task: "transcribe",
      duration: 2,
      text: "Agent: Danke fuer Ihren Anruf.\n A: Ich brauche Hilfe.",
      segments: [
        {
          type: "transcript.text.segment",
          id: "seg_agent",
          start: 0,
          end: 1,
          text: "Danke fuer Ihren Anruf.",
          speaker: "agent",
        },
        {
          type: "transcript.text.segment",
          id: "seg_a",
          start: 1,
          end: 2,
          text: "Ich brauche Hilfe.",
          speaker: "A",
        },
      ],
    },
    2,
  );
  assert.deepEqual(
    speakerLabeledAggregate.segments.map((segment) => segment.text),
    ["Danke fuer Ihren Anruf.", "Ich brauche Hilfe."],
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
        assert.match(
          headers.get("idempotency-key") ?? "",
          /^q-academy-stt-[a-f0-9]{64}$/,
        );
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get("model"), OPENAI_TRANSCRIPTION_MODEL);
        assert.equal(
          init.body.get("response_format"),
          OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
        );
        assert.equal(
          init.body.get("chunking_strategy"),
          OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
        );
        assert.equal(init.body.has("timestamp_granularities[]"), false);
        assert.equal(init.body.has("prompt"), false);
        assert.equal(init.body.has("include[]"), false);
        assert.equal(init.body.get("language"), "de");
        assert.equal(init.body.has("temperature"), false);
        const file = init.body.get("file");
        assert.ok(file instanceof Blob);
        assert.equal(file.size, 1_024);
        return providerJson(
          diarizedTranscript({ duration: 2, end: 1, text: "Test" }),
        );
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
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "999" },
          });
        }
        if (calls === 2) return new Response("", { status: 503 });
        return providerJson(
          diarizedTranscript({ duration: 1, end: 0.5, text: "ready" }),
        );
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
      fetchImplementation: async () => {
        networkCalls += 1;
        if (networkCalls < 3) throw new TypeError("simulated network failure");
        return providerJson(
          diarizedTranscript({ duration: 1, end: 0.5, text: "recovered" }),
        );
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
        requestTimeoutMs: 5,
        fetchImplementation: async (_url, init) => {
          timeoutCalls += 1;
          assert.ok(init?.signal instanceof AbortSignal);
          return new Promise<Response>((_resolvePromise, reject) => {
            const rejectOnAbort = () => reject(init.signal?.reason);
            if (init.signal?.aborted) rejectOnAbort();
            else
              init.signal?.addEventListener("abort", rejectOnAbort, {
                once: true,
              });
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
    new URL("../scripts/openai-transcribe-core.ts", import.meta.url),
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
          fetchImplementation: async () => {
            calls += 1;
            return new Response("", {
              status,
              headers:
                status === 302 ? { location: "https://invalid.example" } : {},
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
      new OpenAiTranscriptionError(
        "provider_authentication_failed",
        providerDetail,
      ),
    ),
  );
  const unknown = JSON.stringify(
    redactedTranscriptionFailure(new Error(providerDetail)),
  );
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
