import assert from "node:assert/strict";
import test from "node:test";
import {
  TEAM_PERMISSION_KEYS,
  defaultTeamPermissions,
  resolveTeamPermissions,
  teamPermissionAllows,
  teamRoleCreateSchema,
} from "@/lib/team-permission-policy";

test("owner permissions are immutable and always complete", () => {
  assert.deepEqual(
    resolveTeamPermissions({
      baseRole: "owner",
      assignmentExists: true,
      customRoleActive: false,
      customPermissions: [],
    }),
    [...TEAM_PERMISSION_KEYS],
  );
});

test("base roles preserve compatible defaults without a custom assignment", () => {
  assert.equal(defaultTeamPermissions("admin").includes("members.manage"), true);
  assert.equal(defaultTeamPermissions("admin").includes("integrations.view"), false);
  assert.equal(defaultTeamPermissions("admin").includes("api.manage"), true);
  assert.deepEqual(defaultTeamPermissions("member"), []);
  assert.equal(defaultTeamPermissions("trainer").includes("courses.manage"), true);
  assert.equal(defaultTeamPermissions("trainer").includes("analytics.view"), true);
  assert.equal(defaultTeamPermissions("trainer").includes("settings.view"), false);
});

test("an active custom role replaces admin defaults and manage implies view", () => {
  const permissions = resolveTeamPermissions({
    baseRole: "admin",
    assignmentExists: true,
    customRoleActive: true,
    customPermissions: ["integrations.manage", "analytics.view"],
  });
  assert.deepEqual(permissions, ["analytics.view", "integrations.manage"]);
  assert.equal(teamPermissionAllows(permissions, "integrations.view"), true);
  assert.equal(teamPermissionAllows(permissions, "members.view"), false);
});

test("inactive, missing and malformed assigned roles deny all permissions", () => {
  for (const input of [
    { customRoleActive: false, customPermissions: ["members.view"] },
    { customRoleActive: true, customPermissions: null },
    { customRoleActive: true, customPermissions: ["members.view", "root.all"] },
  ] as const) {
    assert.deepEqual(
      resolveTeamPermissions({
        baseRole: "admin",
        assignmentExists: true,
        ...input,
      }),
      [],
    );
  }
});

test("trainer assignments can restrict but never exceed trainer capabilities", () => {
  assert.deepEqual(
    resolveTeamPermissions({
      baseRole: "trainer",
      assignmentExists: true,
      customRoleActive: true,
      customPermissions: [
        "courses.view",
        "analytics.view",
        "community.manage",
        "integrations.manage",
      ],
    }),
    ["courses.view", "analytics.view"],
  );
});

test("role input rejects unknown and duplicate permission keys", () => {
  const base = {
    name: "Content Team",
    description: null,
    color: "#2b9188",
  };
  assert.equal(
    teamRoleCreateSchema.safeParse({
      ...base,
      permissions: ["courses.view", "courses.view"],
    }).success,
    false,
  );
  assert.equal(
    teamRoleCreateSchema.safeParse({ ...base, permissions: ["root.all"] }).success,
    false,
  );
});
