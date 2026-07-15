import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { compare } from "bcryptjs";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("tenant CLI provisions an atomic invited-owner workspace and rejects retries", async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "single database integration flow");
  test.setTimeout(60_000);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const slug = `tenant-${suffix}`;
  const ownerEmail = `owner-${suffix}@example.test`;
  const appHostname = `${slug}.academy.test`;
  const sql = postgres(databaseUrl, { max: 1 });
  const dataEncryptionKey =
    "TenantProvisioning-Test-Data-Key-2026-7QwE2rT8yU";
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const args = [
    cli,
    "scripts/provision-tenant.ts",
    "--name",
    `Tenant ${suffix}`,
    "--slug",
    slug,
    "--owner-email",
    ownerEmail,
    "--owner-first-name",
    "Erika",
    "--owner-last-name",
    "Musterfrau",
    "--platform-name",
    `Academy ${suffix}`,
    "--accent-color",
    "#198f83",
    "--app-url",
    `https://${appHostname}`,
    "--json",
  ];

  try {
    const first = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATA_ENCRYPTION_KEY: dataEncryptionKey,
        DATA_ENCRYPTION_KEY_ID: "tenant-provisioning-v1",
      },
      timeout: 45_000,
    });
    const output = JSON.parse(first.stdout.trim()) as {
      organizationId: string;
      ownerId: string;
      agentId: string;
      invitationUrl: string;
      emailDeliveryId: string;
    };
    const invitationToken = decodeURIComponent(
      new URL(output.invitationUrl).pathname.split("/").at(-1) ?? "",
    );
    expect(invitationToken).toMatch(/^invite_[A-Za-z0-9_-]{40,}$/);
    expect(first.stdout.split(invitationToken)).toHaveLength(2);

    const [record] = await sql<{
      organization_id: string;
      owner_id: string;
      owner_role: string;
      owner_status: string;
      password_hash: string;
      token_hash: string;
      accepted_at: Date | null;
      settings_count: number;
      login_hostname: string | null;
      agent_id: string;
      agent_active: boolean;
      delivery_status: string;
      delivery_payload: Record<string, unknown>;
    }[]>`
      select
        o.id as organization_id,
        u.id as owner_id,
        u.role as owner_role,
        u.status as owner_status,
        u.password_hash,
        i.token_hash,
        i.accepted_at,
        (select count(*)::int from platform_settings ps where ps.organization_id = o.id) as settings_count,
        (select ps.value ->> 'loginHostname' from platform_settings ps where ps.organization_id = o.id and ps.key = 'design') as login_hostname,
        a.id as agent_id,
        a.active as agent_active,
        ed.status as delivery_status,
        ed.payload as delivery_payload
      from organizations o
      join users u on u.organization_id = o.id
      join invitations i on i.user_id = u.id
      join ai_agents a on a.organization_id = o.id and a.name = 'Q-Coach'
      join email_deliveries ed on ed.id = ${output.emailDeliveryId}
      where o.slug = ${slug}
    `;
    expect(record).toMatchObject({
      organization_id: output.organizationId,
      owner_id: output.ownerId,
      owner_role: "owner",
      owner_status: "invited",
      accepted_at: null,
      settings_count: 2,
      login_hostname: null,
      agent_id: output.agentId,
      agent_active: true,
      delivery_status: "pending",
    });
    expect(record?.password_hash).toMatch(/^\$2[aby]\$/);
    await expect(compare("Demo123!", record!.password_hash)).resolves.toBe(false);
    expect(record?.token_hash).toBe(
      createHash("sha256").update(invitationToken).digest("hex"),
    );
    expect(record?.delivery_payload).toMatchObject({
      v: 2,
      alg: "A256GCM",
      kid: "tenant-provisioning-v1",
    });
    expect(JSON.stringify(record?.delivery_payload)).not.toContain(
      invitationToken,
    );

    let retryError: unknown;
    try {
      await execFileAsync(process.execPath, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          DATA_ENCRYPTION_KEY: dataEncryptionKey,
          DATA_ENCRYPTION_KEY_ID: "tenant-provisioning-v1",
        },
        timeout: 45_000,
      });
    } catch (error) {
      retryError = error;
    }
    expect(retryError).toBeTruthy();
    const retryOutput = retryError as { stdout?: string; stderr?: string };
    expect(retryOutput.stdout ?? "").not.toContain("invite_");
    expect(retryOutput.stderr ?? "").toContain("existiert bereits");

    const [counts] = await sql<{ organizations: number; owners: number }[]>`
      select
        count(distinct o.id)::int as organizations,
        count(distinct u.id)::int as owners
      from organizations o
      left join users u on u.organization_id = o.id
      where o.slug = ${slug}
    `;
    expect(counts).toEqual({ organizations: 1, owners: 1 });
  } finally {
    await sql`delete from organizations where slug = ${slug}`;
    await sql.end();
  }
});
