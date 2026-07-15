import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function environmentValue(name: string) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

test("auth links are encrypted in a durable recoverable outbox", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted mail outbox flow");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `outbox-${suffix}@example.test`;
  let memberId: string | null = null;
  try {
    const created = await request.post("/api/v1/members", {
      headers: { Authorization: `Bearer ${demoKey}` },
      data: {
        email,
        firstName: "Outbox",
        lastName: "Test",
      },
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as {
      data: {
        id: string;
        invitation: { token: string; link: string };
      };
    };
    memberId = body.data.id;

    const [queued] = await sql<
      Array<{
        id: string;
        event: string;
        recipient_email: string;
        payload: Record<string, unknown>;
        status: string;
        attempt: number;
      }>
    >`
      select id, event, recipient_email, payload, status, attempt
      from email_deliveries
      where user_id = ${memberId}
    `;
    expect(queued).toMatchObject({
      event: "invitation.created",
      recipient_email: email,
    });
    expect(["pending", "processing", "retrying", "delivered"]).toContain(
      queued?.status,
    );
    expect(queued?.attempt).toBeGreaterThanOrEqual(0);
    const persistedPayload = JSON.stringify(queued?.payload);
    expect(persistedPayload).not.toContain(body.data.invitation.token);
    expect(persistedPayload).not.toContain(body.data.invitation.link);
    expect(queued?.payload).toMatchObject({ v: 2, alg: "A256GCM" });
    expect(queued?.payload.kid).toEqual(expect.any(String));

    const cronSecret = environmentValue("CRON_SECRET");
    const dispatched = await request.post(
      "/api/internal/jobs/dispatch?limit=100",
      {
        headers: cronSecret
          ? { Authorization: `Bearer ${cronSecret}` }
          : undefined,
      },
    );
    expect(dispatched.status()).toBe(200);
    const dispatchedBody = (await dispatched.json()) as {
      data: { emailDeliveries: number; cleanup: { mode: string } };
    };
    expect(dispatchedBody.data.emailDeliveries).toBeGreaterThanOrEqual(0);
    expect(dispatchedBody.data.cleanup.mode).toBe("skipped");

    const [processed] = await sql<
      Array<{
        status: string;
        attempt: number;
        claimed_at: Date | null;
        next_retry_at: Date | null;
      }>
    >`
      select status, attempt, claimed_at, next_retry_at
      from email_deliveries
      where id = ${queued!.id}
    `;
    expect(processed?.attempt).toBe(1);
    expect(processed?.claimed_at).toBeNull();
    expect(["retrying", "delivered"]).toContain(processed?.status);
    if (processed?.status === "retrying") {
      expect(processed.next_retry_at).toBeInstanceOf(Date);
    }
  } finally {
    if (memberId) {
      await sql`delete from activity_events where entity_id = ${memberId}`;
      await sql`delete from api_audit_logs where resource_id = ${memberId}`;
      await sql`delete from users where id = ${memberId}`;
    }
    await sql`delete from email_deliveries where recipient_email = ${email}`;
    await sql.end();
  }
});
