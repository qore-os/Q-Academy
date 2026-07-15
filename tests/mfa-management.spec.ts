import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { getMfaCopy } from "../src/lib/i18n/mfa";
import { totpForCounter } from "../src/lib/mfa/totp";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const mfaCopy = getMfaCopy("de");

test("owner manages MFA recovery and organization policy end to end", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused MFA management flow");
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const slug = `mfa-manage-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${slug}.localhost:3000`;
  const email = `mfa-manage-${suffix}@example.test`;
  const password = "Demo123!";

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'admin@q-academy.de' limit 1
    `;
    if (!template) throw new Error("MFA management password fixture is missing.");
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'MFA Management Test', ${slug})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId}, ${email}, ${template.password_hash},
        'MFA', 'Owner', 'owner', 'active'
      )
    `;

    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`${tenantOrigin}/academy/profile`);

    const mfaPanel = page.locator("#mfa");
    await expect(mfaPanel.getByRole("heading", { name: "Multi-Faktor-Authentifizierung" })).toBeVisible();
    await mfaPanel.getByLabel("Aktuelles Passwort").fill(password);
    await mfaPanel.getByRole("button", { name: "Einrichtung starten" }).click();
    await expect(mfaPanel.getByRole("status")).toContainText(
      "Scanne den QR-Code und bestaetige die Einrichtung.",
    );
    await expect(mfaPanel.locator("code")).toHaveCount(1);
    const secret = (await mfaPanel.locator("code").textContent())!.trim();
    const confirmationCode = totpForCounter(
      secret,
      Math.floor(Date.now() / 30_000),
    );
    await mfaPanel.getByLabel("Aktuelles Passwort").fill(password);
    await mfaPanel.getByLabel("Sechsstelliger Code").fill(confirmationCode);
    await mfaPanel.getByRole("button", { name: "MFA aktivieren" }).click();
    await expect(mfaPanel.getByText("Nur jetzt sichtbar: Recovery-Codes")).toBeVisible();
    await expect(mfaPanel.getByText("10 verbleibend")).toBeVisible();
    await expect(mfaPanel.locator("code")).toHaveCount(10);
    const initialRecoveryCodes = (await mfaPanel.locator("code").allTextContents()).map(
      (code) => code.trim(),
    );

    await page.screenshot({
      path: testInfo.outputPath("mfa-profile-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("mfa-profile-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await mfaPanel
      .getByLabel("Aktuelles Passwort fuer neue Recovery-Codes")
      .fill(password);
    await mfaPanel
      .getByLabel("MFA-Code fuer neue Recovery-Codes")
      .fill(initialRecoveryCodes[0]!);
    await mfaPanel.getByRole("button", { name: "Neue Codes erstellen" }).click();
    await expect(mfaPanel.getByText("Neue Recovery-Codes wurden erstellt", { exact: false })).toBeVisible();
    await expect(mfaPanel.locator("code")).toHaveCount(10);
    const recoveryCodes = (await mfaPanel.locator("code").allTextContents()).map(
      (code) => code.trim(),
    );
    expect(recoveryCodes).not.toEqual(initialRecoveryCodes);

    await page.goto(`${tenantOrigin}/admin/settings#sicherheit`);
    const policyPanel = page.locator("#sicherheit");
    await policyPanel.getByLabel("MFA verpflichtend").check();
    await policyPanel.getByLabel("Owner-Passwort").fill(password);
    await policyPanel.getByLabel("MFA- oder Recovery-Code").fill(recoveryCodes[0]!);
    await policyPanel.getByRole("button", { name: "Policy speichern" }).click();
    await expect(
      policyPanel.getByText(mfaCopy.messages.policyEnabled),
    ).toBeVisible();

    await policyPanel.getByLabel("MFA verpflichtend").uncheck();
    await policyPanel.getByLabel("Owner-Passwort").fill(password);
    await policyPanel.getByLabel("MFA- oder Recovery-Code").fill(recoveryCodes[1]!);
    await policyPanel.getByRole("button", { name: "Policy speichern" }).click();
    await expect(
      policyPanel.getByText(mfaCopy.messages.policyDisabled),
    ).toBeVisible();

    await page.goto(`${tenantOrigin}/academy/profile`);
    const activeMfaPanel = page.locator("#mfa");
    await activeMfaPanel
      .getByLabel("Aktuelles Passwort zum Deaktivieren")
      .fill(password);
    await activeMfaPanel
      .getByLabel("MFA-Code zum Deaktivieren")
      .fill(recoveryCodes[2]!);
    await activeMfaPanel.getByRole("button", { name: "MFA deaktivieren" }).click();
    await expect(activeMfaPanel.getByText("MFA wurde deaktiviert", { exact: false })).toBeVisible();
    await expect(activeMfaPanel.getByText("Inaktiv", { exact: true })).toBeVisible();
    await expect(activeMfaPanel.locator("code")).toHaveCount(0);

    const [configuration, policy, events] = await Promise.all([
      sql<Array<{ count: number }>>`
        select count(*)::int as count from user_mfa_configurations
        where organization_id = ${organizationId} and user_id = ${userId}
      `,
      sql<Array<{ required: boolean; revision: number }>>`
        select require_for_privileged as required, revision
        from organization_mfa_policies where organization_id = ${organizationId}
      `,
      sql<Array<{ type: string }>>`
        select type from activity_events
        where organization_id = ${organizationId}
          and type in (
            'security.mfa.enabled', 'security.mfa.recovery_regenerated',
            'security.mfa.policy_updated', 'security.mfa.disabled'
          )
      `,
    ]);
    expect(configuration[0]?.count).toBe(0);
    expect(policy[0]).toMatchObject({ required: false, revision: 2 });
    expect(events.filter(({ type }) => type === "security.mfa.policy_updated")).toHaveLength(2);
    expect(new Set(events.map(({ type }) => type))).toEqual(
      new Set([
        "security.mfa.enabled",
        "security.mfa.recovery_regenerated",
        "security.mfa.policy_updated",
        "security.mfa.disabled",
      ]),
    );
  } finally {
    await context.clearCookies();
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
