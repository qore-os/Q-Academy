import assert from "node:assert/strict";
import test from "node:test";

import {
  announcementTargetRuleSetSchema,
  matchesAnnouncementTargetRules,
  type AnnouncementAudienceContext,
} from "../src/lib/announcement-rules";

const COURSE_ID = "b405d9a4-bf42-436d-81c8-157f1113484a";

function context(
  overrides: Partial<AnnouncementAudienceContext> = {},
): AnnouncementAudienceContext {
  return {
    role: "member",
    knownGroupIds: new Set([
      "0a5796c6-a458-45a9-8339-c770f848666d",
      "2425e31f-6183-4136-8552-ea4359dfbf35",
    ]),
    knownBundleIds: new Set(["ac1e4310-c568-46f3-a42d-2c9782c6b538"]),
    knownCourseIds: new Set([
      COURSE_ID,
      "7c032110-74cc-4dbe-9019-13257433a276",
    ]),
    groupIds: new Set(["0a5796c6-a458-45a9-8339-c770f848666d"]),
    bundleIds: new Set(["ac1e4310-c568-46f3-a42d-2c9782c6b538"]),
    courseAccessIds: new Set([COURSE_ID]),
    courseProgress: new Map([[COURSE_ID, 72]]),
    ...overrides,
  };
}

test("announcement rules require the versioned AND contract", () => {
  assert.equal(
    announcementTargetRuleSetSchema.safeParse({
      version: 2,
      conjunction: "and",
      conditions: [],
    }).success,
    false,
  );
  assert.equal(
    announcementTargetRuleSetSchema.safeParse({
      version: 1,
      conjunction: "or",
      conditions: [],
    }).success,
    false,
  );
});

test("role, group, bundle, course access and progress rules use AND semantics", () => {
  const parsed = announcementTargetRuleSetSchema.parse({
    version: 1,
    conjunction: "and",
    conditions: [
      { type: "role", role: "member" },
      {
        type: "group",
        groupId: "0a5796c6-a458-45a9-8339-c770f848666d",
        match: "member",
      },
      {
        type: "bundle",
        bundleId: "ac1e4310-c568-46f3-a42d-2c9782c6b538",
        match: "member",
      },
      {
        type: "course_access",
        courseId: COURSE_ID,
        access: "granted",
      },
      {
        type: "course_progress",
        courseId: COURSE_ID,
        comparison: "between",
        percent: 50,
        maxPercent: 80,
      },
    ],
  });

  assert.equal(matchesAnnouncementTargetRules(parsed, context()), true);
  assert.equal(
    matchesAnnouncementTargetRules(
      parsed,
      context({ courseProgress: new Map([[COURSE_ID, 81]]) }),
    ),
    false,
  );
  assert.equal(
    matchesAnnouncementTargetRules(parsed, context({ groupIds: new Set() })),
    false,
  );
});

test("negative membership and missing progress are evaluated deterministically", () => {
  const parsed = announcementTargetRuleSetSchema.parse({
    version: 1,
    conjunction: "and",
    conditions: [
      {
        type: "group",
        groupId: "2425e31f-6183-4136-8552-ea4359dfbf35",
        match: "not_member",
      },
      {
        type: "course_access",
        courseId: "7c032110-74cc-4dbe-9019-13257433a276",
        access: "not_granted",
      },
      {
        type: "course_progress",
        courseId: "7c032110-74cc-4dbe-9019-13257433a276",
        comparison: "at_most",
        percent: 0,
        maxPercent: null,
      },
    ],
  });
  assert.equal(matchesAnnouncementTargetRules(parsed, context()), true);
  assert.equal(
    matchesAnnouncementTargetRules(
      parsed,
      context({ knownGroupIds: new Set(), groupIds: new Set() }),
    ),
    false,
  );
});

test("invalid progress ranges are rejected", () => {
  const parsed = announcementTargetRuleSetSchema.safeParse({
    version: 1,
    conjunction: "and",
    conditions: [
      {
        type: "course_progress",
        courseId: "7c032110-74cc-4dbe-9019-13257433a276",
        comparison: "between",
        percent: 70,
        maxPercent: 60,
      },
    ],
  });
  assert.equal(parsed.success, false);
});
