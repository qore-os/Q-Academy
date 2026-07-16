import assert from "node:assert/strict";
import test from "node:test";

import { MediaContentInspectionError } from "@/lib/media/content-inspection";
import {
  probeWebmDurationStream,
  WEBM_DURATION_FFPROBE_ARGUMENTS,
  WebmDurationProbeError,
} from "@/lib/media/webm-duration-probe";

async function* split(bytes: Uint8Array) {
  const sizes = [1, 2, 3, 5, 8, 13, 64];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = sizes[index++ % sizes.length] ?? 1;
    yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
    offset += size;
  }
}

function nodeProbe(script: string) {
  return {
    executable: process.execPath,
    arguments: ["-e", script],
    timeoutMs: 5_000,
  } as const;
}

test("WebM probe streams every byte and derives the maximum packet end", async () => {
  const bytes = Buffer.alloc(128 * 1_024 + 17, 0x5a);
  const script = `
    let received = 0;
    process.stdin.on("data", (chunk) => { received += chunk.length; });
    process.stdin.on("end", () => {
      if (received !== ${bytes.length}) process.exit(9);
      process.stdout.write([
        "stream_index=0|pts_time=0.000000|duration_time=0.060000",
        "stream_index=1|pts_time=17.542000|duration_time=0.001000",
        "stream_index=0|pts_time=17.520000|duration_time=0.060000",
        "",
      ].join("\\n"));
    });
  `;

  const result = await probeWebmDurationStream(
    { body: split(bytes), expectedSizeBytes: bytes.length },
    nodeProbe(script),
  );
  assert.equal(result.durationMilliseconds, 17_580);
});

test("WebM probe derives duration from packet deltas when durations are unavailable", async () => {
  const bytes = Buffer.from("webm");
  const script = `
    process.stdin.resume();
    process.stdin.on("end", () => {
      process.stdout.write([
        "stream_index=0|pts_time=0.000000|duration_time=N/A",
        "stream_index=0|pts_time=1.000000|duration_time=N/A",
        "stream_index=0|pts_time=2.500000|duration_time=N/A",
        "",
      ].join("\\n"));
    });
  `;

  const result = await probeWebmDurationStream(
    { body: split(bytes), expectedSizeBytes: bytes.length },
    nodeProbe(script),
  );
  assert.equal(result.durationMilliseconds, 2_500);
});

test("WebM probe suppresses nested metadata and accepts one compact section terminator", async () => {
  assert.ok(
    WEBM_DURATION_FFPROBE_ARGUMENTS.includes(
      "packet=stream_index,pts_time,duration_time:packet_tags=:packet_side_data=",
    ),
  );
  const bytes = Buffer.from("webm");
  const acceptedScript = `
    process.stdin.resume();
    process.stdin.on("end", () => {
      process.stdout.write([
        "stream_index=1|pts_time=-0.007000|duration_time=0.020000|",
        "stream_index=0|pts_time=1.207000|duration_time=0.100000|",
        "stream_index=1|pts_time=1.234000|duration_time=0.020000|",
        "",
      ].join("\\n"));
    });
  `;
  const result = await probeWebmDurationStream(
    { body: split(bytes), expectedSizeBytes: bytes.length },
    nodeProbe(acceptedScript),
  );
  assert.equal(result.durationMilliseconds, 1_314);

  for (const invalidRecord of [
    "stream_index=1|pts_time=1.234000|duration_time=0.020000|side_data_type=Skip Samples",
    "stream_index=1|pts_time=1.234000|duration_time=0.020000||",
    "stream_index=1||pts_time=1.234000|duration_time=0.020000",
  ]) {
    const invalidScript = `
      process.stdin.resume();
      process.stdin.on("end", () => {
        process.stdout.write(${JSON.stringify(invalidRecord + "\n")});
      });
    `;
    await assert.rejects(
      probeWebmDurationStream(
        { body: split(bytes), expectedSizeBytes: bytes.length },
        nodeProbe(invalidScript),
      ),
      MediaContentInspectionError,
    );
  }
});

test("WebM probe still fails closed without a usable timestamp range", async () => {
  const bytes = Buffer.from("webm");
  const script = `
    process.stdin.resume();
    process.stdin.on("end", () => {
      process.stdout.write("stream_index=0|pts_time=N/A|duration_time=N/A\\n");
    });
  `;

  await assert.rejects(
    probeWebmDurationStream(
      { body: split(bytes), expectedSizeBytes: bytes.length },
      nodeProbe(script),
    ),
    MediaContentInspectionError,
  );
});

test("WebM probe enforces immutable input length and bounded output", async () => {
  const bytes = Buffer.alloc(32, 0x01);
  const script = `
    process.stdin.resume();
    process.stdin.on("end", () => {
      for (let i = 0; i < 20; i += 1) {
        process.stdout.write("stream_index=0|pts_time=1.000000|duration_time=0.020000\\n");
      }
    });
  `;
  await assert.rejects(
    probeWebmDurationStream(
      { body: split(bytes), expectedSizeBytes: bytes.length - 1 },
      nodeProbe(script),
    ),
    MediaContentInspectionError,
  );
  await assert.rejects(
    probeWebmDurationStream(
      { body: split(bytes), expectedSizeBytes: bytes.length },
      { ...nodeProbe(script), maxPacketRecords: 2 },
    ),
    MediaContentInspectionError,
  );
});

test("WebM probe distinguishes unavailable and timed-out native probes", async () => {
  const bytes = Buffer.from("webm");
  await assert.rejects(
    probeWebmDurationStream(
      { body: split(bytes), expectedSizeBytes: bytes.length },
      { executable: "q-academy-definitely-missing-ffprobe", timeoutMs: 1_000 },
    ),
    (error: unknown) =>
      error instanceof WebmDurationProbeError &&
      error.code === "probe_unavailable",
  );

  const script = `process.stdin.resume(); setTimeout(() => undefined, 10_000);`;
  await assert.rejects(
    probeWebmDurationStream(
      { body: split(bytes), expectedSizeBytes: bytes.length },
      { ...nodeProbe(script), timeoutMs: 100 },
    ),
    (error: unknown) =>
      error instanceof WebmDurationProbeError && error.code === "probe_timeout",
  );
});

test("WebM probe handles an early child exit without an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    async function* slowInput() {
      yield Buffer.from("first");
      await new Promise((resolve) => setTimeout(resolve, 100));
      yield Buffer.from("second");
    }
    await assert.rejects(
      probeWebmDurationStream(
        { body: slowInput(), expectedSizeBytes: 11 },
        nodeProbe(`process.exit(7);`),
      ),
      MediaContentInspectionError,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("WebM probe timeout cancels an input iterator that is still blocked", async () => {
  let cancelled = false;
  const body: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
        return: async () => {
          cancelled = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const startedAt = Date.now();
  await assert.rejects(
    probeWebmDurationStream(
      { body, expectedSizeBytes: 4 },
      {
        ...nodeProbe(
          `process.stdin.resume(); setTimeout(() => undefined, 10_000);`,
        ),
        timeoutMs: 100,
      },
    ),
    (error: unknown) =>
      error instanceof WebmDurationProbeError && error.code === "probe_timeout",
  );
  assert.equal(cancelled, true);
  assert.ok(Date.now() - startedAt < 2_000);
});
