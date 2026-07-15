import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getTeamPermissionCopy,
  getTeamRoleCopy,
  resolveTeamRoleMessage,
} from "../src/lib/i18n/team-roles";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (typeof value === "function") result.set(prefix, String(value(2, 3)));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("team role copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getTeamRoleCopy("de"));
  assert.ok(german.size >= 65, `expected at least 65 leaves, got ${german.size}`);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getTeamRoleCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 58, `${locale} changes only ${changed}/${german.size}`);
    }
  }
});

test("permission keys receive localized labels without changing policy IDs", () => {
  assert.deepEqual(getTeamPermissionCopy("en", "members.manage"), {
    group: "Members",
    label: "Manage",
    description: "Invite and import members and manage their status.",
  });
  assert.equal(getTeamPermissionCopy("fr", "api.view").group, "Integrations");
  assert.equal(getTeamPermissionCopy("fr", "api.view").label, "Voir l'API");
});

test("team role actions resolve stable localized messages", () => {
  assert.equal(resolveTeamRoleMessage("de", "created"), "Team-Rolle wurde erstellt.");
  assert.equal(resolveTeamRoleMessage("en", "assigned"), "Team role assigned.");
  assert.equal(resolveTeamRoleMessage("es", "unassigned"), "Vuelven a aplicarse los permisos predeterminados.");
});

test("team role page and manager propagate locale and avoid raw action text", () => {
  const page = readFileSync(
    "src/app/(admin)/admin/settings/roles/page.tsx",
    "utf8",
  );
  const manager = readFileSync(
    "src/components/admin/team-role-manager.tsx",
    "utf8",
  );
  const actions = readFileSync("src/lib/admin/team-role-actions.ts", "utf8");

  assert.match(page, /resolveUserLocale\(owner\)/);
  assert.match(page, /TeamRoleManager[\s\S]{0,500}?locale=\{locale\}/);
  assert.match(manager, /getTeamPermissionCopy\(locale, item\.key\)/);
  assert.doesNotMatch(manager, />\{state\.message\}</);
  assert.doesNotMatch(manager, />Neue Team-Rolle</);
  assert.doesNotMatch(manager, /Custom-Rolle waehlen/);
  assert.ok((actions.match(/messageCode:/g) ?? []).length >= 7);
  assert.match(actions, /messageCode: "validation_failed"/);
});
