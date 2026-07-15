export const COURSE_MODULE_ACCESS_MODES = [
  "visible",
  "after_previous",
  "delay_days",
  "date_window",
  "coming_soon",
  "locked",
  "hidden",
] as const;

export type CourseModuleAccessMode =
  (typeof COURSE_MODULE_ACCESS_MODES)[number];

export const COURSE_MODULE_OVERRIDE_STATES = [
  "available",
  "read_only",
  "locked",
  "hidden",
] as const;

export type CourseModuleOverrideState =
  (typeof COURSE_MODULE_OVERRIDE_STATES)[number];

export type LearningAccessState =
  | "available"
  | "read_only"
  | "upcoming"
  | "coming_soon"
  | "locked"
  | "hidden";

export type LearningAccessReason =
  | "module_delay"
  | "previous_module"
  | "date_not_started"
  | "date_expired"
  | "coming_soon"
  | "manually_locked"
  | "manually_hidden"
  | "override_available"
  | "override_read_only"
  | "override_locked"
  | "override_hidden"
  | "invalid_configuration"
  | "window_policy"
  | "section_drip"
  | "previous_section"
  | "previous_lesson"
  | "lesson_schedule"
  | "active_exam";

export type LearningAccessLock = {
  reason: LearningAccessReason;
  availableAt: string | null;
};

export type LearningItemAccess = {
  state: LearningAccessState;
  listed: boolean;
  canOpen: boolean;
  canInteract: boolean;
  requestable: boolean;
  availableAt: string | null;
  reasons: LearningAccessReason[];
  requestStatus: "pending" | "approved" | "rejected" | null;
  accessible: boolean;
  locks: LearningAccessLock[];
};

export type CourseModuleAccessConfiguration = {
  accessMode?: CourseModuleAccessMode | null;
  dripDays?: number | null;
  delayPendingState?: CourseModuleOverrideState | null;
  availableFrom?: string | Date | null;
  availableUntil?: string | Date | null;
  windowDefaultState?: CourseModuleOverrideState | null;
  windowState?: CourseModuleOverrideState | null;
  requestAccessEnabled?: boolean | null;
};

export type CourseModuleAccessOverride = {
  state: CourseModuleOverrideState;
  expiresAt?: string | Date | null;
};

export function nextPreviousListedModuleCompleted(input: {
  previousCompleted: boolean;
  moduleKind: "learning" | "exam" | "link";
  moduleListed: boolean;
  moduleLessonsCompleted: boolean;
}) {
  if (!input.moduleListed || input.moduleKind === "link") {
    return input.previousCompleted;
  }
  return input.moduleLessonsCompleted;
}

export function resolveCourseLearningAccessAnchor(input: {
  firstPublishedAt: Date;
  enrolledAt: Date;
  courseAccessStartedAt?: Date | null;
}) {
  const sourceStartedAt = input.courseAccessStartedAt ?? input.enrolledAt;
  return new Date(
    Math.max(sourceStartedAt.getTime(), input.firstPublishedAt.getTime()),
  );
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

function validDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number | null | undefined) {
  return new Date(
    date.getTime() + Math.max(0, days ?? 0) * DAY_IN_MILLISECONDS,
  );
}

function result(
  state: LearningAccessState,
  input: {
    reasons?: LearningAccessReason[];
    availableAt?: Date | null;
    requestable?: boolean;
    requestStatus?: LearningItemAccess["requestStatus"];
  } = {},
): LearningItemAccess {
  const listed = state !== "hidden";
  const canOpen = state === "available" || state === "read_only";
  const canInteract = state === "available";
  const availableAt = input.availableAt?.toISOString() ?? null;
  const reasons = [...new Set(input.reasons ?? [])];
  return {
    state,
    listed,
    canOpen,
    canInteract,
    requestable: Boolean(input.requestable),
    availableAt,
    reasons,
    requestStatus: input.requestStatus ?? null,
    accessible: canOpen,
    locks: reasons.map((reason) => ({ reason, availableAt })),
  };
}

export function learningAccessForState(
  state: LearningAccessState,
  input: {
    reasons?: LearningAccessReason[];
    availableAt?: Date | null;
    requestable?: boolean;
    requestStatus?: LearningItemAccess["requestStatus"];
  } = {},
) {
  return result(state, input);
}

function configuredState(
  state: CourseModuleOverrideState,
  input: {
    reason: LearningAccessReason;
    availableAt?: Date | null;
    requestAccessEnabled?: boolean | null;
    requestStatus?: LearningItemAccess["requestStatus"];
  },
) {
  const requestable =
    state === "locked" &&
    Boolean(input.requestAccessEnabled) &&
    input.requestStatus !== "pending";
  return result(state, {
    reasons: [input.reason],
    availableAt: input.availableAt,
    requestable,
    requestStatus: input.requestStatus,
  });
}

function activeOverride(
  override: CourseModuleAccessOverride | null | undefined,
  now: Date,
) {
  if (!override) return null;
  const expiresAt = validDate(override.expiresAt);
  return expiresAt && expiresAt.getTime() <= now.getTime() ? null : override;
}

export function inferCourseModuleAccessMode(
  configuration: CourseModuleAccessConfiguration,
): CourseModuleAccessMode {
  if (configuration.accessMode) return configuration.accessMode;
  return (configuration.dripDays ?? 0) > 0 ? "delay_days" : "visible";
}

export function resolveCourseModuleAccess(input: {
  configuration: CourseModuleAccessConfiguration;
  accessAnchor: Date;
  previousModuleCompleted: boolean;
  override?: CourseModuleAccessOverride | null;
  requestStatus?: LearningItemAccess["requestStatus"];
  now?: Date;
}): LearningItemAccess {
  const now = input.now ?? new Date();
  const override = activeOverride(input.override, now);
  if (override) {
    if (override.state === "available") {
      return result("available", {
        reasons: ["override_available"],
        requestStatus: input.requestStatus,
      });
    }
    if (override.state === "read_only") {
      return result("read_only", {
        reasons: ["override_read_only"],
        requestStatus: input.requestStatus,
      });
    }
    if (override.state === "locked") {
      return result("locked", {
        reasons: ["override_locked"],
        requestStatus: input.requestStatus,
      });
    }
    return result("hidden", {
      reasons: ["override_hidden"],
      requestStatus: input.requestStatus,
    });
  }

  const mode = inferCourseModuleAccessMode(input.configuration);
  if (mode === "visible") {
    return result("available", { requestStatus: input.requestStatus });
  }
  if (mode === "after_previous") {
    return input.previousModuleCompleted
      ? result("available", { requestStatus: input.requestStatus })
      : result("locked", {
          reasons: ["previous_module"],
          requestStatus: input.requestStatus,
        });
  }
  if (mode === "delay_days") {
    const availableAt = addDays(
      input.accessAnchor,
      input.configuration.dripDays,
    );
    if (availableAt.getTime() <= now.getTime()) {
      return result("available", { requestStatus: input.requestStatus });
    }
    const pendingState = input.configuration.delayPendingState ?? "locked";
    if (pendingState !== "locked" && pendingState !== "hidden") {
      return result("hidden", { reasons: ["invalid_configuration"] });
    }
    return configuredState(pendingState, {
      reason: "module_delay",
      availableAt,
      requestAccessEnabled: input.configuration.requestAccessEnabled,
      requestStatus: input.requestStatus,
    });
  }
  if (mode === "date_window") {
    const hasInvalidStart =
      Boolean(input.configuration.availableFrom) &&
      !validDate(input.configuration.availableFrom);
    const hasInvalidEnd =
      Boolean(input.configuration.availableUntil) &&
      !validDate(input.configuration.availableUntil);
    if (hasInvalidStart || hasInvalidEnd) {
      return result("hidden", { reasons: ["invalid_configuration"] });
    }
    const availableFrom = validDate(input.configuration.availableFrom);
    const availableUntil = validDate(input.configuration.availableUntil);
    const before = Boolean(availableFrom && availableFrom > now);
    const after = Boolean(availableUntil && availableUntil <= now);
    const insideWindow = !before && !after;
    const state = insideWindow
      ? (input.configuration.windowState ?? "available")
      : (input.configuration.windowDefaultState ?? "locked");
    return configuredState(state, {
      reason: insideWindow
        ? "window_policy"
        : before
          ? "date_not_started"
          : "date_expired",
      availableAt: before ? availableFrom : null,
      requestAccessEnabled: input.configuration.requestAccessEnabled,
      requestStatus: input.requestStatus,
    });
  }
  if (mode === "coming_soon") {
    return result("coming_soon", {
      reasons: ["coming_soon"],
      requestStatus: input.requestStatus,
    });
  }
  if (mode === "locked") {
    const requestable =
      Boolean(input.configuration.requestAccessEnabled) &&
      input.requestStatus !== "pending";
    return result("locked", {
      reasons: ["manually_locked"],
      requestable,
      requestStatus: input.requestStatus,
    });
  }
  return result("hidden", {
    reasons: ["manually_hidden"],
    requestStatus: input.requestStatus,
  });
}

export function combineLearningAccess(
  own: LearningItemAccess,
  parent: LearningItemAccess,
): LearningItemAccess {
  const reasons = [...new Set([...parent.reasons, ...own.reasons])];
  const availableDates = [parent.availableAt, own.availableAt]
    .flatMap((value) => {
      const date = validDate(value);
      return date ? [date] : [];
    });
  const availableAt = availableDates.length
    ? new Date(Math.max(...availableDates.map((date) => date.getTime())))
    : null;

  if (!parent.listed || !own.listed) {
    return result("hidden", { reasons, requestStatus: own.requestStatus });
  }
  if (!parent.canOpen) {
    return result(parent.state, {
      reasons,
      availableAt,
      requestable: parent.requestable,
      requestStatus: parent.requestStatus ?? own.requestStatus,
    });
  }
  if (!own.canOpen) {
    return result(own.state, {
      reasons,
      availableAt,
      requestable: own.requestable,
      requestStatus: own.requestStatus,
    });
  }
  if (!parent.canInteract || !own.canInteract) {
    return result("read_only", {
      reasons,
      requestStatus: own.requestStatus,
    });
  }
  return result("available", { reasons, requestStatus: own.requestStatus });
}

export function accessFromLegacyLocks(
  locks: LearningAccessLock[],
): LearningItemAccess {
  if (!locks.length) return result("available");
  const availableDates = locks.flatMap((lock) => {
    const parsed = validDate(lock.availableAt);
    return parsed ? [parsed] : [];
  });
  const availableAt = availableDates.length
    ? new Date(Math.max(...availableDates.map((date) => date.getTime())))
    : null;
  return result("locked", {
    reasons: locks.map((lock) => lock.reason),
    availableAt,
  });
}
