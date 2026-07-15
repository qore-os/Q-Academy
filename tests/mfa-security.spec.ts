import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { totpForCounter } from "../src/lib/mfa/totp";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("privileged login enrolls before session and consumes a recovery code once", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted MFA security flow");
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const slug = `mfa-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${slug}.localhost:3000`;
  const email = `mfa-${suffix}@example.test`;
  const password = "Demo123!";

  const activeChallengeId = async () => {
    const [challenge] = await sql<Array<{ id: string }>>`
      select id from mfa_login_challenges
      where organization_id = ${organizationId} and user_id = ${userId}
        and consumed_at is null and expires_at > now()
      order by created_at desc
      limit 1
    `;
    if (!challenge) throw new Error("The active MFA challenge is missing.");
    return challenge.id;
  };

  const startVerifyChallenge = async () => {
    await context.clearCookies();
    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);
    return activeChallengeId();
  };

  const submitMfaApi = async (code: string) =>
    page.evaluate(async (submittedCode) => {
      const response = await fetch("/api/v1/auth/mfa", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: submittedCode }),
      });
      const body = (await response.json()) as { code?: string };
      return {
        status: response.status,
        code: body.code,
        retryAfter: response.headers.get("retry-after"),
      };
    }, code);

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'admin@q-academy.de' limit 1
    `;
    if (!template) throw new Error("MFA test password fixture is missing.");
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'MFA Security Test', ${slug})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId}, ${email}, ${template.password_hash},
        'MFA', 'Administrator', 'admin', 'active'
      )
    `;
    await sql`
      insert into organization_mfa_policies (
        organization_id, require_for_privileged, revision
      ) values (${organizationId}, true, 1)
    `;

    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);
    await expect(page.getByRole("heading", { name: "MFA jetzt einrichten" })).toBeVisible();

    const [beforeSession] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from user_sessions
      where organization_id = ${organizationId} and user_id = ${userId}
    `;
    expect(beforeSession.count).toBe(0);
    const [pendingConfiguration] = await sql<
      Array<{ created_at: Date; updated_at: Date }>
    >`
      select created_at, updated_at from user_mfa_configurations
      where organization_id = ${organizationId} and user_id = ${userId}
    `;
    if (!pendingConfiguration) throw new Error("Pending MFA configuration is missing.");
    expect(pendingConfiguration.updated_at.getTime()).toBe(
      pendingConfiguration.created_at.getTime(),
    );

    const secret = (await page.locator("code").first().textContent())!.trim();
    const code = totpForCounter(secret, Math.floor(Date.now() / 30_000));
    await page.getByLabel("Bestaetigungscode").fill(code);
    await page.getByRole("button", { name: "MFA aktivieren" }).click();
    await expect(page.getByRole("heading", { name: "Recovery-Codes speichern" })).toBeVisible();
    const recoveryCode = (await page.locator("code").first().textContent())!.trim();
    expect(recoveryCode).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
    const [afterSession] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from user_sessions
      where organization_id = ${organizationId} and user_id = ${userId}
        and revoked_at is null
    `;
    expect(afterSession.count).toBe(1);

    await context.clearCookies();
    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);
    await page.getByLabel("MFA- oder Recovery-Code").fill(recoveryCode);
    await page.getByRole("button", { name: "Anmeldung abschliessen" }).click();
    await expect(page).toHaveURL(/\/admin/);

    const [remaining] = await sql<Array<{ remaining: number }>>`
      select cardinality(recovery_code_hashes)::int as remaining
      from user_mfa_configurations
      where organization_id = ${organizationId} and user_id = ${userId}
    `;
    expect(remaining.remaining).toBe(9);

    await context.clearCookies();
    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await page.getByLabel("MFA- oder Recovery-Code").fill(recoveryCode);
    await page.getByRole("button", { name: "Anmeldung abschliessen" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("nicht korrekt");
    expect(new URL(page.url()).search).toBe("");

    const firstChallengeId = await activeChallengeId();
    const secondChallengeId = await startVerifyChallenge();
    expect(secondChallengeId).not.toBe(firstChallengeId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(submitMfaApi(recoveryCode)).resolves.toMatchObject({
        status: 401,
        code: "invalid_code",
      });
    }

    const thirdChallengeId = await startVerifyChallenge();
    expect(thirdChallengeId).not.toBe(secondChallengeId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(submitMfaApi(recoveryCode)).resolves.toMatchObject({
        status: 401,
        code: "invalid_code",
      });
    }

    const limited = await submitMfaApi(recoveryCode);
    expect(limited).toMatchObject({ status: 429, code: "rate_limited" });
    expect(Number(limited.retryAfter)).toBeGreaterThan(0);

    await page.getByLabel("MFA- oder Recovery-Code").fill(recoveryCode);
    await page.getByRole("button", { name: "Anmeldung abschliessen" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("Zu viele MFA-Versuche");
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
