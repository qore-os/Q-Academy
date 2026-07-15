import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOtpAuthUri,
  decodeBase32,
  encodeBase32,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  totpForCounter,
  verifyTotpCode,
} from "../src/lib/mfa/totp";

test("RFC 6238 SHA-1 vectors are generated exactly", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
  for (const [time, expected] of [
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"],
  ] as const) {
    assert.equal(totpForCounter(secret, Math.floor(time / 30), 8), expected);
  }
});

test("Base32 round-trips binary secrets and rejects invalid input", () => {
  const binary = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  assert.deepEqual(decodeBase32(encodeBase32(binary)), binary);
  assert.throws(() => decodeBase32("NOT*BASE32"));
});

test("TOTP verification accepts a bounded clock window and blocks replay", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
  const now = 1_700_000_000_000;
  const counter = Math.floor(now / 30_000);
  const previousCode = totpForCounter(secret, counter - 1);
  assert.equal(verifyTotpCode({ secret, code: previousCode, now }), counter - 1);
  assert.equal(
    verifyTotpCode({
      secret,
      code: previousCode,
      now,
      lastUsedCounter: counter - 1,
    }),
    null,
  );
  assert.equal(verifyTotpCode({ secret, code: "123456", now, window: 0 }), null);
});

test("otpauth data is standards-shaped and recovery codes have one canonical form", () => {
  const uri = new URL(buildOtpAuthUri({
    secret: "JBSWY3DPEHPK3PXP",
    issuer: "Q-Academy",
    accountName: "owner@example.test",
  }));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.searchParams.get("algorithm"), "SHA1");
  assert.equal(uri.searchParams.get("period"), "30");
  const codes = generateRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)));
  assert.equal(normalizeRecoveryCode(codes[0]!.toLowerCase()), codes[0]!.replaceAll("-", ""));
});
