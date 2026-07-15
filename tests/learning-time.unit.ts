import assert from "node:assert/strict";
import test from "node:test";
import {
  LEARNING_TIME_MAX_CREDIT_SECONDS,
  calculateLearningTimeCredit,
  classifyLearningTimeSequence,
  learningTimeHeartbeatSchema,
} from "../src/lib/learning-time-policy";
import { formatLearningTime } from "../src/lib/utils";

test("learning-time heartbeat input is strict and bounded", () => {
  const valid = {
    courseId: "11111111-1111-4111-8111-111111111111",
    lessonId: "22222222-2222-4222-8222-222222222222",
    trackingSessionId: "33333333-3333-4333-8333-333333333333",
    sequence: 0,
  };
  assert.equal(learningTimeHeartbeatSchema.safeParse(valid).success, true);
  assert.equal(
    learningTimeHeartbeatSchema.safeParse({ ...valid, sequence: -1 }).success,
    false,
  );
  assert.equal(
    learningTimeHeartbeatSchema.safeParse({ ...valid, activeSeconds: 999 }).success,
    false,
  );
  assert.equal(
    learningTimeHeartbeatSchema.safeParse({ ...valid, courseId: "foreign" })
      .success,
    false,
  );
});

test("learning-time sequences are idempotent and reject gaps", () => {
  assert.deepEqual(classifyLearningTimeSequence(4, 4), { kind: "duplicate" });
  assert.deepEqual(classifyLearningTimeSequence(4, 2), { kind: "duplicate" });
  assert.deepEqual(classifyLearningTimeSequence(4, 5), { kind: "next" });
  assert.deepEqual(classifyLearningTimeSequence(4, 6), { kind: "gap" });
  assert.throws(() => classifyLearningTimeSequence(-1, 0), TypeError);
});

test("learning-time credit uses server time and bounded intervals", () => {
  const previousHeartbeatAt = new Date("2026-07-12T10:00:00.000Z");
  assert.deepEqual(
    calculateLearningTimeCredit({
      previousHeartbeatAt,
      receivedAt: new Date("2026-07-12T10:00:07.999Z"),
      currentActiveSeconds: 0,
    }),
    { ok: false, reason: "too_soon" },
  );
  assert.deepEqual(
    calculateLearningTimeCredit({
      previousHeartbeatAt,
      receivedAt: new Date("2026-07-12T10:00:15.900Z"),
      currentActiveSeconds: 0,
    }),
    { ok: true, creditedSeconds: 15 },
  );
  assert.deepEqual(
    calculateLearningTimeCredit({
      previousHeartbeatAt,
      receivedAt: new Date("2026-07-12T10:00:29.000Z"),
      currentActiveSeconds: 0,
    }),
    { ok: true, creditedSeconds: LEARNING_TIME_MAX_CREDIT_SECONDS },
  );
  assert.deepEqual(
    calculateLearningTimeCredit({
      previousHeartbeatAt,
      receivedAt: new Date("2026-07-12T10:00:30.001Z"),
      currentActiveSeconds: 0,
    }),
    { ok: false, reason: "session_expired" },
  );
});

test("learning-time formatting preserves short measured intervals", () => {
  assert.equal(formatLearningTime(15), "15 Sek.");
  assert.equal(formatLearningTime(75), "1 Min. 15 Sek.");
  assert.equal(formatLearningTime(3_600), "1 Std.");
  assert.equal(formatLearningTime(3_675), "1 Std. 1 Min.");
});

