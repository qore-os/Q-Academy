export const COMMUNITY_LEVEL_MIN_COUNT = 1;
export const COMMUNITY_LEVEL_MAX_COUNT = 100;
export const COMMUNITY_LEVEL_MIN_POSITION = 1;
export const COMMUNITY_LEVEL_MAX_POSITION = 100;
export const COMMUNITY_LEVEL_MAX_MIN_POINTS = 2_147_483_647;
export const COMMUNITY_LEVEL_MAX_NAME_CHARACTERS = 160;
export const COMMUNITY_LEVEL_MAX_DESCRIPTION_CHARACTERS = 5_000;
export const COMMUNITY_LEVEL_MAX_ICON_CHARACTERS = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

export type CommunityLevelDto = Readonly<{
  id: string;
  position: number;
  name: string;
  description: string;
  minPoints: number;
  icon: string;
  color: string;
  active: boolean;
}>;

export type CommunityLevelConfigurationDto = Readonly<{
  enabled: boolean;
  levels: readonly CommunityLevelDto[];
}>;

export type CommunityLevelValidationField =
  | "levels"
  | "id"
  | "position"
  | "name"
  | "description"
  | "minPoints"
  | "icon"
  | "color"
  | "active";

export type CommunityLevelValidationCode =
  | "level_count"
  | "invalid_id"
  | "invalid_position"
  | "duplicate_position"
  | "invalid_name"
  | "invalid_description"
  | "invalid_min_points"
  | "duplicate_min_points"
  | "invalid_icon"
  | "invalid_color"
  | "invalid_active"
  | "missing_active_zero_level";

export type CommunityLevelValidationIssue = Readonly<{
  code: CommunityLevelValidationCode;
  field: CommunityLevelValidationField;
  index: number | null;
}>;

export type CommunityLevelValidationResult = Readonly<{
  valid: boolean;
  issues: readonly CommunityLevelValidationIssue[];
}>;

export type CommunityLevelProgressStatus =
  "active" | "disabled" | "unavailable" | "invalid";

export type CommunityLevelProgressDto = Readonly<{
  status: CommunityLevelProgressStatus;
  enabled: boolean;
  communityPoints: number;
  current: CommunityLevelDto | null;
  next: CommunityLevelDto | null;
  pointsRemaining: number | null;
  progress: number | null;
  validationIssues: readonly CommunityLevelValidationIssue[];
}>;

function characterLengthWithin(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum * 2) return false;
  return Array.from(value).length <= maximum;
}

function trimmedCharacterLengthWithin(
  value: unknown,
  minimum: number,
  maximum: number,
) {
  if (!characterLengthWithin(value, maximum)) return false;
  const length = Array.from((value as string).trim()).length;
  return length >= minimum && length <= maximum;
}

function validationIssue(
  code: CommunityLevelValidationCode,
  field: CommunityLevelValidationField,
  index: number | null = null,
): CommunityLevelValidationIssue {
  return { code, field, index };
}

function validPosition(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value >= COMMUNITY_LEVEL_MIN_POSITION &&
    value <= COMMUNITY_LEVEL_MAX_POSITION
  );
}

function validMinPoints(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= COMMUNITY_LEVEL_MAX_MIN_POINTS
  );
}

export function sortActiveCommunityLevels(
  levels: readonly CommunityLevelDto[],
): CommunityLevelDto[] {
  if (levels.length > COMMUNITY_LEVEL_MAX_COUNT) {
    throw new RangeError(
      `Community levels must not exceed ${COMMUNITY_LEVEL_MAX_COUNT} entries.`,
    );
  }
  return levels
    .map((level, inputIndex) => ({ level, inputIndex }))
    .filter(({ level }) => level.active)
    .sort(
      (left, right) =>
        left.level.minPoints - right.level.minPoints ||
        left.level.position - right.level.position ||
        left.inputIndex - right.inputIndex,
    )
    .map(({ level }) => level);
}

export function validateCommunityLevelConfiguration(
  configuration: CommunityLevelConfigurationDto,
): CommunityLevelValidationResult {
  const issues: CommunityLevelValidationIssue[] = [];
  const levels = Array.isArray(configuration.levels)
    ? configuration.levels
    : [];
  if (
    levels.length < COMMUNITY_LEVEL_MIN_COUNT ||
    levels.length > COMMUNITY_LEVEL_MAX_COUNT
  ) {
    issues.push(validationIssue("level_count", "levels"));
  }

  const positions = new Map<number, number>();
  const thresholds = new Map<number, number>();
  let lowestActiveThreshold: number | null = null;
  const boundedLevels = levels.slice(0, COMMUNITY_LEVEL_MAX_COUNT + 1);
  for (const [index, level] of boundedLevels.entries()) {
    if (!level || typeof level !== "object") {
      issues.push(validationIssue("invalid_id", "id", index));
      continue;
    }
    if (
      typeof level.id !== "string" ||
      level.id.length !== 36 ||
      !UUID_PATTERN.test(level.id)
    ) {
      issues.push(validationIssue("invalid_id", "id", index));
    }
    if (!validPosition(level.position)) {
      issues.push(validationIssue("invalid_position", "position", index));
    } else if (positions.has(level.position)) {
      issues.push(validationIssue("duplicate_position", "position", index));
    } else {
      positions.set(level.position, index);
    }
    if (!validMinPoints(level.minPoints)) {
      issues.push(validationIssue("invalid_min_points", "minPoints", index));
    } else if (thresholds.has(level.minPoints)) {
      issues.push(validationIssue("duplicate_min_points", "minPoints", index));
    } else {
      thresholds.set(level.minPoints, index);
    }
    if (
      !trimmedCharacterLengthWithin(
        level.name,
        1,
        COMMUNITY_LEVEL_MAX_NAME_CHARACTERS,
      )
    ) {
      issues.push(validationIssue("invalid_name", "name", index));
    }
    if (
      !characterLengthWithin(
        level.description,
        COMMUNITY_LEVEL_MAX_DESCRIPTION_CHARACTERS,
      )
    ) {
      issues.push(validationIssue("invalid_description", "description", index));
    }
    if (
      !trimmedCharacterLengthWithin(
        level.icon,
        1,
        COMMUNITY_LEVEL_MAX_ICON_CHARACTERS,
      )
    ) {
      issues.push(validationIssue("invalid_icon", "icon", index));
    }
    if (typeof level.color !== "string" || !COLOR_PATTERN.test(level.color)) {
      issues.push(validationIssue("invalid_color", "color", index));
    }
    if (typeof level.active !== "boolean") {
      issues.push(validationIssue("invalid_active", "active", index));
    } else if (level.active && validMinPoints(level.minPoints)) {
      lowestActiveThreshold =
        lowestActiveThreshold === null
          ? level.minPoints
          : Math.min(lowestActiveThreshold, level.minPoints);
    }
  }
  if (lowestActiveThreshold !== 0) {
    issues.push(validationIssue("missing_active_zero_level", "minPoints"));
  }

  return { valid: issues.length === 0, issues };
}

function assertCommunityPoints(communityPoints: number) {
  if (!Number.isSafeInteger(communityPoints) || communityPoints < 0) {
    throw new RangeError(
      "Community points must be a nonnegative safe integer.",
    );
  }
}

function emptyProgress(input: {
  status: Exclude<CommunityLevelProgressStatus, "active">;
  enabled: boolean;
  communityPoints: number;
  validationIssues?: readonly CommunityLevelValidationIssue[];
}): CommunityLevelProgressDto {
  return {
    status: input.status,
    enabled: input.enabled,
    communityPoints: input.communityPoints,
    current: null,
    next: null,
    pointsRemaining: null,
    progress: null,
    validationIssues: input.validationIssues ?? [],
  };
}

function progressWithinLevel(
  communityPoints: number,
  current: CommunityLevelDto,
  next: CommunityLevelDto | null,
) {
  if (!next) return 100;
  const span = next.minPoints - current.minPoints;
  const progress = ((communityPoints - current.minPoints) / span) * 100;
  return Math.min(100, Math.max(0, Math.round(progress * 100) / 100));
}

export function resolveCommunityLevelProgress(input: {
  configuration: CommunityLevelConfigurationDto;
  communityPoints: number;
}): CommunityLevelProgressDto {
  assertCommunityPoints(input.communityPoints);
  if (!input.configuration.enabled) {
    return emptyProgress({
      status: "disabled",
      enabled: false,
      communityPoints: input.communityPoints,
    });
  }
  const hasActiveLevel = input.configuration.levels
    .slice(0, COMMUNITY_LEVEL_MAX_COUNT + 1)
    .some((level) => level?.active === true);
  if (!hasActiveLevel) {
    const validation = validateCommunityLevelConfiguration(input.configuration);
    return emptyProgress({
      status: "unavailable",
      enabled: true,
      communityPoints: input.communityPoints,
      validationIssues: validation.issues,
    });
  }
  const validation = validateCommunityLevelConfiguration(input.configuration);
  if (!validation.valid) {
    return emptyProgress({
      status: "invalid",
      enabled: true,
      communityPoints: input.communityPoints,
      validationIssues: validation.issues,
    });
  }

  const activeLevels = input.configuration.levels.filter(
    (level) => level.active,
  );
  const sorted = sortActiveCommunityLevels(activeLevels);
  let currentIndex = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.minPoints > input.communityPoints) break;
    currentIndex = index;
  }
  const current = sorted[currentIndex]!;
  const next = sorted[currentIndex + 1] ?? null;
  return {
    status: "active",
    enabled: true,
    communityPoints: input.communityPoints,
    current,
    next,
    pointsRemaining: next
      ? Math.max(0, next.minPoints - input.communityPoints)
      : 0,
    progress: progressWithinLevel(input.communityPoints, current, next),
    validationIssues: [],
  };
}
