import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoApiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function environmentValue(name: string) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

test("tenant lifecycle blocks access and keeps revocation across reactivation", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "single database lifecycle flow");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const slug = `lifecycle-${suffix}`;
  const hostname = `${slug}.localhost`;
  const platformName = `Lifecycle Academy ${suffix}`;
  const memberEmail = `active-${suffix}@example.test`;
  const invitedEmail = `invited-${suffix}@example.test`;
  const password = "LifecyclePass123!";
  const resetToken = `reset_${randomBytes(32).toString("base64url")}`;
  const invitationToken = `invite_${randomBytes(32).toString("base64url")}`;
  const apiSecret = `qak_lifecycle_${randomBytes(28).toString("base64url")}`;
  const bypassSecret = `qak_lifecycle_${randomBytes(28).toString("base64url")}`;
  const ids = {
    organization: randomUUID(),
    member: randomUUID(),
    invited: randomUUID(),
    foreignTwin: randomUUID(),
    apiKey: randomUUID(),
    bypassKey: randomUUID(),
    reset: randomUUID(),
    invitation: randomUUID(),
    emailDelivery: randomUUID(),
    webhook: randomUUID(),
    webhookDelivery: randomUUID(),
  };
  const cli = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const runStatus = async (
    status: "active" | "suspended" | "offboarding",
    confirmation = slug,
  ) => {
    const result = await execFileAsync(
      process.execPath,
      [
        cli,
        "scripts/set-tenant-status.ts",
        "--slug",
        slug,
        "--status",
        status,
        "--confirm",
        confirmation,
        "--json",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 30_000,
      },
    );
    return JSON.parse(result.stdout.trim()) as {
      organizationId: string;
      previousStatus: string;
      status: string;
      changed: boolean;
      revokedSessions: number;
      revokedApiKeys: number;
    };
  };

  try {
    const passwordHash = await hash(password, 10);
    await sql`
      insert into organizations (
        id, name, slug, primary_color, accent_color, logo_mark
      ) values (
        ${ids.organization}, ${platformName}, ${slug}, '#264c73', '#198f83', 'LC'
      )
    `;
    await sql`
      insert into platform_settings (organization_id, key, value)
      values (
        ${ids.organization}, 'design',
        ${sql.json({
          platformName,
          primaryColor: "#264c73",
          accentColor: "#198f83",
          loginHostname: hostname,
          logoUrl: null,
          faviconUrl: null,
          fontFamily: "sans",
          cornerRadius: 4,
          defaultTheme: "light",
        })}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (${ids.member}, ${ids.organization}, ${memberEmail}, ${passwordHash},
          'Active', 'Lifecycle', 'member', 'active'),
        (${ids.invited}, ${ids.organization}, ${invitedEmail}, 'unused',
          'Invited', 'Lifecycle', 'member', 'invited')
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      )
      select ${ids.foreignTwin}, id, ${memberEmail}, ${passwordHash},
             'Foreign', 'Twin', 'member', 'active'
      from organizations
      where slug = 'q-academy'
    `;
    await sql`
      insert into api_keys (
        id, organization_id, name, prefix, key_hash, scopes, status
      ) values (
        ${ids.apiKey}, ${ids.organization}, 'Lifecycle key',
        ${apiSecret.slice(0, 16)}, ${sha256(apiSecret)}, array['courses:read'],
        'active'
      )
    `;
    await sql`
      insert into password_reset_tokens (
        id, user_id, token_hash, expires_at
      ) values (
        ${ids.reset}, ${ids.member}, ${sha256(resetToken)},
        now() + interval '30 minutes'
      )
    `;
    await sql`
      insert into invitations (
        id, organization_id, user_id, email, token_hash, expires_at
      ) values (
        ${ids.invitation}, ${ids.organization}, ${ids.invited}, ${invitedEmail},
        ${sha256(invitationToken)}, now() + interval '7 days'
      )
    `;
    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload, status
      ) values (
        ${ids.emailDelivery}, ${ids.organization}, ${ids.member},
        'password.reset', ${memberEmail},
        ${sql.json({
          v: 1,
          alg: "A256GCM",
          iv: "suspended",
          tag: "suspended",
          ciphertext: "suspended",
        })},
        'pending'
      )
    `;
    await sql`
      insert into webhooks (
        id, organization_id, name, url, signing_secret_encrypted, events,
        active
      ) values (
        ${ids.webhook}, ${ids.organization}, 'Lifecycle webhook',
        'https://example.com/lifecycle', 'unused-while-suspended',
        array['course.updated'], true
      )
    `;
    await sql`
      insert into webhook_deliveries (
        id, organization_id, webhook_id, event, payload, status
      ) values (
        ${ids.webhookDelivery}, ${ids.organization}, ${ids.webhook},
        'course.updated', ${sql.json({ fixture: suffix })}, 'pending'
      )
    `;

    const brandedLogin = await request.get("/login", {
      headers: { Host: `${hostname}:3000` },
    });
    expect(brandedLogin.status()).toBe(200);
    expect(await brandedLogin.text()).toContain(
      `data-public-branding="${slug}"`,
    );

    const login = await request.post("/api/v1/auth/login", {
      data: { organizationSlug: slug, email: memberEmail, password },
    });
    expect(login.status()).toBe(200);
    const activePage = await request.get("/academy", { maxRedirects: 0 });
    expect(activePage.status()).toBe(200);
    const activeApi = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${apiSecret}` },
    });
    expect(activeApi.status()).toBe(200);

    let confirmationError: unknown;
    try {
      await runStatus("suspended", `${slug}-wrong`);
    } catch (error) {
      confirmationError = error;
    }
    expect(confirmationError).toBeTruthy();
    const [beforeSuspend] = await sql<Array<{ status: string }>>`
      select status from organizations where id = ${ids.organization}
    `;
    expect(beforeSuspend.status).toBe("active");

    const suspended = await runStatus("suspended");
    expect(suspended).toMatchObject({
      organizationId: ids.organization,
      previousStatus: "active",
      status: "suspended",
      changed: true,
      revokedApiKeys: 1,
    });
    expect(suspended.revokedSessions).toBeGreaterThanOrEqual(1);
    const repeatedSuspension = await runStatus("suspended");
    expect(repeatedSuspension).toMatchObject({
      previousStatus: "suspended",
      status: "suspended",
      changed: false,
      revokedSessions: 0,
      revokedApiKeys: 0,
    });

    const blockedPage = await request.get("/academy", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(blockedPage.status());
    expect(blockedPage.headers().location).toContain("/login");
    const blockedLogin = await request.post("/api/v1/auth/login", {
      data: { organizationSlug: slug, email: memberEmail, password },
    });
    expect(blockedLogin.status()).toBe(401);
    const blockedApi = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${apiSecret}` },
    });
    expect(blockedApi.status()).toBe(401);

    await sql`
      insert into api_keys (
        id, organization_id, name, prefix, key_hash, scopes, status
      ) values (
        ${ids.bypassKey}, ${ids.organization}, 'Suspended bypass probe',
        ${bypassSecret.slice(0, 16)}, ${sha256(bypassSecret)},
        array['courses:read'], 'active'
      )
    `;
    const centrallyBlockedApi = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${bypassSecret}` },
    });
    expect(centrallyBlockedApi.status()).toBe(401);
    const [untouchedBypass] = await sql<
      Array<{ last_used_at: Date | null }>
    >`
      select last_used_at from api_keys where id = ${ids.bypassKey}
    `;
    expect(untouchedBypass.last_used_at).toBeNull();
    await sql`
      update api_keys
      set status = 'revoked', revoked_at = now()
      where id = ${ids.bypassKey}
    `;

    const [passwordStateBefore] = await sql<
      Array<{ password_hash: string; reset_count: number; mail_count: number }>
    >`
      select
        u.password_hash,
        (select count(*)::int from password_reset_tokens where user_id = u.id) as reset_count,
        (select count(*)::int from email_deliveries where user_id = u.id) as mail_count
      from users u
      where u.id = ${ids.member}
    `;
    const forgot = await request.post("/api/v1/password/forgot", {
      data: { organizationSlug: slug, email: memberEmail },
    });
    expect(forgot.status()).toBe(202);
    await expect(forgot.json()).resolves.not.toHaveProperty(
      "data.developmentToken",
    );
    const reset = await request.post("/api/v1/password/reset", {
      data: { token: resetToken, password: "ChangedLifecycle123!" },
    });
    expect(reset.status()).toBe(400);
    const invitation = await request.post(
      `/api/v1/invitations/${encodeURIComponent(invitationToken)}/accept`,
      { data: { password: "AcceptedLifecycle123!" } },
    );
    expect(invitation.status()).toBe(400);

    const cronSecret = environmentValue("CRON_SECRET");
    const dispatch = await request.post("/api/internal/jobs/dispatch?limit=100", {
      headers: cronSecret
        ? { Authorization: `Bearer ${cronSecret}` }
        : undefined,
    });
    expect(dispatch.status()).toBe(200);

    const [blockedState] = await sql<
      Array<{
        password_hash: string;
        reset_count: number;
        mail_count: number;
        reset_used: Date | null;
        invitation_accepted: Date | null;
        invited_status: string;
        email_status: string;
        email_attempt: number;
        webhook_status: string;
        webhook_attempt: number;
        lifecycle_audits: number;
        foreign_reset_count: number;
        foreign_mail_count: number;
      }>
    >`
      select
        u.password_hash,
        (select count(*)::int from password_reset_tokens where user_id = u.id) as reset_count,
        (select count(*)::int from email_deliveries where user_id = u.id) as mail_count,
        (select used_at from password_reset_tokens where id = ${ids.reset}) as reset_used,
        (select accepted_at from invitations where id = ${ids.invitation}) as invitation_accepted,
        (select status::text from users where id = ${ids.invited}) as invited_status,
        (select status::text from email_deliveries where id = ${ids.emailDelivery}) as email_status,
        (select attempt from email_deliveries where id = ${ids.emailDelivery}) as email_attempt,
        (select status::text from webhook_deliveries where id = ${ids.webhookDelivery}) as webhook_status,
        (select attempt from webhook_deliveries where id = ${ids.webhookDelivery}) as webhook_attempt,
        (select count(*)::int from activity_events where organization_id = ${ids.organization} and type = 'tenant.status_changed') as lifecycle_audits,
        (select count(*)::int from password_reset_tokens where user_id = ${ids.foreignTwin}) as foreign_reset_count,
        (select count(*)::int from email_deliveries where user_id = ${ids.foreignTwin}) as foreign_mail_count
      from users u
      where u.id = ${ids.member}
    `;
    expect(blockedState).toMatchObject({
      password_hash: passwordStateBefore.password_hash,
      reset_count: passwordStateBefore.reset_count,
      mail_count: passwordStateBefore.mail_count,
      reset_used: null,
      invitation_accepted: null,
      invited_status: "invited",
      email_status: "failed",
      email_attempt: 1,
      webhook_status: "pending",
      webhook_attempt: 0,
      lifecycle_audits: 1,
      foreign_reset_count: 0,
      foreign_mail_count: 0,
    });

    const suspendedBranding = await request.get("/login", {
      headers: { Host: `${hostname}:3000` },
    });
    const suspendedHtml = await suspendedBranding.text();
    expect(suspendedHtml).toContain('data-public-branding="default"');
    expect(suspendedHtml).not.toContain(platformName);
    const foreignTenantApi = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${demoApiKey}` },
    });
    expect(foreignTenantApi.status()).toBe(200);

    const reactivated = await runStatus("active");
    expect(reactivated).toMatchObject({
      previousStatus: "suspended",
      status: "active",
      changed: true,
      revokedSessions: 0,
      revokedApiKeys: 0,
    });
    const repeatedReactivation = await runStatus("active");
    expect(repeatedReactivation.changed).toBe(false);

    const stillBlockedPage = await request.get("/academy", {
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308]).toContain(stillBlockedPage.status());
    const stillRevokedApi = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${apiSecret}` },
    });
    expect(stillRevokedApi.status()).toBe(401);
    const restoredBranding = await request.get("/login", {
      headers: { Host: `${hostname}:3000` },
    });
    expect(await restoredBranding.text()).toContain(
      `data-public-branding="${slug}"`,
    );
    const freshLogin = await request.post("/api/v1/auth/login", {
      data: { organizationSlug: slug, email: memberEmail, password },
    });
    expect(freshLogin.status()).toBe(200);

    const offboarding = await runStatus("offboarding");
    expect(offboarding).toMatchObject({
      previousStatus: "active",
      status: "offboarding",
      changed: true,
    });
    expect(offboarding.revokedSessions).toBeGreaterThanOrEqual(1);
    const repeatedOffboarding = await runStatus("offboarding");
    expect(repeatedOffboarding.changed).toBe(false);

    const [finalState] = await sql<
      Array<{
        status: string;
        active_sessions: number;
        active_keys: number;
        lifecycle_audits: number;
        foreign_status: string;
      }>
    >`
      select
        o.status::text,
        (select count(*)::int from user_sessions where organization_id = o.id and revoked_at is null and expires_at > now()) as active_sessions,
        (select count(*)::int from api_keys where organization_id = o.id and status = 'active') as active_keys,
        (select count(*)::int from activity_events where organization_id = o.id and type = 'tenant.status_changed') as lifecycle_audits,
        (select status::text from organizations where slug = 'q-academy') as foreign_status
      from organizations o
      where o.id = ${ids.organization}
    `;
    expect(finalState).toEqual({
      status: "offboarding",
      active_sessions: 0,
      active_keys: 0,
      lifecycle_audits: 3,
      foreign_status: "active",
    });
  } finally {
    await sql`delete from users where id = ${ids.foreignTwin}`;
    await sql`delete from organizations where id = ${ids.organization}`;
    await sql.end();
  }
});
