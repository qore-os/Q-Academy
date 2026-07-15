import assert from "node:assert/strict";
import test from "node:test";
import { createEncryptionKeyring } from "../src/lib/encryption-keyring";
import {
  hashRecoveryCodeWithKeyring,
  recoveryHashIndexWithKeyring,
} from "../src/lib/mfa/recovery-hash";

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const code = "ABCD-EFGH-JKLM-NPQR";

test("versioned recovery hashes survive restart with a retained previous pepper", () => {
  const oldRing = createEncryptionKeyring({
    activeKeyId: "pepper-2026-01",
    activeSecret: "old-mfa-recovery-pepper-value-32-chars-minimum",
  });
  const stored = hashRecoveryCodeWithKeyring(
    code,
    organizationA,
    userId,
    oldRing,
  );
  const restartedRing = createEncryptionKeyring({
    activeKeyId: "pepper-2026-07",
    activeSecret: "new-mfa-recovery-pepper-value-32-chars-minimum",
    previousKeys: {
      "pepper-2026-01": "old-mfa-recovery-pepper-value-32-chars-minimum",
    },
  });
  assert.equal(
    recoveryHashIndexWithKeyring(
      [stored],
      code.toLowerCase(),
      organizationA,
      userId,
      restartedRing,
    ),
    0,
  );
  assert.equal(
    recoveryHashIndexWithKeyring(
      [stored],
      code,
      organizationA,
      userId,
      createEncryptionKeyring({
        activeKeyId: "pepper-2026-07",
        activeSecret: "new-mfa-recovery-pepper-value-32-chars-minimum",
      }),
    ),
    -1,
  );
});

test("recovery hashes are bound to tenant and user and support atomic removal", () => {
  const ring = createEncryptionKeyring({
    activeKeyId: "pepper-current",
    activeSecret: "tenant-bound-mfa-recovery-pepper-value-minimum",
  });
  const stored = hashRecoveryCodeWithKeyring(code, organizationA, userId, ring);
  assert.equal(
    recoveryHashIndexWithKeyring([stored], code, organizationB, userId, ring),
    -1,
  );
  const hashes = [stored];
  const index = recoveryHashIndexWithKeyring(
    hashes,
    code,
    organizationA,
    userId,
    ring,
  );
  assert.equal(index, 0);
  const consumed = hashes.filter((_, position) => position !== index);
  assert.equal(
    recoveryHashIndexWithKeyring(
      consumed,
      code,
      organizationA,
      userId,
      ring,
    ),
    -1,
  );
});
