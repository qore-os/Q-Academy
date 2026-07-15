import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getMemberAdminActionCopy } from "../src/lib/i18n/member-admin-actions";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function shape(value: unknown): unknown {
  if (typeof value === "function") return "function";
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, shape(child)]),
    );
  }
  return typeof value;
}

function assertCopyValues(value: unknown, path: string): void {
  if (typeof value === "string") {
    assert.ok(value.trim().length > 0, `${path} must not be empty`);
    return;
  }
  if (typeof value === "function") {
    const rendered = (value as (...args: number[]) => string)(3, 2, 1);
    assert.ok(rendered.trim().length > 0, `${path} must render copy`);
    return;
  }
  assert.ok(value && typeof value === "object", `${path} must be structured copy`);
  for (const [key, child] of Object.entries(value)) {
    assertCopyValues(child, `${path}.${key}`);
  }
}

test("member administration action copy has complete locale parity", () => {
  const reference = shape(getMemberAdminActionCopy("de"));
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getMemberAdminActionCopy(locale);
    assert.deepEqual(shape(copy), reference);
    assertCopyValues(copy, locale);
  }
});

test("member actions expose stable codes instead of server error text", () => {
  const memberActions = readFileSync("src/lib/admin/member-actions.ts", "utf8");
  const importAndStatus = memberActions.slice(
    memberActions.indexOf("export async function importMembersCsvAdminAction"),
    memberActions.indexOf("export async function transferOrganizationOwnershipAdminAction"),
  );
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const invite = actions.slice(
    actions.indexOf("export async function createMemberAction"),
    actions.indexOf("export async function updateDesignAction"),
  );
  const table = readFileSync("src/components/admin/member-table.tsx", "utf8");

  assert.match(importAndStatus, /code: "complete"/);
  assert.match(importAndStatus, /code: "capacity"/);
  assert.doesNotMatch(importAndStatus, /error\.message/);
  assert.match(invite, /memberMessageCode: "inviteCreated"/);
  assert.doesNotMatch(invite, /error\.message/);
  assert.match(table, /getMemberAdminActionCopy\(locale\)/);
  assert.doesNotMatch(table, /state\.message|issue\.message|result\.message/);
});
