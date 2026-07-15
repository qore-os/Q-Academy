import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMUNITY_LEVEL_MAX_DESCRIPTION_CHARACTERS,
  COMMUNITY_LEVEL_MAX_ICON_CHARACTERS,
  COMMUNITY_LEVEL_MAX_MIN_POINTS,
  COMMUNITY_LEVEL_MAX_NAME_CHARACTERS,
  resolveCommunityLevelProgress,
  sortActiveCommunityLevels,
  validateCommunityLevelConfiguration,
  type CommunityLevelConfigurationDto,
  type CommunityLevelDto,
} from "../src/lib/community-level-domain";

function level(
  position: number,
  minPoints: number,
  overrides: Partial<CommunityLevelDto> = {},
): CommunityLevelDto {
  return {
    id: `10000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    position,
    name: `Level ${position}`,
    description: `Community-Level ${position}`,
    minPoints,
    icon: "award",
    color: "#d6a536",
    active: true,
    ...overrides,
  };
}

function configuration(
  levels: readonly CommunityLevelDto[],
  enabled = true,
): CommunityLevelConfigurationDto {
  return { enabled, levels };
}

test("active levels sort stably by threshold, position and original order", () => {
  const input = [
    level(3, 60),
    level(5, 30, { active: false }),
    level(2, 20),
    level(1, 0),
  ];
  const before = input.map((entry) => entry.id);
  const sorted = sortActiveCommunityLevels(input);

  assert.deepEqual(
    sorted.map((entry) => entry.minPoints),
    [0, 20, 60],
  );
  assert.deepEqual(
    input.map((entry) => entry.id),
    before,
  );

  const tied = [level(3, 20), level(2, 20), level(2, 20)];
  assert.deepEqual(sortActiveCommunityLevels(tied), [
    tied[1],
    tied[2],
    tied[0],
  ]);
});

test("valid configuration accepts every schema text and integer boundary", () => {
  const result = validateCommunityLevelConfiguration(
    configuration([
      level(1, 0, {
        name: "N".repeat(COMMUNITY_LEVEL_MAX_NAME_CHARACTERS),
        description: "D".repeat(COMMUNITY_LEVEL_MAX_DESCRIPTION_CHARACTERS),
        icon: "i".repeat(COMMUNITY_LEVEL_MAX_ICON_CHARACTERS),
        color: "#A1b2C3",
      }),
      level(100, COMMUNITY_LEVEL_MAX_MIN_POINTS),
    ]),
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("configuration rejects count, duplicate, ordering and schema-bound violations", () => {
  assert.deepEqual(
    validateCommunityLevelConfiguration(configuration([])).issues.map(
      (issue) => issue.code,
    ),
    ["level_count", "missing_active_zero_level"],
  );

  const invalid = validateCommunityLevelConfiguration(
    configuration([
      level(0, -1, {
        id: "not-a-uuid",
        name: " ",
        description: "x".repeat(COMMUNITY_LEVEL_MAX_DESCRIPTION_CHARACTERS + 1),
        icon: "x".repeat(COMMUNITY_LEVEL_MAX_ICON_CHARACTERS + 1),
        color: "d6a536",
      }),
      level(2, 20),
      level(2, 20),
    ]),
  );
  const codes = new Set(invalid.issues.map((issue) => issue.code));
  for (const expected of [
    "invalid_id",
    "invalid_position",
    "invalid_min_points",
    "invalid_name",
    "invalid_description",
    "invalid_icon",
    "invalid_color",
    "duplicate_position",
    "duplicate_min_points",
    "missing_active_zero_level",
  ]) {
    assert.equal(codes.has(expected as never), true, expected);
  }

  const tooMany = Array.from({ length: 101 }, (_, index) =>
    level((index % 100) + 1, index),
  );
  assert.equal(
    validateCommunityLevelConfiguration(configuration(tooMany)).issues.some(
      (issue) => issue.code === "level_count",
    ),
    true,
  );
});

test("disabled and missing-level states never manufacture a level", () => {
  const disabled = resolveCommunityLevelProgress({
    configuration: configuration([], false),
    communityPoints: 42,
  });
  assert.deepEqual(disabled, {
    status: "disabled",
    enabled: false,
    communityPoints: 42,
    current: null,
    next: null,
    pointsRemaining: null,
    progress: null,
    validationIssues: [],
  });

  const unavailable = resolveCommunityLevelProgress({
    configuration: configuration([]),
    communityPoints: 42,
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.current, null);
  assert.equal(unavailable.next, null);
  assert.equal(unavailable.pointsRemaining, null);
  assert.equal(unavailable.progress, null);
});

test("current, next, remaining points and progress follow the active threshold span", () => {
  const config = configuration([
    level(3, 60),
    level(1, 0),
    level(4, 30, { active: false }),
    level(2, 20),
  ]);
  const cases = [
    { points: 0, current: 0, next: 20, remaining: 20, progress: 0 },
    { points: 10, current: 0, next: 20, remaining: 10, progress: 50 },
    { points: 20, current: 20, next: 60, remaining: 40, progress: 0 },
    { points: 40, current: 20, next: 60, remaining: 20, progress: 50 },
    { points: 59, current: 20, next: 60, remaining: 1, progress: 97.5 },
  ];

  for (const expected of cases) {
    const result = resolveCommunityLevelProgress({
      configuration: config,
      communityPoints: expected.points,
    });
    assert.equal(result.status, "active");
    assert.equal(result.current?.minPoints, expected.current);
    assert.equal(result.next?.minPoints, expected.next);
    assert.equal(result.pointsRemaining, expected.remaining);
    assert.equal(result.progress, expected.progress);
  }

  const last = resolveCommunityLevelProgress({
    configuration: config,
    communityPoints: 60,
  });
  assert.equal(last.current?.minPoints, 60);
  assert.equal(last.next, null);
  assert.equal(last.pointsRemaining, 0);
  assert.equal(last.progress, 100);
});

test("invalid enabled configuration fails closed with structured issues", () => {
  const result = resolveCommunityLevelProgress({
    configuration: configuration([level(1, 10)]),
    communityPoints: 100,
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.current, null);
  assert.equal(result.next, null);
  assert.equal(result.progress, null);
  assert.equal(
    result.validationIssues.some(
      (issue) => issue.code === "missing_active_zero_level",
    ),
    true,
  );
});

test("very large safe points resolve to the last level without overflow", () => {
  const config = configuration([
    level(1, 0),
    level(2, COMMUNITY_LEVEL_MAX_MIN_POINTS),
  ]);
  const result = resolveCommunityLevelProgress({
    configuration: config,
    communityPoints: Number.MAX_SAFE_INTEGER,
  });

  assert.equal(result.status, "active");
  assert.equal(result.current?.minPoints, COMMUNITY_LEVEL_MAX_MIN_POINTS);
  assert.equal(result.next, null);
  assert.equal(result.pointsRemaining, 0);
  assert.equal(result.progress, 100);
  for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        resolveCommunityLevelProgress({
          configuration: config,
          communityPoints: invalid,
        }),
      RangeError,
    );
  }
});

test("deterministic threshold fuzz preserves the mathematical level invariant", () => {
  let state = 0x1e7e1;
  const nextRandom = () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state;
  };

  for (let sample = 0; sample < 500; sample += 1) {
    const count = 1 + (nextRandom() % 40);
    let threshold = 0;
    const levels = Array.from({ length: count }, (_, index) => {
      if (index > 0) threshold += 1 + (nextRandom() % 10_000);
      return level(index + 1, threshold);
    });
    for (let index = levels.length - 1; index > 0; index -= 1) {
      const swapIndex = nextRandom() % (index + 1);
      [levels[index], levels[swapIndex]] = [levels[swapIndex]!, levels[index]!];
    }
    const points =
      sample % 25 === 0
        ? Number.MAX_SAFE_INTEGER
        : nextRandom() % Math.max(1, threshold + 10_000);
    const config = configuration(levels);
    const result = resolveCommunityLevelProgress({
      configuration: config,
      communityPoints: points,
    });
    const expected = [...levels]
      .sort((left, right) => left.minPoints - right.minPoints)
      .filter((entry) => entry.minPoints <= points)
      .at(-1)!;

    assert.equal(result.status, "active");
    assert.equal(result.current?.id, expected.id);
    assert.ok(result.progress !== null && result.progress >= 0);
    assert.ok(result.progress !== null && result.progress <= 100);
    assert.ok(result.pointsRemaining !== null && result.pointsRemaining >= 0);
  }
});
