import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isMfaProtectedRole,
  MFA_PROTECTED_ROLES,
} from "@/lib/mfa/roles";
import { getMfaCopy } from "@/lib/i18n/mfa";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";

test("MFA covers every staff role and excludes member accounts", () => {
  assert.deepEqual(MFA_PROTECTED_ROLES, ["owner", "admin", "trainer"]);
  assert.equal(isMfaProtectedRole("owner"), true);
  assert.equal(isMfaProtectedRole("admin"), true);
  assert.equal(isMfaProtectedRole("trainer"), true);
  assert.equal(isMfaProtectedRole("member"), false);
});

test("staff MFA scope is shared by sessions, login, management, and policy", () => {
  const auth = readFileSync("src/lib/auth.ts", "utf8");
  const login = readFileSync("src/lib/mfa/login-challenge.ts", "utf8");
  const management = readFileSync(
    "src/lib/mfa/management-actions.ts",
    "utf8",
  );
  const queries = readFileSync("src/lib/mfa/queries.ts", "utf8");

  assert.match(auth, /isMfaProtectedRole\(payload\.role\)/);
  assert.ok(
    (login.match(/isMfaProtectedRole\(/g) ?? []).length >= 4,
    "all login challenge revalidation stages must use the shared role policy",
  );
  assert.match(management, /account\.role in \('owner', 'admin', 'trainer'\)/);
  assert.match(queries, /inArray\(users\.role, MFA_PROTECTED_ROLES\)/);
});

test("MFA policy copy describes the complete staff scope in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getMfaCopy(locale);
    assert.ok(copy.policy.description.length > 0);
    assert.ok(copy.messages.privilegedOnly.length > 0);
    assert.ok(copy.messages.policyEnabled.length > 0);
    assert.doesNotMatch(
      copy.policy.description,
      /owners? and administrators?$|Owner und Administratoren$/i,
    );
  }
});
