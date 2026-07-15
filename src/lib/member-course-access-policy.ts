const DAY_MS = 24 * 60 * 60_000;
const BUNDLE_SOURCE_PATTERN = /(?:^|:)bundle:([0-9a-f]{8}-[0-9a-f-]{27})$/i;

export type MemberCourseAccessState =
  | "available"
  | "upcoming"
  | "expired"
  | "unavailable"
  | "hidden";

export type MemberCourseAccess = {
  state: MemberCourseAccessState;
  accessible: boolean;
  visible: boolean;
  availableAt: Date | null;
  expiresAt: Date | null;
  accessStartedAt: Date | null;
};

export type MemberCourseGrant = {
  courseId: string;
  source: string;
  grantedAt: Date;
};

export type BundleCourseAccessPolicy = {
  bundleId: string;
  courseId: string;
  bundleActive: boolean;
  availableFrom: Date | null;
  availableUntil: Date | null;
  delayDays: number;
  visible: boolean;
};

function latestExpiry(values: Array<Date | null>) {
  const dates = values.filter((value): value is Date => value !== null);
  if (dates.length !== values.length) return null;
  return dates.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest,
  );
}

function latestPresentDate(values: Array<Date | null>) {
  const dates = values.filter((value): value is Date => value !== null);
  if (!dates.length) return null;
  return dates.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest,
  );
}

function earliestDate(values: Array<Date | null>) {
  const dates = values.filter((value): value is Date => value !== null);
  if (!dates.length) return null;
  return dates.reduce((earliest, value) =>
    value.getTime() < earliest.getTime() ? value : earliest,
  );
}

function evaluateBundlePath(
  grant: MemberCourseGrant,
  policy: BundleCourseAccessPolicy,
  now: Date,
): MemberCourseAccess {
  if (!policy.bundleActive || !policy.visible) {
    return {
      state: "hidden",
      accessible: false,
      visible: false,
      availableAt: null,
      expiresAt: policy.availableUntil,
      accessStartedAt: null,
    };
  }

  const delayedUntil =
    policy.delayDays > 0
      ? new Date(grant.grantedAt.getTime() + policy.delayDays * DAY_MS)
      : null;
  const availableAt = latestPresentDate([
    policy.availableFrom,
    delayedUntil,
  ]);
  const expiresAt = policy.availableUntil;

  if (
    availableAt &&
    expiresAt &&
    availableAt.getTime() >= expiresAt.getTime()
  ) {
    return {
      state: "unavailable",
      accessible: false,
      visible: true,
      availableAt,
      expiresAt,
      accessStartedAt: null,
    };
  }
  if (expiresAt && now.getTime() >= expiresAt.getTime()) {
    return {
      state: "expired",
      accessible: false,
      visible: true,
      availableAt,
      expiresAt,
      accessStartedAt: null,
    };
  }
  if (availableAt && now.getTime() < availableAt.getTime()) {
    return {
      state: "upcoming",
      accessible: false,
      visible: true,
      availableAt,
      expiresAt,
      accessStartedAt: null,
    };
  }
  return {
    state: "available",
    accessible: true,
    visible: true,
    availableAt,
    expiresAt,
    accessStartedAt: availableAt ?? grant.grantedAt,
  };
}

export function resolveMemberCourseAccess(input: {
  grants: MemberCourseGrant[];
  policies: BundleCourseAccessPolicy[];
  now?: Date;
}): MemberCourseAccess {
  const now = input.now ?? new Date();
  if (!input.grants.length) {
    // Legacy active enrollments predate source grants and remain direct access.
    return {
      state: "available",
      accessible: true,
      visible: true,
      availableAt: null,
      expiresAt: null,
      accessStartedAt: null,
    };
  }

  const policies = new Map(
    input.policies.map((policy) => [
      `${policy.bundleId}:${policy.courseId}`,
      policy,
    ]),
  );
  const paths: MemberCourseAccess[] = [];
  for (const grant of input.grants) {
    const bundleId = BUNDLE_SOURCE_PATTERN.exec(grant.source)?.[1];
    if (!bundleId) {
      paths.push({
        state: "available",
        accessible: true,
        visible: true,
        availableAt: null,
        expiresAt: null,
        accessStartedAt: grant.grantedAt,
      });
      continue;
    }
    const policy = policies.get(`${bundleId}:${grant.courseId}`);
    if (policy) paths.push(evaluateBundlePath(grant, policy, now));
  }

  const available = paths.filter((path) => path.state === "available");
  if (available.length) {
    return {
      state: "available",
      accessible: true,
      visible: true,
      availableAt: earliestDate(available.map((path) => path.availableAt)),
      expiresAt: latestExpiry(available.map((path) => path.expiresAt)),
      accessStartedAt: earliestDate(
        available.map((path) => path.accessStartedAt),
      ),
    };
  }
  const upcoming = paths
    .filter((path) => path.state === "upcoming")
    .sort(
      (left, right) =>
        (left.availableAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.availableAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    );
  if (upcoming[0]) return upcoming[0];
  const unavailable = paths.find((path) => path.state === "unavailable");
  if (unavailable) return unavailable;
  const expired = paths
    .filter((path) => path.state === "expired")
    .sort(
      (left, right) =>
        (right.expiresAt?.getTime() ?? 0) - (left.expiresAt?.getTime() ?? 0),
    );
  if (expired[0]) return expired[0];
  return {
    state: "hidden",
    accessible: false,
    visible: false,
    availableAt: null,
    expiresAt: null,
    accessStartedAt: null,
  };
}
