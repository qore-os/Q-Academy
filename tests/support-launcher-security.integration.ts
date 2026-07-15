import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { eq } from "drizzle-orm";
import { db, postgresClient } from "../src/db/index";
import {
  organizations,
  organizationSupportSettings,
} from "../src/db/schema";
import { encryptWebhookSecret } from "../src/lib/api/crypto";
import { getSupportLauncherConfiguration } from "../src/lib/support";

after(async () => {
  await postgresClient.end({ timeout: 5 });
});

function isCheckConstraintViolation(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const code = "code" in current ? String(current.code) : null;
    const constraint =
      "constraint_name" in current
        ? String(current.constraint_name)
        : "constraint" in current
          ? String(current.constraint)
          : null;
    if (
      code === "23514" &&
      constraint === "organization_support_settings_configuration_check"
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

test("Intercom launcher requires a persisted and decryptable identity secret", async () => {
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const identitySecret = `intercom-test-${suffix}`;
  const user = {
    id: userId,
    organizationId,
    email: `member-${suffix}@example.test`,
    firstName: "Intercom",
    lastName: "Member",
  };

  try {
    await db.insert(organizations).values({
      id: organizationId,
      name: `Intercom Security ${suffix}`,
      slug: `intercom-security-${suffix}`,
    });

    await assert.rejects(
      db.insert(organizationSupportSettings).values({
        organizationId,
        enabled: true,
        provider: "intercom",
        launcherLabel: "Support",
        intercomAppId: "secure-app",
        identitySecretEncrypted: null,
      }),
      isCheckConstraintViolation,
    );

    await db.insert(organizationSupportSettings).values({
      organizationId,
      enabled: true,
      provider: "intercom",
      launcherLabel: "Support",
      intercomAppId: "secure-app",
      identitySecretEncrypted: encryptWebhookSecret(identitySecret),
    });

    const launcher = await getSupportLauncherConfiguration(user);
    assert.ok(launcher && launcher.provider === "intercom");
    assert.equal(
      launcher.userHash,
      createHmac("sha256", identitySecret).update(userId).digest("hex"),
    );
    assert.match(launcher.userHash, /^[a-f0-9]{64}$/);

    await db
      .update(organizationSupportSettings)
      .set({
        identitySecretEncrypted:
          "v2.unavailable-key.invalid-iv.invalid-tag.invalid-ciphertext",
      })
      .where(eq(organizationSupportSettings.organizationId, organizationId));

    const logged: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...values: unknown[]) => {
      logged.push(values.map(String).join(" "));
    };
    try {
      assert.equal(await getSupportLauncherConfiguration(user), null);
    } finally {
      console.error = originalConsoleError;
    }
    assert.ok(
      logged.some((entry) =>
        entry.includes("support.launcher.identity_verification"),
      ),
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});
