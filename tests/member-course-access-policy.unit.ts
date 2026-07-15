import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMemberCourseAccess,
  type BundleCourseAccessPolicy,
  type MemberCourseGrant,
} from "../src/lib/member-course-access-policy";

const courseId = "10000000-0000-4000-8000-000000000001";
const bundleId = "20000000-0000-4000-8000-000000000002";

function grant(
  source: string,
  grantedAt = new Date("2027-01-01T09:00:00.000Z"),
): MemberCourseGrant {
  return { courseId, source, grantedAt };
}

function policy(
  overrides: Partial<BundleCourseAccessPolicy> = {},
): BundleCourseAccessPolicy {
  return {
    bundleId,
    courseId,
    bundleActive: true,
    availableFrom: null,
    availableUntil: null,
    delayDays: 0,
    visible: true,
    ...overrides,
  };
}

test("legacy enrollments and non-bundle grants remain directly available", () => {
  assert.deepEqual(resolveMemberCourseAccess({ grants: [], policies: [] }), {
    state: "available",
    accessible: true,
    visible: true,
    availableAt: null,
    expiresAt: null,
    accessStartedAt: null,
  });

  const resolved = resolveMemberCourseAccess({
    grants: [
      grant(`member:30000000-0000-4000-8000-000000000003:bundle:${bundleId}`),
      grant("direct:40000000-0000-4000-8000-000000000004"),
    ],
    policies: [policy({ visible: false })],
  });
  assert.equal(resolved.state, "available");
  assert.equal(resolved.accessible, true);
  assert.equal(resolved.expiresAt, null);
});

test("active grant paths preserve their effective access start", () => {
  const directGrant = grant(
    "direct:40000000-0000-4000-8000-000000000004",
    new Date("2027-01-04T09:00:00.000Z"),
  );
  const direct = resolveMemberCourseAccess({
    grants: [directGrant],
    policies: [],
    now: new Date("2027-01-20T09:00:00.000Z"),
  });
  assert.equal(
    direct.accessStartedAt?.toISOString(),
    "2027-01-04T09:00:00.000Z",
  );

  const bundleGrant = grant(
    `member:30000000-0000-4000-8000-000000000003:bundle:${bundleId}`,
    new Date("2027-01-01T09:00:00.000Z"),
  );
  const bundled = resolveMemberCourseAccess({
    grants: [bundleGrant],
    policies: [
      policy({
        delayDays: 2,
        availableFrom: new Date("2027-01-05T09:00:00.000Z"),
      }),
    ],
    now: new Date("2027-01-20T09:00:00.000Z"),
  });
  assert.equal(
    bundled.accessStartedAt?.toISOString(),
    "2027-01-05T09:00:00.000Z",
  );
});

test("delay and absolute start combine using the later date", () => {
  const bundleGrant = grant(
    `group:50000000-0000-4000-8000-000000000005:bundle:${bundleId}`,
  );
  const bundlePolicy = policy({
    delayDays: 5,
    availableFrom: new Date("2027-01-10T09:00:00.000Z"),
    availableUntil: new Date("2027-02-01T09:00:00.000Z"),
  });
  const upcoming = resolveMemberCourseAccess({
    grants: [bundleGrant],
    policies: [bundlePolicy],
    now: new Date("2027-01-09T09:00:00.000Z"),
  });
  assert.equal(upcoming.state, "upcoming");
  assert.equal(upcoming.accessible, false);
  assert.equal(upcoming.visible, true);
  assert.equal(upcoming.availableAt?.toISOString(), "2027-01-10T09:00:00.000Z");

  const available = resolveMemberCourseAccess({
    grants: [bundleGrant],
    policies: [bundlePolicy],
    now: new Date("2027-01-10T09:00:00.000Z"),
  });
  assert.equal(available.state, "available");
  assert.equal(available.accessible, true);
});

test("an end date is exclusive and exposes a clear expired state", () => {
  const expiresAt = new Date("2027-02-01T09:00:00.000Z");
  const resolved = resolveMemberCourseAccess({
    grants: [grant(`member:30000000-0000-4000-8000-000000000003:bundle:${bundleId}`)],
    policies: [policy({ availableUntil: expiresAt })],
    now: expiresAt,
  });
  assert.equal(resolved.state, "expired");
  assert.equal(resolved.accessible, false);
  assert.equal(resolved.visible, true);
  assert.equal(resolved.expiresAt?.toISOString(), expiresAt.toISOString());
});

test("any currently available source wins over a locked bundle source", () => {
  const secondBundleId = "60000000-0000-4000-8000-000000000006";
  const resolved = resolveMemberCourseAccess({
    grants: [
      grant(`member:30000000-0000-4000-8000-000000000003:bundle:${bundleId}`),
      grant(`group:50000000-0000-4000-8000-000000000005:bundle:${secondBundleId}`),
    ],
    policies: [
      policy({ availableFrom: new Date("2027-03-01T09:00:00.000Z") }),
      policy({ bundleId: secondBundleId }),
    ],
    now: new Date("2027-01-15T09:00:00.000Z"),
  });
  assert.equal(resolved.state, "available");
  assert.equal(resolved.accessible, true);
});

test("hidden, inactive and stale bundle paths do not appear to learners", () => {
  const bundleGrant = grant(
    `member:30000000-0000-4000-8000-000000000003:bundle:${bundleId}`,
  );
  for (const policies of [
    [policy({ visible: false })],
    [policy({ bundleActive: false })],
    [],
  ]) {
    const resolved = resolveMemberCourseAccess({
      grants: [bundleGrant],
      policies,
    });
    assert.equal(resolved.state, "hidden");
    assert.equal(resolved.accessible, false);
    assert.equal(resolved.visible, false);
  }
});

test("a delay extending beyond the end date is visibly unavailable", () => {
  const resolved = resolveMemberCourseAccess({
    grants: [grant(`member:30000000-0000-4000-8000-000000000003:bundle:${bundleId}`)],
    policies: [
      policy({
        delayDays: 10,
        availableUntil: new Date("2027-01-05T09:00:00.000Z"),
      }),
    ],
    now: new Date("2027-01-02T09:00:00.000Z"),
  });
  assert.equal(resolved.state, "unavailable");
  assert.equal(resolved.accessible, false);
  assert.equal(resolved.visible, true);
});
