import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("team-role schema enforces composite tenant foreign keys", () => {
  const schema = source("src/db/schema.ts");
  assert.match(schema, /export const teamRoles = pgTable/);
  assert.match(schema, /team_role_assignments_role_tenant_fk/);
  assert.match(schema, /columns: \[table\.roleId, table\.organizationId\]/);
  assert.match(schema, /team_roles_permissions_check/);
});

test("admin navigation and all required areas use central permission gates", () => {
  const navigation = source("src/components/layout/navigation-shell.tsx");
  for (const permission of [
    "members.view",
    "courses.view",
    "community.view",
    "events.view",
    "analytics.view",
    "settings.view",
    "integrations.view",
    "ai.view",
  ]) {
    assert.match(navigation, new RegExp(permission.replace(".", "\\.")));
  }
  for (const area of [
    "members",
    "courses",
    "community",
    "events",
    "analytics",
    "settings",
    "integrations",
    "ai",
  ]) {
    assert.match(
      source(`src/app/(admin)/admin/${area}/layout.tsx`),
      /TeamPermissionBoundary/,
    );
  }
});

test("owner-only role UI and REST contract are wired end to end", () => {
  assert.match(source("src/app/(admin)/admin/settings/roles/page.tsx"), /requireOwner/);
  assert.match(source("src/components/admin/team-role-manager.tsx"), /TEAM_PERMISSION_DETAILS/);
  assert.match(source("src/lib/team-permissions.ts"), /target\.role === "owner"/);
  assert.match(source("src/lib/team-permissions.ts"), /lockOwner/);
  assert.match(source("src/lib/api/openapi.ts"), /\/team-roles\/\{id\}\/assignments/);
  assert.match(source("src/lib/api/scopes.ts"), /"team_roles:write"/);
  assert.match(source("src/app/api/v1/team-roles/route.ts"), /getOwnerActorForApiKey/);
});

test("critical mutations check manage permissions instead of relying on hidden UI", () => {
  const expectations: Array<[string, string]> = [
    ["src/lib/admin/event-actions.ts", "events.manage"],
    ["src/lib/commerce/admin-actions.ts", "integrations.manage"],
    ["src/lib/admin/ai-agent-studio-actions.ts", "ai.manage"],
    ["src/lib/admin/member-actions.ts", "members.manage"],
    ["src/lib/admin/custom-field-actions.ts", "settings.manage"],
  ];
  for (const [path, permission] of expectations) {
    assert.match(source(path), new RegExp(`requireTeamPermission\\(\"${permission.replace(".", "\\.")}\"\\)`));
  }
});

