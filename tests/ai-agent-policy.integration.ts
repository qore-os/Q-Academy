import assert from "node:assert/strict";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  createAiConversation,
  deleteEmptyAiConversation,
} from "../src/lib/ai/conversations";
import {
  aiAgentBudgetWindows,
  getAiAgentUsageInsights,
  getCurrentAiAgentCreditUsage,
  reserveAiAgentCredit,
  updateAiAgentPolicy,
} from "../src/lib/ai/agent-policy";
import { createAiAgentDraftIdentity } from "../src/lib/ai/agent-studio";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 4, prepare: false });
const creditActions = [
  "ai_agent_monthly_credits",
  "ai_agent_member_hourly",
] as const;

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

function apiError(status: number, reason?: string) {
  return (error: unknown) => {
    assert.equal(
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : null,
      status,
    );
    if (reason) {
      const details =
        typeof error === "object" && error !== null && "details" in error
          ? error.details
          : null;
      assert.equal(
        typeof details === "object" && details !== null && "reason" in details
          ? details.reason
          : null,
        reason,
      );
    }
    return true;
  };
}

test(
  "agent credits serialize concurrent claims, reset on calendar boundaries and isolate tenants",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const budgetNow = new Date(
      Date.UTC(new Date().getUTCFullYear() + 1, 6, 12, 10, 15),
    );
    const beforeRows = await sql<Array<{ action: string; key_hash: string }>>`
      select action, key_hash
      from auth_rate_limits
      where action = any(${creditActions as unknown as string[]})
    `;
    const beforeKeys = new Set(
      beforeRows.map((row) => `${row.action}:${row.key_hash}`),
    );
    let organizationIds: string[] = [];

    try {
      const organizations = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values
          (${`AI policy primary ${suffix}`}, ${`ai-policy-primary-${suffix}`}),
          (${`AI policy foreign ${suffix}`}, ${`ai-policy-foreign-${suffix}`})
        returning id
      `;
      organizationIds = organizations.map((organization) => organization.id);
      const [primaryOrganization, foreignOrganization] = organizations;
      assert.ok(primaryOrganization && foreignOrganization);

      const createdUsers = await sql<
        Array<{
          id: string;
          organization_id: string;
          email: string;
          role: "owner" | "member";
        }>
      >`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${primaryOrganization.id}, ${`owner-primary-${suffix}@example.test`}, 'unused', 'Policy', 'Owner', 'owner'),
          (${primaryOrganization.id}, ${`member-primary-${suffix}@example.test`}, 'unused', 'Policy', 'Member', 'member'),
          (${foreignOrganization.id}, ${`owner-foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Owner', 'owner'),
          (${foreignOrganization.id}, ${`member-foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', 'member')
        returning id, organization_id, email, role
      `;
      const user = (emailPrefix: string) =>
        createdUsers.find((candidate) =>
          candidate.email.startsWith(emailPrefix),
        )!;
      const primaryOwner = user("owner-primary-");
      const primaryMember = user("member-primary-");
      const foreignOwner = user("owner-foreign-");
      const foreignMember = user("member-foreign-");
      const primaryPolicy = {
        enabled: true,
        monthlyCreditLimit: 100,
        perMemberHourlyLimit: 2,
      } as const;
      const foreignPolicy = {
        enabled: true,
        monthlyCreditLimit: 100,
        perMemberHourlyLimit: 1,
      } as const;

      await Promise.all([
        updateAiAgentPolicy({
          actor: {
            id: primaryOwner.id,
            organizationId: primaryOrganization.id,
            role: primaryOwner.role,
          },
          policy: primaryPolicy,
        }),
        updateAiAgentPolicy({
          actor: {
            id: foreignOwner.id,
            organizationId: foreignOrganization.id,
            role: foreignOwner.role,
          },
          policy: foreignPolicy,
        }),
      ]);

      const concurrent = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          reserveAiAgentCredit({
            organizationId: primaryOrganization.id,
            userId: primaryMember.id,
            now: budgetNow,
          }),
        ),
      );
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        2,
      );
      const rejected = concurrent.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      assert.equal(rejected.length, 6);
      rejected.forEach((result) =>
        assert.ok(apiError(429, "member_hourly_credit_limit")(result.reason)),
      );
      assert.deepEqual(
        await getCurrentAiAgentCreditUsage(
          primaryOrganization.id,
          primaryPolicy,
          budgetNow,
        ).then(({ creditsUsed, remaining }) => ({ creditsUsed, remaining })),
        { creditsUsed: 2, remaining: 98 },
      );

      await reserveAiAgentCredit({
        organizationId: foreignOrganization.id,
        userId: foreignMember.id,
      });
      assert.equal(
        (
          await getCurrentAiAgentCreditUsage(
            foreignOrganization.id,
            foreignPolicy,
          )
        ).creditsUsed,
        1,
      );

      await updateAiAgentPolicy({
        actor: {
          id: foreignOwner.id,
          organizationId: foreignOrganization.id,
          role: foreignOwner.role,
        },
        policy: { ...foreignPolicy, enabled: false },
      });
      await assert.rejects(
        reserveAiAgentCredit({
          organizationId: foreignOrganization.id,
          userId: foreignMember.id,
        }),
        apiError(403, "ai_agents_disabled"),
      );
      assert.equal(
        (
          await getCurrentAiAgentCreditUsage(
            foreignOrganization.id,
            foreignPolicy,
          )
        ).creditsUsed,
        1,
      );

      const currentWindows = aiAgentBudgetWindows(budgetNow);
      const afterHourlyReset = new Date(
        currentWindows.nextHour.getTime() + 60_000,
      );
      await reserveAiAgentCredit({
        organizationId: primaryOrganization.id,
        userId: primaryMember.id,
        now: afterHourlyReset,
      });
      assert.equal(
        (
          await getCurrentAiAgentCreditUsage(
            primaryOrganization.id,
            primaryPolicy,
            afterHourlyReset,
          )
        ).creditsUsed,
        3,
      );
      const afterMonthlyReset = new Date(
        currentWindows.nextMonth.getTime() + 60_000,
      );
      await reserveAiAgentCredit({
        organizationId: primaryOrganization.id,
        userId: primaryMember.id,
        now: afterMonthlyReset,
      });
      assert.equal(
        (
          await getCurrentAiAgentCreditUsage(
            primaryOrganization.id,
            primaryPolicy,
            afterMonthlyReset,
          )
        ).creditsUsed,
        1,
      );

      const primaryAgent = await createAiAgentDraftIdentity({
        actor: {
          id: primaryOwner.id,
          organizationId: primaryOrganization.id,
          role: primaryOwner.role,
        },
        name: `Insights primary ${suffix}`,
        description: "Aggregated policy test agent.",
        systemPrompt: "Answer only from approved test context.",
        color: "#2bb7a9",
        icon: "bot",
        publish: true,
        active: true,
      });
      const foreignAgent = await createAiAgentDraftIdentity({
        actor: {
          id: foreignOwner.id,
          organizationId: foreignOrganization.id,
          role: foreignOwner.role,
        },
        name: `Insights foreign ${suffix}`,
        description: "Foreign aggregated policy test agent.",
        systemPrompt: "Answer only from approved foreign test context.",
        color: "#365f8d",
        icon: "bot",
        publish: true,
        active: true,
      });
      const emptyConversation = await createAiConversation({
        organizationId: primaryOrganization.id,
        agentId: primaryAgent.agentId,
        userId: primaryMember.id,
      });
      assert.equal(
        await deleteEmptyAiConversation({
          organizationId: primaryOrganization.id,
          conversationId: emptyConversation.id,
          userId: primaryMember.id,
        }),
        true,
      );
      assert.equal(
        await deleteEmptyAiConversation({
          organizationId: primaryOrganization.id,
          conversationId: emptyConversation.id,
          userId: primaryMember.id,
        }),
        false,
      );
      const nonEmptyConversation = await createAiConversation({
        organizationId: primaryOrganization.id,
        agentId: primaryAgent.agentId,
        userId: primaryMember.id,
      });
      await sql`
        insert into ai_messages (
          organization_id, conversation_id, role, content
        ) values (
          ${primaryOrganization.id}, ${nonEmptyConversation.id}, 'user',
          'Must prevent compensation cleanup.'
        )
      `;
      assert.equal(
        await deleteEmptyAiConversation({
          organizationId: primaryOrganization.id,
          conversationId: nonEmptyConversation.id,
          userId: primaryMember.id,
        }),
        false,
      );
      await sql`delete from ai_conversations where id = ${nonEmptyConversation.id}`;
      await assert.rejects(
        createAiConversation({
          organizationId: foreignOrganization.id,
          agentId: foreignAgent.agentId,
          userId: foreignMember.id,
        }),
        apiError(403, "ai_agents_disabled"),
      );
      const agentRows = await sql<
        Array<{
          id: string;
          organization_id: string;
          published_version_id: string;
        }>
      >`
        select id, organization_id, published_version_id
        from ai_agents
        where id in (${primaryAgent.agentId}, ${foreignAgent.agentId})
      `;
      const primaryAgentRow = agentRows.find(
        (agent) => agent.organization_id === primaryOrganization.id,
      )!;
      const foreignAgentRow = agentRows.find(
        (agent) => agent.organization_id === foreignOrganization.id,
      )!;
      const conversations = await sql<
        Array<{ id: string; organization_id: string }>
      >`
        insert into ai_conversations (
          organization_id, agent_id, agent_version_id, user_id, title
        ) values
          (${primaryOrganization.id}, ${primaryAgentRow.id}, ${primaryAgentRow.published_version_id}, ${primaryMember.id}, 'Primary member'),
          (${primaryOrganization.id}, ${primaryAgentRow.id}, ${primaryAgentRow.published_version_id}, ${primaryOwner.id}, 'Primary owner'),
          (${foreignOrganization.id}, ${foreignAgentRow.id}, ${foreignAgentRow.published_version_id}, ${foreignMember.id}, 'Foreign member')
        returning id, organization_id
      `;
      const primaryConversations = conversations.filter(
        (conversation) =>
          conversation.organization_id === primaryOrganization.id,
      );
      const foreignConversation = conversations.find(
        (conversation) =>
          conversation.organization_id === foreignOrganization.id,
      )!;
      const secret = `TOP_SECRET_${suffix}`;
      const insightNow = new Date();
      const insightMessageAt = new Date(insightNow.getTime() - 1_000);
      await sql`
        insert into ai_messages (
          organization_id, conversation_id, role, content, input_tokens,
          output_tokens, created_at
        ) values
          (${primaryOrganization.id}, ${primaryConversations[0]!.id}, 'user', ${secret}, 0, 0, ${insightMessageAt}),
          (${primaryOrganization.id}, ${primaryConversations[0]!.id}, 'assistant', 'Private answer', 10, 5, ${insightMessageAt}),
          (${primaryOrganization.id}, ${primaryConversations[1]!.id}, 'user', 'Another private prompt', 0, 0, ${insightMessageAt}),
          (${foreignOrganization.id}, ${foreignConversation.id}, 'assistant', 'Foreign private answer', 999, 999, ${insightMessageAt})
      `;
      const insights = await getAiAgentUsageInsights({
        organizationId: primaryOrganization.id,
        period: "current_month",
        now: insightNow,
      });
      assert.deepEqual(insights.totals, {
        conversations: 2,
        activeUsers: 2,
        messages: 3,
        inputTokens: 10,
        outputTokens: 5,
      });
      assert.equal(insights.agents.length, 1);
      const serializedInsights = JSON.stringify(insights);
      for (const privateValue of [
        secret,
        primaryOrganization.id,
        primaryMember.id,
        primaryOwner.email,
        primaryConversations[0]!.id,
        primaryAgentRow.id,
      ]) {
        assert.equal(serializedInsights.includes(privateValue), false);
      }

      const storedKeys = await sql<
        Array<{ action: string; key_hash: string }>
      >`
        select action, key_hash
        from auth_rate_limits
        where action = any(${creditActions as unknown as string[]})
      `;
      const newKeys = storedKeys.filter(
        (row) => !beforeKeys.has(`${row.action}:${row.key_hash}`),
      );
      assert.ok(newKeys.length >= 4);
      for (const row of newKeys) {
        assert.match(row.key_hash, /^[a-f0-9]{64}$/);
        assert.equal(row.key_hash.includes(primaryOrganization.id), false);
        assert.equal(row.key_hash.includes(primaryMember.id), false);
      }
    } finally {
      if (organizationIds.length) {
        await sql`delete from organizations where id = any(${organizationIds}::uuid[])`;
      }
      const afterRows = await sql<Array<{ action: string; key_hash: string }>>`
        select action, key_hash
        from auth_rate_limits
        where action = any(${creditActions as unknown as string[]})
      `;
      const added = afterRows.filter(
        (row) => !beforeKeys.has(`${row.action}:${row.key_hash}`),
      );
      for (const row of added) {
        await sql`
          delete from auth_rate_limits
          where action = ${row.action} and key_hash = ${row.key_hash}
        `;
      }
    }
  },
);
