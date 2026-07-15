import assert from "node:assert/strict";
import test from "node:test";
import {
  eventLifecycleCommandSchema,
  resolveEventLifecycleTransition,
} from "../src/lib/event-lifecycle-model";

const now = new Date("2026-07-12T10:00:00.000Z");
const scheduled = {
  status: "scheduled" as const,
  startsAt: new Date("2026-07-20T10:00:00.000Z"),
  endsAt: new Date("2026-07-20T12:00:00.000Z"),
};

test("event lifecycle commands require a bounded reason and valid dates", () => {
  assert.equal(
    eventLifecycleCommandSchema.safeParse({
      action: "cancel",
      reason: " ",
    }).success,
    false,
  );
  assert.equal(
    eventLifecycleCommandSchema.safeParse({
      action: "reschedule",
      startsAt: "2026-07-21T10:00:00Z",
      endsAt: "2026-07-21T12:00:00Z",
      reason: "Trainer ist verhindert.",
      unexpected: true,
    }).success,
    false,
  );
});

test("cancellation is a one-way idempotent transition until rescheduled", () => {
  const cancelled = resolveEventLifecycleTransition(
    scheduled,
    { action: "cancel", reason: "Trainer ist verhindert." },
    now,
  );
  assert.deepEqual(cancelled, {
    ok: true,
    action: "cancelled",
    fromStatus: "scheduled",
    toStatus: "cancelled",
    startsAt: scheduled.startsAt,
    endsAt: scheduled.endsAt,
    reason: "Trainer ist verhindert.",
  });
  assert.deepEqual(
    resolveEventLifecycleTransition(
      { ...scheduled, status: "cancelled" },
      { action: "cancel", reason: "Noch einmal." },
      now,
    ),
    { ok: false, reason: "already_cancelled" },
  );
});

test("rescheduling requires a future non-empty window and reopens cancellation", () => {
  assert.deepEqual(
    resolveEventLifecycleTransition(
      scheduled,
      {
        action: "reschedule",
        startsAt: new Date("2026-07-21T12:00:00Z"),
        endsAt: new Date("2026-07-21T11:00:00Z"),
        reason: "Neuer Zeitraum.",
      },
      now,
    ),
    { ok: false, reason: "invalid_window" },
  );
  assert.deepEqual(
    resolveEventLifecycleTransition(
      scheduled,
      {
        action: "reschedule",
        startsAt: new Date("2026-07-12T09:00:00Z"),
        endsAt: new Date("2026-07-12T11:00:00Z"),
        reason: "Neuer Zeitraum.",
      },
      now,
    ),
    { ok: false, reason: "start_not_future" },
  );
  const result = resolveEventLifecycleTransition(
    { ...scheduled, status: "cancelled" },
    {
      action: "reschedule",
      startsAt: new Date("2026-07-22T09:00:00Z"),
      endsAt: new Date("2026-07-22T11:00:00Z"),
      reason: "Ersatztermin steht fest.",
    },
    now,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.fromStatus, "cancelled");
    assert.equal(result.toStatus, "scheduled");
    assert.equal(result.action, "rescheduled");
  }
});

test("rescheduling a scheduled event to the same window is a no-op", () => {
  assert.deepEqual(
    resolveEventLifecycleTransition(
      scheduled,
      {
        action: "reschedule",
        startsAt: scheduled.startsAt,
        endsAt: scheduled.endsAt,
        reason: "Keine echte Aenderung.",
      },
      now,
    ),
    { ok: false, reason: "unchanged" },
  );
});
