import assert from "node:assert/strict";
import test from "node:test";
import {
  privacyReasonStepUpSchema,
  privacyStepUpPassword,
  privacyStepUpSchema,
} from "../src/lib/privacy/request-schemas";

test("privacy step-up accepts an empty password for the SSO verifier", () => {
  assert.equal(privacyStepUpSchema.safeParse({ password: "" }).success, true);
  assert.equal(
    privacyStepUpSchema.safeParse({ password: "x".repeat(257) }).success,
    false,
  );
  assert.equal(
    privacyReasonStepUpSchema.safeParse({ password: "", reason: "DSAR" })
      .success,
    true,
  );
});

test("privacy step-up normalizes a missing form password without accepting files", () => {
  const empty = new FormData();
  assert.equal(privacyStepUpPassword(empty), "");

  const password = new FormData();
  password.set("password", "Demo123!");
  assert.equal(privacyStepUpPassword(password), "Demo123!");

  const file = new FormData();
  file.set("password", new Blob(["not-a-password"]), "password.txt");
  assert.equal(privacyStepUpPassword(file), "");
});
