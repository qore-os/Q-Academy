import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/lib/api/errors";
import {
  EXAM_SESSION_JSON_MAX_BYTES,
  examAttemptDraftSchema,
} from "../src/lib/exam-lifecycle-model";
import { parseSessionJson } from "../src/lib/session-json";
import { sessionRequestId } from "../src/lib/session-request-id";

function jsonRequest(value: unknown) {
  return new Request("https://academy.example.test/api/v1/me/exam-attempts/id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

test("exam session parser accepts a valid draft larger than the media limit", async () => {
  const draft = {
    expectedRevision: 7,
    answers: Array.from({ length: 100 }, (_, index) => ({
      blockId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      textAnswer: `${index}-${"x".repeat(495)}`,
    })),
  };
  const encodedBytes = new TextEncoder().encode(JSON.stringify(draft)).length;
  assert.ok(encodedBytes > 16 * 1024);
  assert.ok(encodedBytes < EXAM_SESSION_JSON_MAX_BYTES);
  const parsed = await parseSessionJson(jsonRequest(draft), {
    maxBytes: EXAM_SESSION_JSON_MAX_BYTES,
  });
  assert.equal(examAttemptDraftSchema.parse(parsed).answers.length, 100);
});

test("exam session parser rejects a streamed body above its route limit", async () => {
  const request = jsonRequest({ value: "x".repeat(EXAM_SESSION_JSON_MAX_BYTES) });
  await assert.rejects(
    () =>
      parseSessionJson(request, {
        maxBytes: EXAM_SESSION_JSON_MAX_BYTES,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 413);
      return true;
    },
  );
});

test("one session request keeps one correlation id", () => {
  const request = jsonRequest({ value: "ok" });
  assert.equal(sessionRequestId(request), sessionRequestId(request));
  const supplied = "10000000-0000-4000-8000-000000000001";
  const suppliedRequest = new Request("https://academy.example.test/api", {
    headers: { "X-Request-Id": supplied },
  });
  assert.equal(sessionRequestId(suppliedRequest), supplied);
});
