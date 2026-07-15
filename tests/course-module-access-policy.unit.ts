import assert from "node:assert/strict";
import test from "node:test";

import {
  combineLearningAccess,
  inferCourseModuleAccessMode,
  nextPreviousListedModuleCompleted,
  resolveCourseLearningAccessAnchor,
  resolveCourseModuleAccess,
} from "../src/lib/course-module-access-policy";

const anchor = new Date("2027-01-01T09:00:00.000Z");

test("v2 module snapshots infer delay mode from dripDays", () => {
  assert.equal(inferCourseModuleAccessMode({ dripDays: 0 }), "visible");
  assert.equal(inferCourseModuleAccessMode({ dripDays: 4 }), "delay_days");
});

test("access anchor survives republish and enrollment recreation", () => {
  const firstPublishedAt = new Date("2027-01-05T09:00:00.000Z");
  const grantStartedAt = new Date("2027-01-06T09:00:00.000Z");
  const recreatedEnrollment = new Date("2027-03-01T09:00:00.000Z");
  assert.equal(
    resolveCourseLearningAccessAnchor({
      firstPublishedAt,
      enrolledAt: recreatedEnrollment,
      courseAccessStartedAt: grantStartedAt,
    }).toISOString(),
    grantStartedAt.toISOString(),
  );
  assert.equal(
    resolveCourseLearningAccessAnchor({
      firstPublishedAt,
      enrolledAt: new Date("2027-01-01T09:00:00.000Z"),
    }).toISOString(),
    firstPublishedAt.toISOString(),
  );
});

test("delay_days uses the stable access anchor", () => {
  const upcoming = resolveCourseModuleAccess({
    configuration: { accessMode: "delay_days", dripDays: 5 },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: new Date("2027-01-05T09:00:00.000Z"),
  });
  assert.equal(upcoming.state, "locked");
  assert.equal(upcoming.listed, true);
  assert.equal(upcoming.canOpen, false);
  assert.equal(upcoming.canInteract, false);
  assert.equal(upcoming.availableAt, "2027-01-06T09:00:00.000Z");
  assert.deepEqual(upcoming.reasons, ["module_delay"]);

  const available = resolveCourseModuleAccess({
    configuration: { accessMode: "delay_days", dripDays: 5 },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: new Date("2027-01-06T09:00:00.000Z"),
  });
  assert.equal(available.state, "available");
  assert.equal(available.canInteract, true);
});

test("after_previous waits for every published lesson in the prior listed module", () => {
  const locked = resolveCourseModuleAccess({
    configuration: { accessMode: "after_previous" },
    accessAnchor: anchor,
    previousModuleCompleted: false,
  });
  assert.equal(locked.state, "locked");
  assert.deepEqual(locked.reasons, ["previous_module"]);
  assert.equal(locked.requestable, false);

  const available = resolveCourseModuleAccess({
    configuration: { accessMode: "after_previous" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  assert.equal(available.state, "available");
});

test("link modules do not alter the completion state used by after_previous", () => {
  assert.equal(
    nextPreviousListedModuleCompleted({
      previousCompleted: false,
      moduleKind: "link",
      moduleListed: true,
      moduleLessonsCompleted: true,
    }),
    false,
  );
  assert.equal(
    nextPreviousListedModuleCompleted({
      previousCompleted: true,
      moduleKind: "link",
      moduleListed: true,
      moduleLessonsCompleted: false,
    }),
    true,
  );
  assert.equal(
    nextPreviousListedModuleCompleted({
      previousCompleted: true,
      moduleKind: "learning",
      moduleListed: true,
      moduleLessonsCompleted: false,
    }),
    false,
  );
});

test("date_window becomes read-only at its exclusive end", () => {
  const access = resolveCourseModuleAccess({
    configuration: {
      accessMode: "date_window",
      availableFrom: "2027-01-03T09:00:00.000Z",
      availableUntil: "2027-01-10T09:00:00.000Z",
      windowDefaultState: "read_only",
      windowState: "available",
    },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: new Date("2027-01-10T09:00:00.000Z"),
  });
  assert.equal(access.state, "read_only");
  assert.equal(access.canOpen, true);
  assert.equal(access.canInteract, false);
  assert.deepEqual(access.reasons, ["date_expired"]);
});

test("delay and date-window presentation states are configurable", () => {
  const hiddenDelay = resolveCourseModuleAccess({
    configuration: {
      accessMode: "delay_days",
      dripDays: 2,
      delayPendingState: "hidden",
    },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: anchor,
  });
  assert.equal(hiddenDelay.state, "hidden");
  assert.equal(hiddenDelay.availableAt, "2027-01-03T09:00:00.000Z");

  const lockedOutside = resolveCourseModuleAccess({
    configuration: {
      accessMode: "date_window",
      availableFrom: "2027-01-03T09:00:00.000Z",
      availableUntil: "2027-01-10T09:00:00.000Z",
      windowDefaultState: "locked",
      windowState: "read_only",
      requestAccessEnabled: true,
    },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: anchor,
  });
  assert.equal(lockedOutside.state, "locked");
  assert.equal(lockedOutside.requestable, true);

  const readOnlyInside = resolveCourseModuleAccess({
    configuration: {
      accessMode: "date_window",
      availableFrom: "2027-01-03T09:00:00.000Z",
      availableUntil: "2027-01-10T09:00:00.000Z",
      windowDefaultState: "locked",
      windowState: "read_only",
    },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: new Date("2027-01-05T09:00:00.000Z"),
  });
  assert.equal(readOnlyInside.state, "read_only");
  assert.equal(readOnlyInside.canOpen, true);
  assert.equal(readOnlyInside.canInteract, false);
});

test("invalid v3 timestamps fail closed", () => {
  const access = resolveCourseModuleAccess({
    configuration: {
      accessMode: "date_window",
      availableFrom: "not-a-date",
      windowDefaultState: "available",
      windowState: "available",
    },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  assert.equal(access.state, "hidden");
  assert.deepEqual(access.reasons, ["invalid_configuration"]);
});

test("parent and child access combine to the most restrictive state", () => {
  const available = resolveCourseModuleAccess({
    configuration: { accessMode: "visible" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  const readOnly = resolveCourseModuleAccess({
    configuration: {
      accessMode: "date_window",
      availableUntil: "2026-12-31T09:00:00.000Z",
      windowDefaultState: "read_only",
    },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    now: anchor,
  });
  const hidden = resolveCourseModuleAccess({
    configuration: { accessMode: "hidden" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  const locked = resolveCourseModuleAccess({
    configuration: { accessMode: "locked" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });

  assert.equal(combineLearningAccess(hidden, readOnly).state, "hidden");
  assert.equal(combineLearningAccess(locked, readOnly).state, "locked");
  assert.equal(combineLearningAccess(available, readOnly).state, "read_only");
});

test("locked modules expose one pending request at a time", () => {
  const requestable = resolveCourseModuleAccess({
    configuration: { accessMode: "locked", requestAccessEnabled: true },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  assert.equal(requestable.state, "locked");
  assert.equal(requestable.requestable, true);

  const pending = resolveCourseModuleAccess({
    configuration: { accessMode: "locked", requestAccessEnabled: true },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    requestStatus: "pending",
  });
  assert.equal(pending.requestable, false);
  assert.equal(pending.requestStatus, "pending");
});

test("active overrides take precedence and expired overrides do not", () => {
  const granted = resolveCourseModuleAccess({
    configuration: { accessMode: "hidden" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    override: { state: "available" },
  });
  assert.equal(granted.state, "available");
  assert.equal(granted.listed, true);
  assert.equal(granted.canInteract, true);

  const expired = resolveCourseModuleAccess({
    configuration: { accessMode: "visible" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
    override: {
      state: "hidden",
      expiresAt: "2026-12-31T09:00:00.000Z",
    },
    now: anchor,
  });
  assert.equal(expired.state, "available");
});

test("coming soon and hidden stay distinct for learner navigation", () => {
  const comingSoon = resolveCourseModuleAccess({
    configuration: { accessMode: "coming_soon" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  assert.equal(comingSoon.listed, true);
  assert.equal(comingSoon.canOpen, false);
  assert.equal(comingSoon.state, "coming_soon");

  const hidden = resolveCourseModuleAccess({
    configuration: { accessMode: "hidden" },
    accessAnchor: anchor,
    previousModuleCompleted: true,
  });
  assert.equal(hidden.listed, false);
  assert.equal(hidden.canOpen, false);
  assert.equal(hidden.state, "hidden");
});
