import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPrivacyAdminCopy } from "@/lib/i18n/privacy-admin";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";

test("privacy owner step-up failures have actionable localized messages", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = getPrivacyAdminCopy(locale).messages;
    assert.ok(messages.stepUpInvalidPassword.trim().length > 0);
    assert.ok(messages.stepUpRateLimited.trim().length > 0);
    assert.ok(messages.stepUpOwnerRequired.trim().length > 0);
    assert.ok(messages.stepUpReauthenticationRequired.trim().length > 0);
  }
});

test("privacy owner actions map every step-up failure to a stable code", () => {
  const action = readFileSync("src/lib/privacy/owner-actions.ts", "utf8");

  for (const code of [
    "stepUpInvalidPassword",
    "stepUpRateLimited",
    "stepUpOwnerRequired",
    "stepUpReauthenticationRequired",
  ]) {
    assert.ok(action.includes(`"${code}"`), `missing ${code}`);
  }
  assert.match(action, /error instanceof PrivacyOwnerStepUpError/);
});
