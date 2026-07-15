import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { acknowledgeAiTransparency } from "./helpers/ai-transparency";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

test("REST and Q-Coach limits are shared through PostgreSQL", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted distributed rate-limit flow",
  );

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql`
      delete from auth_rate_limits
      where action in (
        'api_read',
        'api_read_tenant',
        'ai_message',
        'ai_message_tenant',
        'ai_message_concurrent'
      )
    `;
    await sql`
      delete from ai_conversations
      where user_id = (
        select id from users
        where email = 'lea@q-academy.de'
        limit 1
      )
    `;

    const apiResponse = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${demoKey}` },
    });
    expect(apiResponse.status()).toBe(200);

    const apiBuckets = await sql<{ action: string; attempts: number }[]>`
      select action, attempts
      from auth_rate_limits
      where action in ('api_read', 'api_read_tenant')
      order by action
    `;
    expect(apiBuckets).toEqual([
      { action: "api_read", attempts: 1 },
      { action: "api_read_tenant", attempts: 1 },
    ]);

    await page.goto("/login");
    await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
    await page.waitForURL("**/academy");
    await acknowledgeAiTransparency(page);

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        page.request.post("/api/ai", {
          data: {
            message: `Erstelle einen parallelen Lernplan ${index + 1}.`,
          },
        }),
      ),
    );
    const statuses = responses.map((response) => response.status());
    const accepted = statuses.filter((status) => status === 200).length;
    const limited = statuses.filter((status) => status === 429).length;
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(limited).toBeGreaterThanOrEqual(1);
    expect(accepted + limited).toBe(responses.length);
    for (const response of responses.filter(
      (candidate) => candidate.status() === 429,
    )) {
      expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
      await expect(response.json()).resolves.toMatchObject({
        code: "rate_limit_exceeded",
      });
    }

    const aiBuckets = await sql<{ action: string; attempts: number }[]>`
      select action, attempts
      from auth_rate_limits
      where action in (
        'ai_message',
        'ai_message_tenant',
        'ai_message_concurrent'
      )
      order by action
    `;
    expect(aiBuckets).toEqual([
      { action: "ai_message", attempts: accepted },
      { action: "ai_message_tenant", attempts: accepted },
    ]);

    const stored = await sql<{ conversations: number; messages: number }[]>`
      select
        count(distinct conversation.id)::int as conversations,
        count(message.id)::int as messages
      from ai_conversations conversation
      left join ai_messages message
        on message.conversation_id = conversation.id
      where conversation.user_id = (
        select id from users
        where email = 'lea@q-academy.de'
        limit 1
      )
    `;
    expect(stored[0]).toEqual({
      conversations: accepted,
      messages: accepted * 2,
    });
  } finally {
    await sql`
      delete from ai_conversations
      where user_id = (
        select id from users
        where email = 'lea@q-academy.de'
        limit 1
      )
    `;
    await sql`
      delete from auth_rate_limits
      where action in (
        'api_read',
        'api_read_tenant',
        'ai_message',
        'ai_message_tenant',
        'ai_message_concurrent'
      )
    `;
    await sql.end();
  }
});
