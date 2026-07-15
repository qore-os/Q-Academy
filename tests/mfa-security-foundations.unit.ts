import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function insertValuesBlock(value: string, table: string) {
  const start = value.indexOf(`.insert(${table})`);
  const end = value.indexOf(".onConflictDoUpdate", start);
  assert.ok(start >= 0 && end > start, `Missing ${table} upsert.`);
  return value.slice(start, end);
}

test("0053 seals AI requests and adds tenant-bound MFA storage", () => {
  const migration = source("drizzle/0053_security_foundations.sql");
  assert.match(migration, /CREATE TABLE "user_mfa_configurations"/);
  assert.match(migration, /user_mfa_configurations_user_tenant_fk/);
  assert.match(migration, /CREATE TABLE "mfa_login_challenges"/);
  assert.match(migration, /mfa_login_challenges_jti_hash_idx/);
  assert.match(migration, /MFA agent action requests cannot|AI agent action requests cannot/);
  assert.match(migration, /OLD\."status" <> 'pending'/);
  assert.match(migration, /NEW\."status" NOT IN \('approved', 'rejected', 'cancelled', 'expired'\)/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "public"\."ai_agent_action_requests"/);
  assert.match(migration, /BEFORE TRUNCATE ON "public"\."ai_agent_action_requests"/);
});

test("MFA upsert inserts use one timestamp for database timelines", () => {
  const migration = source("drizzle/0053_security_foundations.sql");
  assert.match(
    migration,
    /"user_mfa_configurations"\."updated_at" >= "user_mfa_configurations"\."created_at"/,
  );
  assert.match(
    migration,
    /"organization_mfa_policies"\."updated_at" >= "organization_mfa_policies"\."created_at"/,
  );

  const loginEnrollment = insertValuesBlock(
    source("src/lib/mfa/login-challenge.ts"),
    "userMfaConfigurations",
  );
  const management = source("src/lib/mfa/management-actions.ts");
  const profileEnrollment = insertValuesBlock(
    management,
    "userMfaConfigurations",
  );
  const policy = insertValuesBlock(management, "organizationMfaPolicies");
  for (const value of [loginEnrollment, profileEnrollment, policy]) {
    assert.match(value, /createdAt: now/);
    assert.match(value, /updatedAt: now/);
  }
});

test("login retains primary limits until account-wide MFA succeeds", () => {
  const actions = source("src/lib/actions.ts");
  const route = source("src/app/api/v1/auth/login/route.ts");
  for (const value of [actions, route]) {
    const challenge = value.indexOf("beginMfaLoginChallenge");
    const clearAfterChallenge = value.indexOf("clearAuthRateLimit", challenge);
    assert.ok(challenge >= 0 && clearAfterChallenge > challenge);
  }
  const challenge = source("src/lib/mfa/login-challenge.ts");
  assert.match(
    challenge,
    /const rateIdentifier = `\$\{challenge\.organizationId\}:\$\{challenge\.userId\}`/,
  );
  assert.doesNotMatch(challenge, /rateIdentifier = .*challenge\.id/);
  assert.match(challenge, /sameSite: "lax"/);
  assert.match(challenge, /configuration\.status !== expectedStatus/);
});

test("public MFA mutations are bounded and tenant-origin fail closed", () => {
  const login = source("src/app/api/v1/auth/login/route.ts");
  const invitation = source("src/app/api/v1/invitations/[token]/accept/route.ts");
  const mfa = source("src/app/api/v1/auth/mfa/route.ts");
  assert.match(login, /parseSessionJson\(request, \{ maxBytes: 1_024 \}\)/);
  assert.match(invitation, /parseSessionJson\(request, \{ maxBytes: 512 \}\)/);
  assert.match(mfa, /parseSessionJson\(request, \{ maxBytes: 512 \}\)/);
  assert.match(mfa, /if \(!origin \|\| \(fetchSite !== null && fetchSite !== "same-origin"\)\) return false/);
  assert.match(mfa, /canonicalTenantAuthOrigin/);
  assert.match(mfa, /safeAuthLinkOrigin/);
  assert.doesNotMatch(mfa, /new URL\(request\.url\)\.origin/);
  assert.match(mfa, /redirectTo: completion\.destination/);
  const form = source("src/components/auth/mfa-login-form.tsx");
  assert.match(form, /fetch\("\/api\/v1\/auth\/mfa"/);
  assert.match(form, /credentials: "same-origin"/);
  assert.match(form, /submissionInFlight\.current/);
  assert.match(form, /action="\/api\/v1\/auth\/mfa"/);
  assert.match(form, /method="post"/);
  assert.match(form, /disabled=\{!hydrated \|\| pending\}/);
  assert.doesNotMatch(form, /useActionState|completeMfaLoginAction/);
  assert.match(invitation, /mfaRequired: true/);
});

test("fresh SSO and one-time recovery UX cannot bypass their continuation", () => {
  const callback = source("src/app/api/v1/auth/oidc/callback/route.ts");
  assert.match(callback, /transaction\.requireFreshAuthentication/);
  assert.match(callback, /!isFreshOidcAuthenticationTime\(authTime\)/);
  assert.doesNotMatch(callback, /requireFreshAuthentication\s*\?\s*new Date/);
  const exchangedClaims = callback.indexOf("const claims =");
  const freshnessCheck = callback.indexOf(
    "!isFreshOidcAuthenticationTime(authTime)",
    exchangedClaims,
  );
  const identityResolution = callback.indexOf(
    "const resolved = await resolveOidcUser",
    exchangedClaims,
  );
  assert.ok(
    exchangedClaims >= 0 &&
      freshnessCheck > exchangedClaims &&
      identityResolution > freshnessCheck,
  );
  const page = source("src/app/login/mfa/page.tsx");
  assert.ok(
    page.indexOf("getMfaLoginChallengeView") < page.indexOf("getCurrentUser()"),
  );
  assert.match(page, /getTenantBranding\(challenge\.organizationId\)/);
  const profile = source("src/components/academy/mfa-security-panel.tsx");
  const activeBranch = profile.indexOf('className="divide-y divide-[#edf0f2]"');
  assert.ok(profile.indexOf("confirmedRecoveryCodes", activeBranch) > activeBranch);
  assert.match(profile, /OidcStepUpButton returnTo="\/academy\/profile#mfa"/);
  const challenge = source("src/lib/mfa/login-challenge.ts");
  assert.match(
    challenge,
    /role !== "member" && parsed\.pathname === "\/academy\/profile"/,
  );
  assert.match(
    challenge,
    /parsed\.pathname === root \|\| parsed\.pathname\.startsWith\(`\$\{root\}\/`\)/,
  );
  assert.doesNotMatch(challenge, /value\.startsWith\(root\)/);
});

test("MFA credentials participate in key lifecycle and privacy exclusion", () => {
  const rotation = source("scripts/rotate-encryption-keys.ts");
  assert.match(rotation, /rotateMfaTotpSecrets/);
  assert.match(rotation, /verifyMfaTotpSecrets/);
  assert.match(rotation, /mfa-totp:\$\{organizationId\}:\$\{userId\}:v1/);
  const inventory = source("src/lib/privacy/data-inventory.ts");
  assert.match(inventory, /"secret_encrypted"/);
  assert.match(inventory, /"recovery_code_hashes"/);
  assert.match(inventory, /"last_totp_counter"/);
  const docs = source("docs/MFA_SECURITY.md");
  assert.match(docs, /MFA_RECOVERY_PREVIOUS_PEPPERS/);
  assert.match(docs, /mfaTotpSecrets: 0/);
});
