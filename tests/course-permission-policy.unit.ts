import assert from "node:assert/strict";
import test from "node:test";

import {
  consolidateCoursePermissionRequirements,
  coursePermissionAllows,
  resolveCoursePermission,
  type CoursePermission,
  type CoursePermissionRole,
} from "@/lib/course-permission-policy";

const permissions = ["view", "edit", "manage"] as const;

test("owner and admin always resolve to manage", () => {
  for (const role of ["owner", "admin"] as const) {
    for (const explicit of [null, ...permissions] as const) {
      assert.equal(resolveCoursePermission(role, explicit), "manage");
    }
  }
});

test("trainer receives exactly the explicit course permission", () => {
  assert.equal(resolveCoursePermission("trainer", null), null);
  for (const explicit of permissions) {
    assert.equal(resolveCoursePermission("trainer", explicit), explicit);
  }
});

test("member never receives an administrative course permission", () => {
  for (const explicit of [null, ...permissions] as const) {
    assert.equal(resolveCoursePermission("member", explicit), null);
  }
});

test("course permissions are monotonic and deny missing grants", () => {
  const expected: Record<
    CoursePermission | "none",
    Record<CoursePermission, boolean>
  > = {
    none: { view: false, edit: false, manage: false },
    view: { view: true, edit: false, manage: false },
    edit: { view: true, edit: true, manage: false },
    manage: { view: true, edit: true, manage: true },
  };

  for (const actual of [null, ...permissions] as const) {
    for (const required of permissions) {
      assert.equal(
        coursePermissionAllows(actual, required),
        expected[actual ?? "none"][required],
        `${actual ?? "none"} -> ${required}`,
      );
    }
  }
});

test("multi-course requirements use deterministic UUID order and the strongest permission", () => {
  assert.deepEqual(
    consolidateCoursePermissionRequirements([
      { courseId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB", required: "view" },
      { courseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", required: "edit" },
      { courseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", required: "manage" },
      { courseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", required: "view" },
    ]),
    [
      { courseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", required: "edit" },
      { courseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", required: "manage" },
    ],
  );
});

test("the complete role matrix preserves the course ACL contract", () => {
  const roles: CoursePermissionRole[] = ["owner", "admin", "trainer", "member"];
  for (const role of roles) {
    for (const explicit of [null, ...permissions] as const) {
      const resolved = resolveCoursePermission(role, explicit);
      assert.equal(
        coursePermissionAllows(resolved, "manage"),
        role === "owner" ||
          role === "admin" ||
          (role === "trainer" && explicit === "manage"),
      );
    }
  }
});
