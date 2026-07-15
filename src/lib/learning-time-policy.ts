import { z } from "zod";
import {
  LEARNING_TIME_MAX_CREDIT_SECONDS,
  LEARNING_TIME_MAX_INTERVAL_MS,
  LEARNING_TIME_MAX_SESSION_SECONDS,
  LEARNING_TIME_MIN_INTERVAL_MS,
} from "@/lib/learning-time-constants";

export {
  LEARNING_TIME_HEARTBEAT_INTERVAL_MS,
  LEARNING_TIME_MAX_CREDIT_SECONDS,
  LEARNING_TIME_MAX_INTERVAL_MS,
  LEARNING_TIME_MAX_SESSION_SECONDS,
  LEARNING_TIME_MIN_INTERVAL_MS,
} from "@/lib/learning-time-constants";

export const learningTimeHeartbeatSchema = z
  .object({
    courseId: z.string().uuid(),
    lessonId: z.string().uuid(),
    trackingSessionId: z.string().uuid(),
    sequence: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export type LearningTimeHeartbeatInput = z.infer<
  typeof learningTimeHeartbeatSchema
>;

export type LearningTimeSequenceState =
  | { kind: "duplicate" }
  | { kind: "next" }
  | { kind: "gap" };

export function classifyLearningTimeSequence(
  lastSequence: number,
  incomingSequence: number,
): LearningTimeSequenceState {
  if (
    !Number.isInteger(lastSequence) ||
    lastSequence < 0 ||
    !Number.isInteger(incomingSequence) ||
    incomingSequence < 0
  ) {
    throw new TypeError("Learning-time sequences must be non-negative integers.");
  }
  if (incomingSequence <= lastSequence) return { kind: "duplicate" };
  if (incomingSequence === lastSequence + 1) return { kind: "next" };
  return { kind: "gap" };
}

export type LearningTimeCreditResult =
  | { ok: true; creditedSeconds: number }
  | { ok: false; reason: "too_soon" | "session_expired" };

export function calculateLearningTimeCredit(input: {
  previousHeartbeatAt: Date;
  receivedAt: Date;
  currentActiveSeconds: number;
}): LearningTimeCreditResult {
  const previous = input.previousHeartbeatAt.getTime();
  const received = input.receivedAt.getTime();
  if (
    !Number.isFinite(previous) ||
    !Number.isFinite(received) ||
    !Number.isInteger(input.currentActiveSeconds) ||
    input.currentActiveSeconds < 0
  ) {
    throw new TypeError("Learning-time credit input is invalid.");
  }

  const elapsedMilliseconds = received - previous;
  if (elapsedMilliseconds < LEARNING_TIME_MIN_INTERVAL_MS) {
    return { ok: false, reason: "too_soon" };
  }
  if (elapsedMilliseconds > LEARNING_TIME_MAX_INTERVAL_MS) {
    return { ok: false, reason: "session_expired" };
  }

  const creditedSeconds = Math.min(
    Math.floor(elapsedMilliseconds / 1_000),
    LEARNING_TIME_MAX_CREDIT_SECONDS,
  );
  if (
    input.currentActiveSeconds + creditedSeconds >
    LEARNING_TIME_MAX_SESSION_SECONDS
  ) {
    return { ok: false, reason: "session_expired" };
  }
  return { ok: true, creditedSeconds };
}
