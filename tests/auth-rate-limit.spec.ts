import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { hash } from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const rateLimitSecret =
  process.env.AUTH_RATE_LIMIT_SECRET?.trim() ||
  process.env.SESSION_SECRET?.trim() ||
  "q-academy-local-development-secret-change-me";

function limiterHash(action: string, identifier: string) {
  return createHmac("sha256", rateLimitSecret)
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

function tenantIdentifier(organizationId: string, email: string) {
  return `${organizationId}\0${email.trim().toLowerCase()}`;
}

function opaqueTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  const submit = page.getByRole("button", { name: /Bei .* anmelden/ });
  await submit.click();
}

test("UI and REST share tenant-bound login limits and ignore spoofed forwarding headers", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted auth security flow");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const slugB = `auth-b-${suffix}`;
  const duplicateHostname = `shared-auth-${suffix}.customer-domain.net`;
  const sharedEmail = `shared-${suffix}@example.test`;
  const blockedEmail = `blocked-${suffix}@example.test`;
  const passwordA = "TenantAlpha123!";
  const passwordB = "TenantBravo123!";
  let organizationA: string | null = null;
  let organizationB: string | null = null;
  let organizationC: string | null = null;
  let defaultUserId: string | null = null;
  const limiterKeys: string[] = [];

  try {
    const [tenantA] = await sql<Array<{ id: string }>>`
      select id from organizations where slug = 'q-academy' limit 1
    `;
    if (!tenantA) throw new Error("Default test organization is missing.");
    organizationA = tenantA.id;

    // Warm the public login path before adding a tenant. Auth resolution must
    // still observe the new row rather than an hour-old branding cache.
    await page.goto("/login");

    const [tenantB] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Auth tenant B ${suffix}`}, ${slugB})
      returning id
    `;
    organizationB = tenantB.id;
    await sql`
      insert into platform_settings (organization_id, key, value)
      values (
        ${organizationB}, 'design',
        ${sql.json({ loginHostname: duplicateHostname })}
      )
    `;
    await sql`
      insert into custom_domain_claims (
        organization_id, hostname, challenge_hash, challenge_expires_at
      ) values (
        ${organizationB}, ${duplicateHostname}, ${"a".repeat(64)},
        now() + interval '1 hour'
      )
    `;

    const insertedUsers = await sql<Array<{ id: string; organization_id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      )
      values
        (${organizationA}, ${sharedEmail}, ${await hash(passwordA, 8)}, 'Alpha', 'Member', 'member', 'active'),
        (${organizationB}, ${sharedEmail}, ${await hash(passwordB, 8)}, 'Bravo', 'Member', 'member', 'active')
      returning id, organization_id
    `;
    defaultUserId =
      insertedUsers.find((user) => user.organization_id === organizationA)?.id ??
      null;

    const blockedKeyA = limiterHash(
      "login",
      tenantIdentifier(organizationA, blockedEmail),
    );
    const blockedKeyB = limiterHash(
      "login",
      tenantIdentifier(organizationB, blockedEmail),
    );
    limiterKeys.push(
      blockedKeyA,
      blockedKeyB,
      limiterHash("login_scope", organizationA),
      limiterHash("login_scope", organizationB),
      limiterHash("login_scope", "unresolved"),
      limiterHash(
        "login",
        tenantIdentifier("unresolved", sharedEmail),
      ),
    );

    const expiredKey = randomBytes(32).toString("hex");
    limiterKeys.push(expiredKey);
    await sql`
      insert into auth_rate_limits (action, key_hash, attempts, reset_at)
      values ('login', ${expiredKey}, 1, '1970-01-01T00:00:00Z')
    `;

    const poisonedDefaultHost = await request.post("/api/v1/auth/login", {
      headers: { Host: "q-academy.attacker.test" },
      data: { email: sharedEmail, password: passwordA },
    });
    expect(poisonedDefaultHost.status()).toBe(401);

    const poisonedTenantHost = await request.post("/api/v1/auth/login", {
      headers: { Host: `${slugB}.attacker.test` },
      data: { email: sharedEmail, password: passwordB },
    });
    expect(poisonedTenantHost.status()).toBe(401);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request.post("/api/v1/auth/login", {
        headers: {
          "X-Forwarded-For": `198.51.100.${attempt + 10}`,
          "X-Forwarded-Host": `${slugB}.localhost:3000`,
        },
        data: { email: blockedEmail, password: "WrongPassword123!" },
      });
      expect(response.status()).toBe(401);
      if (attempt === 0) {
        const [expired] = await sql<Array<{ count: number }>>`
          select count(*)::int as count
          from auth_rate_limits
          where key_hash = ${expiredKey}
        `;
        expect(expired.count).toBe(0);
      }
    }

    await page.goto("/login");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await submitLogin(page, blockedEmail, "WrongPassword123!");
      await expect(page.locator('p[role="alert"]')).toContainText(
        "E-Mail-Adresse oder Passwort ist nicht korrekt.",
      );
      await expect(
        page.getByRole("button", { name: /Bei .* anmelden/ }),
      ).toBeEnabled();
    }

    const blocked = await request.post("/api/v1/auth/login", {
      headers: {
        "X-Forwarded-For": "203.0.113.250",
        "X-Forwarded-Host": `${slugB}.localhost:3000`,
      },
      data: { email: blockedEmail, password: "WrongPassword123!" },
    });
    expect(blocked.status()).toBe(429);
    expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);

    const tenantALogin = await request.post("/api/v1/auth/login", {
      data: { email: sharedEmail, password: passwordA },
    });
    expect(tenantALogin.status()).toBe(200);

    const wrongTenantPassword = await request.post("/api/v1/auth/login", {
      data: { email: sharedEmail, password: passwordB },
    });
    expect(wrongTenantPassword.status()).toBe(401);

    const tenantBLogin = await request.post("/api/v1/auth/login", {
      headers: { Host: `${slugB}.localhost:3000` },
      data: { email: sharedEmail, password: passwordB },
    });
    expect(tenantBLogin.status()).toBe(200);
    await expect(tenantBLogin.json()).resolves.toMatchObject({
      data: { user: { organizationId: organizationB } },
    });

    limiterKeys.push(
      limiterHash("login", tenantIdentifier(organizationA, sharedEmail)),
      limiterHash("login", tenantIdentifier(organizationB, sharedEmail)),
    );
    await page.context().clearCookies();
    await page.goto("/login");
    await submitLogin(page, sharedEmail, passwordA);
    await expect(page).toHaveURL(/\/academy/);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/settings");
    const customDomainPanel = page.getByRole("region", { name: "Custom Domain" });
    await customDomainPanel
      .getByLabel("Custom Domain Hostname", { exact: true })
      .fill(duplicateHostname);
    await customDomainPanel.getByRole("button", { name: "Claim erstellen" }).click();
    await expect(customDomainPanel.getByRole("status")).toHaveText(
      "Dieser Hostname wird bereits von einer anderen Academy beansprucht.",
    );

    const [tenantC] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Auth tenant C ${suffix}`}, ${`auth-c-${suffix}`})
      returning id
    `;
    organizationC = tenantC.id;
    await sql`
      insert into platform_settings (organization_id, key, value)
      values (
        ${organizationC}, 'design',
        ${sql.json({ loginHostname: duplicateHostname })}
      )
    `;
    const ambiguousHost = await request.post("/api/v1/auth/login", {
      headers: { Host: duplicateHostname },
      data: { email: sharedEmail, password: passwordB },
    });
    expect(ambiguousHost.status()).toBe(401);
  } finally {
    if (limiterKeys.length) {
      await sql`delete from auth_rate_limits where key_hash in ${sql(limiterKeys)}`;
    }
    if (defaultUserId) await sql`delete from users where id = ${defaultUserId}`;
    if (organizationB) {
      await sql`delete from organizations where id = ${organizationB}`;
    }
    if (organizationC) {
      await sql`delete from organizations where id = ${organizationC}`;
    }
    await sql.end();
  }
});

test("password recovery is limited, generic, and permits a legitimate reset", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted auth security flow");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const forgotEmail = `missing-${suffix}@example.test`;
  const userEmail = `reset-${suffix}@example.test`;
  const invalidToken = `reset_${randomBytes(32).toString("base64url")}`;
  const validToken = `reset_${randomBytes(32).toString("base64url")}`;
  const newPassword = "UpdatedPassword123!";
  let userId: string | null = null;
  const limiterKeys: string[] = [];

  try {
    const [organization] = await sql<Array<{ id: string }>>`
      select id from organizations where slug = 'q-academy' limit 1
    `;
    if (!organization) throw new Error("Default test organization is missing.");

    const forgotKey = limiterHash(
      "password_forgot",
      tenantIdentifier(organization.id, forgotEmail),
    );
    const invalidResetHash = opaqueTokenHash(invalidToken);
    const invalidResetKey = limiterHash("password_reset", invalidResetHash);
    limiterKeys.push(
      forgotKey,
      invalidResetKey,
      limiterHash("password_forgot_scope", organization.id),
      limiterHash("password_forgot_scope", "unresolved"),
      limiterHash("password_reset_scope", "global"),
      limiterHash("login_scope", organization.id),
      limiterHash(
        "password_forgot",
        tenantIdentifier("unresolved", userEmail),
      ),
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request.post("/api/v1/password/forgot", {
        headers: { "X-Forwarded-For": `192.0.2.${attempt + 10}` },
        data: { email: forgotEmail },
      });
      expect(response.status()).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        data: { accepted: true },
        meta: {
          message:
            "Falls ein passendes Konto existiert, wurde ein Reset-Link versendet.",
        },
      });
    }
    const forgotBlocked = await request.post("/api/v1/password/forgot", {
      headers: { "X-Forwarded-For": "192.0.2.250" },
      data: { email: forgotEmail },
    });
    expect(forgotBlocked.status()).toBe(429);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request.post("/api/v1/password/reset", {
        headers: { "X-Forwarded-For": `203.0.113.${attempt + 10}` },
        data: { token: invalidToken, password: newPassword },
      });
      expect(response.status()).toBe(400);
    }
    const resetBlocked = await request.post("/api/v1/password/reset", {
      headers: { "X-Forwarded-For": "203.0.113.250" },
      data: { token: invalidToken, password: newPassword },
    });
    expect(resetBlocked.status()).toBe(429);

    const [user] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      )
      values (
        ${organization.id}, ${userEmail}, ${await hash("InitialPassword123!", 8)},
        'Reset', 'Member', 'member', 'active'
      )
      returning id
    `;
    userId = user.id;

    const poisonedForgot = await request.post("/api/v1/password/forgot", {
      headers: { Host: "q-academy.attacker.test" },
      data: { email: userEmail },
    });
    expect(poisonedForgot.status()).toBe(202);
    const [poisonedTokens] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from password_reset_tokens
      where user_id = ${userId}
    `;
    expect(poisonedTokens.count).toBe(0);

    const validTokenHash = opaqueTokenHash(validToken);
    limiterKeys.push(
      limiterHash("password_reset", validTokenHash),
      limiterHash(
        "login",
        tenantIdentifier(organization.id, userEmail),
      ),
    );
    await sql`
      insert into password_reset_tokens (user_id, token_hash, expires_at)
      values (${userId}, ${validTokenHash}, now() + interval '30 minutes')
    `;

    const reset = await request.post("/api/v1/password/reset", {
      data: { token: validToken, password: newPassword },
    });
    expect(reset.status()).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({
      data: { passwordReset: true },
    });

    const login = await request.post("/api/v1/auth/login", {
      data: { email: userEmail, password: newPassword },
    });
    expect(login.status()).toBe(200);

    const storedBuckets = await sql<
      Array<{ key_hash: string; attempts: number }>
    >`
      select key_hash, attempts
      from auth_rate_limits
      where key_hash in ${sql([forgotKey, invalidResetKey])}
    `;
    expect(storedBuckets).toHaveLength(2);
    expect(storedBuckets.every((row) => /^[a-f0-9]{64}$/.test(row.key_hash))).toBe(true);
    expect(storedBuckets.every((row) => row.attempts === 9)).toBe(true);
  } finally {
    if (limiterKeys.length) {
      await sql`delete from auth_rate_limits where key_hash in ${sql(limiterKeys)}`;
    }
    if (userId) await sql`delete from users where id = ${userId}`;
    await sql.end();
  }
});
