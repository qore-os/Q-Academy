import assert from "node:assert/strict";
import test from "node:test";

import {
  canSubscribeToLessonAvailability,
  shouldFulfillLessonAvailabilitySubscription,
} from "../src/lib/lesson-availability-policy";

const comingSoon = {
  state: "coming_soon",
  listed: true,
  canOpen: false,
};

test("only listed coming-soon lessons accept availability subscriptions", () => {
  assert.equal(canSubscribeToLessonAvailability(comingSoon), true);
  assert.equal(
    canSubscribeToLessonAvailability({ ...comingSoon, listed: false }),
    false,
  );
  assert.equal(
    canSubscribeToLessonAvailability({
      state: "locked",
      listed: true,
      canOpen: false,
    }),
    false,
  );
  assert.equal(
    canSubscribeToLessonAvailability({
      state: "available",
      listed: true,
      canOpen: true,
    }),
    false,
  );
});

test("fulfillment requires a coming-soon to openable publication transition", () => {
  assert.equal(
    shouldFulfillLessonAvailabilitySubscription({
      previousAccess: comingSoon,
      nextAccess: { state: "available", listed: true, canOpen: true },
    }),
    true,
  );
  for (const nextAccess of [
    { state: "coming_soon", listed: true, canOpen: false },
    { state: "locked", listed: true, canOpen: false },
    { state: "hidden", listed: false, canOpen: false },
  ]) {
    assert.equal(
      shouldFulfillLessonAvailabilitySubscription({
        previousAccess: comingSoon,
        nextAccess,
      }),
      false,
    );
  }
  assert.equal(
    shouldFulfillLessonAvailabilitySubscription({
      previousAccess: { state: "hidden", listed: false, canOpen: false },
      nextAccess: { state: "available", listed: true, canOpen: true },
    }),
    false,
  );
});
