import assert from "node:assert/strict";
import test from "node:test";

import { resolveMemberCourseModuleLink } from "../src/lib/member-course-link-policy";

const targetCourseId = "10000000-0000-4000-8000-000000000001";

test("link targets stay hidden without explicit member course access", () => {
  assert.deepEqual(
    resolveMemberCourseModuleLink({
      moduleKind: "link",
      linkedCourseId: targetCourseId,
      accessibleCourseSlugsById: new Map(),
    }),
    { visible: false, targetCourseSlug: null },
  );
});

test("authorized link targets expose only their member route slug", () => {
  assert.deepEqual(
    resolveMemberCourseModuleLink({
      moduleKind: "link",
      linkedCourseId: targetCourseId,
      accessibleCourseSlugsById: new Map([
        [targetCourseId, "prompt-engineering-masterclass"],
      ]),
    }),
    {
      visible: true,
      targetCourseSlug: "prompt-engineering-masterclass",
    },
  );
});

test("content modules remain visible without link metadata", () => {
  assert.deepEqual(
    resolveMemberCourseModuleLink({
      moduleKind: "learning",
      linkedCourseId: null,
      accessibleCourseSlugsById: new Map(),
    }),
    { visible: true, targetCourseSlug: null },
  );
});
