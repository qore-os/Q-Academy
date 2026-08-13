import assert from "node:assert/strict";
import test from "node:test";

import {
  courseModuleAccessConfigurationSchema,
  courseModuleAccessOverrideSchema,
  courseModuleAttachSchema,
  courseModuleAccessRequestCancelSchema,
  courseModuleAccessRequestCreateSchema,
  courseModuleAccessRequestDecisionSchema,
  courseModuleAccessRequestListQuerySchema,
  courseModuleUpdateSchema,
  lessonCreateSchema,
  lessonUpdateSchema,
} from "../src/lib/api/schemas";
import {
  canCreateModuleAccessRequest,
  canDecideModuleAccessRequest,
  isFutureWorkflowExpiry,
  isRepublishedAccessRequest,
} from "../src/lib/course-module-access-workflow-policy";

const lockedTarget = {
  state: "locked" as const,
  listed: true,
  requestable: true,
  requestStatus: null,
};

test("only a listed, locked and requestable target accepts a request", () => {
  assert.equal(canCreateModuleAccessRequest(lockedTarget), true);
  assert.equal(
    canCreateModuleAccessRequest({ ...lockedTarget, listed: false }),
    false,
  );
  assert.equal(
    canCreateModuleAccessRequest({ ...lockedTarget, state: "available" }),
    false,
  );
  assert.equal(
    canCreateModuleAccessRequest({
      ...lockedTarget,
      requestable: false,
      requestStatus: "pending",
    }),
    false,
  );
});

test("a decision requires the same current locked policy and pending request", () => {
  assert.equal(
    canDecideModuleAccessRequest(
      { ...lockedTarget, requestable: false, requestStatus: "pending" },
      true,
    ),
    true,
  );
  assert.equal(
    canDecideModuleAccessRequest(
      { ...lockedTarget, requestable: false, requestStatus: "pending" },
      false,
    ),
    false,
  );
  assert.equal(canDecideModuleAccessRequest(lockedTarget, true), false);
});

test("republishing after request makes the target stale and expiry is exclusive", () => {
  const requestedAt = new Date("2027-01-01T10:00:00.000Z");
  assert.equal(
    isRepublishedAccessRequest({
      requestedAt,
      publishedAt: new Date("2027-01-01T10:00:00.001Z"),
    }),
    true,
  );
  assert.equal(
    isRepublishedAccessRequest({ requestedAt, publishedAt: requestedAt }),
    false,
  );
  assert.equal(isFutureWorkflowExpiry(null, requestedAt), true);
  assert.equal(isFutureWorkflowExpiry(requestedAt, requestedAt), false);
  assert.equal(
    isFutureWorkflowExpiry(new Date("2027-01-01T10:00:00.001Z"), requestedAt),
    true,
  );
});

test("access workflow API schemas are strict and coerce ISO expiry dates", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    courseModuleAccessRequestCreateSchema.parse({ userId, message: " Bitte " }),
    { userId, message: "Bitte" },
  );
  assert.deepEqual(courseModuleAccessRequestCancelSchema.parse({ userId }), {
    userId,
  });
  assert.equal(
    courseModuleAccessRequestDecisionSchema
      .parse({
        actorId: userId,
        decision: "approved",
        expiresAt: "2027-01-02T10:00:00.000Z",
      })
      .expiresAt?.toISOString(),
    "2027-01-02T10:00:00.000Z",
  );
  assert.equal(
    courseModuleAccessOverrideSchema.parse({
      actorId: userId,
      state: "read_only",
    }).state,
    "read_only",
  );
  assert.equal(
    courseModuleAccessRequestListQuerySchema.parse({ status: "cancelled" })
      .status,
    "cancelled",
  );
  assert.equal(
    courseModuleAccessRequestCreateSchema.safeParse({
      userId,
      message: null,
      unexpected: true,
    }).success,
    false,
  );
});

test("course module API policy validates coherent modes without PATCH defaults", () => {
  const moduleId = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(courseModuleUpdateSchema.parse({}), {});
  assert.deepEqual(courseModuleAttachSchema.parse({ moduleId }), {
    moduleId,
    sortOrder: 0,
    indentLevel: 0,
    accessMode: "visible",
    dripDays: 0,
    delayPendingState: "locked",
    availableFrom: null,
    availableUntil: null,
    windowDefaultState: "locked",
    windowState: "available",
    requestAccessEnabled: false,
    isRequired: true,
  });
  const window = courseModuleAccessConfigurationSchema.parse({
    accessMode: "date_window",
    availableFrom: "2027-04-01T08:00:00.000Z",
    availableUntil: "2027-04-02T08:00:00.000Z",
  });
  assert.equal(window.availableFrom?.toISOString(), "2027-04-01T08:00:00.000Z");
  assert.equal(
    courseModuleAccessConfigurationSchema.safeParse({
      accessMode: "visible",
      dripDays: 2,
    }).success,
    false,
  );
  assert.equal(
    courseModuleAccessConfigurationSchema.safeParse({
      accessMode: "date_window",
    }).success,
    false,
  );
  assert.equal(
    courseModuleAccessConfigurationSchema.safeParse({
      accessMode: "date_window",
      availableFrom: "2027-04-02T08:00:00.000Z",
      availableUntil: "2027-04-01T08:00:00.000Z",
    }).success,
    false,
  );
});

test("lesson access fields are create-defaulted and update-explicit", () => {
  const created = lessonCreateSchema.parse({ title: "Neue Lektion" });
  assert.equal(created.visibility, "visible");
  assert.equal(created.dripDays, 0);
  assert.equal(created.unlockAfterPrevious, false);
  assert.deepEqual(
    lessonUpdateSchema.parse({
      visibility: "draft",
      dripDays: 3,
      unlockAfterPrevious: true,
    }),
    {
      visibility: "draft",
      dripDays: 3,
      unlockAfterPrevious: true,
    },
  );
});
