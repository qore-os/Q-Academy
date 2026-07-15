import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exportedAsyncFunctions(value: string) {
  return [...value.matchAll(/export async function (\w+)/g)].map(
    (match) => match[1],
  );
}

function functionBlock(value: string, name: string) {
  const start = value.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `Missing ${name}.`);
  const next = value.indexOf("export async function ", start + 1);
  return value.slice(start, next < 0 ? value.length : next);
}

function assertOrdered(value: string, labels: Array<[string, string]>) {
  let previous = -1;
  for (const [label, token] of labels) {
    const position = value.indexOf(token, previous + 1);
    assert.ok(position > previous, `${label} is missing or out of order.`);
    previous = position;
  }
}

test("MFA reads stay out of the Server Action manifest boundary", () => {
  const actions = source("src/lib/mfa/management-actions.ts");
  const queries = source("src/lib/mfa/queries.ts");
  assert.match(actions, /^"use server";/);
  assert.doesNotMatch(
    actions,
    /getOwnMfaState|getOrganizationMfaPolicyState/,
  );
  assert.deepEqual(exportedAsyncFunctions(actions), [
    "beginOwnMfaEnrollmentAction",
    "confirmOwnMfaEnrollmentAction",
    "regenerateOwnMfaRecoveryCodesAction",
    "disableOwnMfaAction",
    "updateOrganizationMfaPolicyAction",
  ]);
  assert.match(queries, /^import "server-only";/);
  assert.doesNotMatch(queries, /["']use server["']/);
  assert.deepEqual(exportedAsyncFunctions(queries), [
    "getOwnMfaState",
    "getOrganizationMfaPolicyState",
  ]);
  assert.match(
    source("src/app/(member)/academy/profile/page.tsx"),
    /getOwnMfaState } from "@\/lib\/mfa\/queries"/,
  );
  assert.match(
    source("src/app/(admin)/admin/settings/page.tsx"),
    /getOrganizationMfaPolicyState,[\s\S]{0,80}?getOwnMfaState,[\s\S]{0,80}?from "@\/lib\/mfa\/queries"/,
  );
});

test("MFA primary proof is rebound under the canonical lock order", () => {
  const security = source("src/lib/mfa/management-security.ts");
  assertOrdered(security, [
    ["per-user advisory lock", "acquireMfaUserAdvisoryLock"],
    ["OIDC advisory lock", "lockOidcConfiguration"],
    ["OIDC configuration lock", ".from(oidcConfigurations)"],
    ["OIDC configuration share mode", '.for("share")'],
    ["user row lock", ".from(users)"],
    ["user update mode", '.for("update")'],
    ["password snapshot binding", "lockedActor.passwordHash !== input.proof.passwordHash"],
    ["OIDC session revalidation", ".from(userSessions)"],
    ["OIDC session update lock", '.for("update")'],
  ]);
  assert.match(security, /lockedActor\.status !== "active"/);
  assert.match(security, /lockedActor\.role === "owner"/);
  assert.match(security, /isMfaProtectedRole\(lockedActor\.role\)/);
  for (const binding of [
    "input.proof.sessionId",
    "lockedActor.organizationId",
    "lockedActor.id",
    'userSessions.authMethod, "oidc"',
    "isNull(userSessions.revokedAt)",
    "gt(userSessions.expiresAt, input.now)",
    "gt(userSessions.authenticatedAt, recentCutoff)",
    "gt(userSessions.oidcAuthTime, recentCutoff)",
  ]) {
    assert.ok(security.includes(binding), `Missing OIDC binding: ${binding}`);
  }
});

test("all MFA mutations lock user then configuration then policy then audit", () => {
  const actions = source("src/lib/mfa/management-actions.ts");
  for (const name of [
    "beginOwnMfaEnrollmentAction",
    "confirmOwnMfaEnrollmentAction",
    "regenerateOwnMfaRecoveryCodesAction",
    "disableOwnMfaAction",
    "updateOrganizationMfaPolicyAction",
  ]) {
    const block = functionBlock(actions, name);
    assertOrdered(block, [
      [`${name} actor lock`, "lockAndRevalidateMfaActor"],
      [`${name} MFA configuration lock`, ".from(userMfaConfigurations)"],
      [`${name} audit insert`, ".insert(activityEvents)"],
    ]);
  }
  for (const name of [
    "disableOwnMfaAction",
    "updateOrganizationMfaPolicyAction",
  ]) {
    const block = functionBlock(actions, name);
    assertOrdered(block, [
      [`${name} actor lock`, "lockAndRevalidateMfaActor"],
      [`${name} MFA configuration lock`, ".from(userMfaConfigurations)"],
      [`${name} policy lock`, ".from(organizationMfaPolicies)"],
      [`${name} audit insert`, ".insert(activityEvents)"],
    ]);
  }

  const login = source("src/lib/mfa/login-challenge.ts");
  for (const name of ["beginMfaLoginChallenge", "completeMfaLoginChallenge"]) {
    const block = functionBlock(login, name);
    assertOrdered(block, [
      [`${name} shared advisory lock`, "acquireMfaUserAdvisoryLock"],
      [`${name} user lock`, ".from(users)"],
      [`${name} MFA configuration lock`, ".from(userMfaConfigurations)"],
    ]);
  }
  assert.doesNotMatch(login, /mfa-login:/);
  assert.doesNotMatch(actions, /mfa-management:/);
  assert.match(source("src/lib/mfa/locks.ts"), /`mfa-user:\$\{actor\.organizationId\}:\$\{actor\.id\}`/);
});
