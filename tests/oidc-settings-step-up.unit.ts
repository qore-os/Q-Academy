import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getSystemExperienceCopy } from "@/lib/i18n/system-experience";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";

const action = readFileSync("src/lib/oidc-actions.ts", "utf8");
const form = readFileSync(
  "src/components/admin/oidc-settings-form.tsx",
  "utf8",
);
const mfaStepUp = readFileSync(
  "src/lib/mfa/security-step-up.ts",
  "utf8",
);

test("OIDC configuration mutations require owner step-up before provider egress", () => {
  const stepUp = action.indexOf("await verifyPrivacyOwnerStepUp(");
  const secondFactor = action.indexOf(
    "await verifyAndConsumeMfaSecurityStepUp(",
  );
  const providerEgress = action.indexOf("await verifyOidcProviderConfiguration(");

  assert.ok(stepUp >= 0, "OIDC settings must invoke the owner step-up verifier");
  assert.ok(
    secondFactor > stepUp && providerEgress > secondFactor,
    "primary and MFA step-up must finish before contacting the configured provider",
  );
  assert.match(action, /passwordInput\.length <= 256/);
  assert.match(action, /error instanceof PrivacyOwnerStepUpError/);
  assert.match(action, /error instanceof MfaSecurityStepUpError/);
});

test("OIDC settings render the matching password or provider step-up control", () => {
  assert.match(form, /<OwnerStepUpControl/);
  assert.match(
    form,
    /mode=\{savedPasswordLoginEnabled \? "password" : "oidc"\}/,
  );
  assert.match(form, /passwordName="currentPassword"/);
  assert.match(form, /returnTo="\/admin\/settings#sso"/);
  assert.match(form, /canManage && mfaStepUpRequired/);
  assert.match(form, /name="mfaCode"/);
});

test("OIDC MFA step-up consumes replay state and refreshes the current session", () => {
  assert.match(mfaStepUp, /acquireMfaUserAdvisoryLock\(tx, actor\)/);
  assert.match(mfaStepUp, /\.for\("update"\)/);
  assert.match(mfaStepUp, /verifyMfaSecondFactor\(configuration, normalizedCode\)/);
  assert.match(mfaStepUp, /recoveryCodeHashes: proof\.recoveryCodeHashes/);
  assert.match(mfaStepUp, /lastTotpCounter: proof\.counter/);
  assert.match(mfaStepUp, /mfaVerifiedAt: now, mfaMethod: proof\.method/);
});

test("OIDC step-up failures have complete localized public messages", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = getSystemExperienceCopy(locale).oidc.messages;
    assert.ok(messages.step_up_invalid_password.length > 0);
    assert.ok(messages.step_up_rate_limited.length > 0);
    assert.ok(messages.step_up_reauthentication_required.length > 0);
    assert.ok(messages.step_up_mfa_required.length > 0);
    assert.ok(messages.step_up_mfa_invalid.length > 0);
    assert.ok(messages.provider_changes_require_password_login.length > 0);
    assert.ok(messages.owner_sso_required.length > 0);
  }
});

test("OIDC configuration conflicts stay distinct from provider failures", () => {
  const configuration = readFileSync(
    "src/lib/oidc-configuration.ts",
    "utf8",
  );

  assert.match(
    configuration,
    /reason: "provider_changes_require_password_login"/,
  );
  assert.match(configuration, /reason: "owner_sso_required"/);
  assert.match(action, /oidcConfigurationFailureCode\(error\)/);
  assert.match(
    action,
    /verifyOidcProviderConfiguration\(preview\.runtime\)[\s\S]*messageCode: "provider_rejected"/,
  );
});
