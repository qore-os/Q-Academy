import "server-only";

import { createHmac } from "node:crypto";

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  aiAgents,
  aiConversations,
  aiMessages,
  authRateLimits,
  organizationContracts,
  organizations,
  platformSettings,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { assertOrganizationFeatureAvailable } from "@/lib/organization-contracts";
import { getAuthRateLimitSecret } from "@/lib/server-environment";

export const AI_AGENT_POLICY_SETTINGS_KEY = "ai_agent_policy";
const MONTHLY_CREDIT_ACTION = "ai_agent_monthly_credits";
const MEMBER_HOURLY_CREDIT_ACTION = "ai_agent_member_hourly";

export const AI_AGENT_POLICY_BOUNDS = {
  monthlyCreditLimit: { min: 100, max: 1_000_000 },
  perMemberHourlyLimit: { min: 1, max: 500 },
} as const;

export const aiAgentPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    monthlyCreditLimit: z
      .number()
      .int()
      .min(AI_AGENT_POLICY_BOUNDS.monthlyCreditLimit.min)
      .max(AI_AGENT_POLICY_BOUNDS.monthlyCreditLimit.max),
    perMemberHourlyLimit: z
      .number()
      .int()
      .min(AI_AGENT_POLICY_BOUNDS.perMemberHourlyLimit.min)
      .max(AI_AGENT_POLICY_BOUNDS.perMemberHourlyLimit.max)
      .nullable(),
  })
  .strict();

const storedAiAgentPolicySchema = aiAgentPolicyInputSchema.extend({
  schemaVersion: z.literal(1),
});

export const aiAgentInsightsPeriodSchema = z.enum([
  "current_month",
  "7d",
  "30d",
  "90d",
]);

export type AiAgentPolicy = z.infer<typeof aiAgentPolicyInputSchema>;
export type AiAgentInsightsPeriod = z.infer<
  typeof aiAgentInsightsPeriodSchema
>;

export const DEFAULT_AI_AGENT_POLICY: Readonly<AiAgentPolicy> = {
  enabled: true,
  monthlyCreditLimit: 10_000,
  perMemberHourlyLimit: 60,
};

export type AiAgentPolicyAdminView = AiAgentPolicy & {
  updatedAt: Date | null;
  configurationStatus: "default" | "valid" | "invalid";
};

export type AiAgentUsageAggregate = {
  conversations: number;
  activeUsers: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
};

export type AiAgentUsageInsights = {
  period: AiAgentInsightsPeriod;
  startsAt: Date;
  endsAt: Date;
  totals: AiAgentUsageAggregate;
  agents: Array<AiAgentUsageAggregate & { name: string }>;
};

type AiAgentPolicyActor = Readonly<{
  id: string;
  organizationId: string;
  role: User["role"];
}>;

type CreditBucket = {
  action: string;
  identifier: string;
  limit: number;
  resetAt: Date;
  reason: "tenant_monthly_credit_limit" | "member_hourly_credit_limit";
  cost: number;
};

class CreditLimitExceeded extends Error {
  constructor(
    readonly bucket: CreditBucket,
    readonly attempts: number,
  ) {
    super("AI agent credit limit exceeded.");
  }
}

function creditKeyHash(action: string, identifier: string) {
  const material = ["v1", action, identifier, ""].join("\0");
  return createHmac("sha256", getAuthRateLimitSecret())
    .update(material)
    .digest("hex");
}

export function aiAgentBudgetWindows(now = new Date()) {
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const nextHour = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
    ),
  );
  return { nextMonth, nextHour };
}

export function aiAgentInsightsWindow(
  period: AiAgentInsightsPeriod,
  now = new Date(),
) {
  const endsAt = new Date(now);
  if (period === "current_month") {
    return {
      startsAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ),
      endsAt,
    };
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return {
    startsAt: new Date(now.getTime() - days * 24 * 60 * 60_000),
    endsAt,
  };
}

function parseStoredPolicy(value: unknown) {
  const parsed = storedAiAgentPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function policyFromStored(value: unknown): AiAgentPolicy {
  const parsed = parseStoredPolicy(value);
  if (!parsed) {
    throw new ApiError(
      503,
      "internal_error",
      "Die KI-Agenten-Policy ist ungueltig. KI-Anfragen bleiben bis zur Korrektur gesperrt.",
    );
  }
  return {
    enabled: parsed.enabled,
    monthlyCreditLimit: parsed.monthlyCreditLimit,
    perMemberHourlyLimit: parsed.perMemberHourlyLimit,
  };
}

async function lockPolicy(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  mode: "shared" | "exclusive",
) {
  if (mode === "shared") {
    await executor.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended(${`ai-agent-policy:${organizationId}`}, 0))`,
    );
    return;
  }
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ai-agent-policy:${organizationId}`}, 0))`,
  );
}

async function policyRow(
  executor: Pick<typeof db, "select">,
  organizationId: string,
) {
  const [row] = await executor
    .select({
      value: platformSettings.value,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, organizationId),
        eq(platformSettings.key, AI_AGENT_POLICY_SETTINGS_KEY),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getAiAgentPolicyAdminView(
  organizationId: string,
): Promise<AiAgentPolicyAdminView> {
  const row = await policyRow(db, organizationId);
  if (!row) {
    return {
      ...DEFAULT_AI_AGENT_POLICY,
      updatedAt: null,
      configurationStatus: "default",
    };
  }
  const policy = parseStoredPolicy(row.value);
  if (!policy) {
    return {
      ...DEFAULT_AI_AGENT_POLICY,
      updatedAt: row.updatedAt,
      configurationStatus: "invalid",
    };
  }
  return {
    enabled: policy.enabled,
    monthlyCreditLimit: policy.monthlyCreditLimit,
    perMemberHourlyLimit: policy.perMemberHourlyLimit,
    updatedAt: row.updatedAt,
    configurationStatus: "valid",
  };
}

export async function getAiAgentPolicy(
  organizationId: string,
): Promise<AiAgentPolicy> {
  const row = await policyRow(db, organizationId);
  return row ? policyFromStored(row.value) : { ...DEFAULT_AI_AGENT_POLICY };
}

export async function requireAiAgentPolicyEnabled(organizationId: string) {
  return db.transaction(async (tx) => {
    return requireAiAgentPolicyEnabledInTransaction(tx, organizationId);
  });
}

export async function requireAiAgentPolicyEnabledInTransaction(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
) {
  await assertOrganizationFeatureAvailable(executor, organizationId, "ai");
  await lockPolicy(executor, organizationId, "shared");
  const row = await policyRow(executor, organizationId);
  const policy = row
    ? policyFromStored(row.value)
    : { ...DEFAULT_AI_AGENT_POLICY };
  if (!policy.enabled) {
    throw new ApiError(
      403,
      "forbidden",
      "KI-Agenten sind fuer diese Academy derzeit deaktiviert.",
      { reason: "ai_agents_disabled" },
    );
  }
  return policy;
}

export async function updateAiAgentPolicy(input: {
  actor: AiAgentPolicyActor;
  policy: AiAgentPolicy;
}) {
  const next = aiAgentPolicyInputSchema.parse(input.policy);
  return db.transaction(async (tx) => {
    await assertOrganizationFeatureAvailable(
      tx,
      input.actor.organizationId,
      "ai",
    );
    await lockPolicy(tx, input.actor.organizationId, "exclusive");
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, input.actor.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .limit(1)
      .for("share");
    const [actor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actor.id),
          eq(users.organizationId, input.actor.organizationId),
          eq(users.status, "active"),
          sql`${users.role} in ('owner', 'admin')`,
        ),
      )
      .limit(1)
      .for("share");
    if (!organization || !actor) {
      throw new ApiError(
        403,
        "forbidden",
        "Die KI-Agenten-Policy darf nicht geaendert werden.",
      );
    }

    const [currentRow] = await tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.organizationId, input.actor.organizationId),
          eq(platformSettings.key, AI_AGENT_POLICY_SETTINGS_KEY),
        ),
      )
      .limit(1)
      .for("update");
    const current = currentRow ? parseStoredPolicy(currentRow.value) : null;
    const unchanged =
      current?.enabled === next.enabled &&
      current.monthlyCreditLimit === next.monthlyCreditLimit &&
      current.perMemberHourlyLimit === next.perMemberHourlyLimit;
    if (unchanged) {
      return { ...next, changed: false };
    }

    const now = new Date();
    const stored = { schemaVersion: 1 as const, ...next };
    await tx
      .insert(platformSettings)
      .values({
        organizationId: input.actor.organizationId,
        key: AI_AGENT_POLICY_SETTINGS_KEY,
        value: stored,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [platformSettings.organizationId, platformSettings.key],
        set: { value: stored, updatedAt: now },
      });
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "ai.agent_policy.updated",
      entityType: "organization",
      entityId: input.actor.organizationId,
      metadata: {
        enabled: next.enabled,
        monthlyCreditLimit: next.monthlyCreditLimit,
        perMemberHourlyLimit: next.perMemberHourlyLimit,
        repairedInvalidConfiguration: Boolean(currentRow && !current),
      },
    });
    return { ...next, changed: true };
  });
}

async function claimCreditBucket(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  bucket: CreditBucket,
  now: Date,
) {
  const nowIso = now.toISOString();
  const resetAtIso = bucket.resetAt.toISOString();
  const [claimed] = await tx
    .insert(authRateLimits)
    .values({
      action: bucket.action,
      keyHash: creditKeyHash(bucket.action, bucket.identifier),
      attempts: bucket.cost,
      resetAt: bucket.resetAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [authRateLimits.action, authRateLimits.keyHash],
      set: {
        attempts: sql<number>`case when ${authRateLimits.resetAt} <= ${nowIso}::timestamptz then ${bucket.cost} else ${authRateLimits.attempts} + ${bucket.cost} end`,
        resetAt: sql<Date>`case when ${authRateLimits.resetAt} <= ${nowIso}::timestamptz then ${resetAtIso}::timestamptz else ${authRateLimits.resetAt} end`,
        updatedAt: now,
      },
    })
    .returning({
      attempts: authRateLimits.attempts,
      resetAt: authRateLimits.resetAt,
    });
  if (!claimed) {
    throw new ApiError(
      503,
      "internal_error",
      "Das KI-Creditbudget konnte nicht reserviert werden.",
    );
  }
  if (claimed.attempts > bucket.limit) {
    throw new CreditLimitExceeded(
      { ...bucket, resetAt: claimed.resetAt },
      claimed.attempts,
    );
  }
  return claimed;
}

export async function reserveAiAgentCredit(input: {
  organizationId: string;
  userId: string;
  units?: number;
  applyMemberHourlyLimit?: boolean;
  now?: Date;
}) {
  const now = input.now ? new Date(input.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new ApiError(500, "internal_error", "Das KI-Creditfenster ist ungueltig.");
  }
  const units = input.units ?? 1;
  if (!Number.isInteger(units) || units < 1 || units > 10_000) {
    throw new ApiError(422, "validation_error", "Die KI-Creditkosten sind ungueltig.");
  }
  try {
    return await db.transaction(async (tx) => {
      await assertOrganizationFeatureAvailable(tx, input.organizationId, "ai");
      await lockPolicy(tx, input.organizationId, "shared");
      const row = await policyRow(tx, input.organizationId);
      const policy = row
        ? policyFromStored(row.value)
        : { ...DEFAULT_AI_AGENT_POLICY };
      if (!policy.enabled) {
        throw new ApiError(
          403,
          "forbidden",
          "KI-Agenten sind fuer diese Academy derzeit deaktiviert.",
          { reason: "ai_agents_disabled" },
        );
      }

      const [contract] = await tx
        .select({ limit: organizationContracts.aiMonthlyCredits })
        .from(organizationContracts)
        .where(eq(organizationContracts.organizationId, input.organizationId))
        .limit(1)
        .for("share");
      const monthlyLimit =
        contract?.limit === null || contract?.limit === undefined
          ? policy.monthlyCreditLimit
          : Math.min(policy.monthlyCreditLimit, contract.limit);

      const windows = aiAgentBudgetWindows(now);
      const buckets: CreditBucket[] = [
        {
          action: MONTHLY_CREDIT_ACTION,
          identifier: input.organizationId,
          limit: monthlyLimit,
          resetAt: windows.nextMonth,
          reason: "tenant_monthly_credit_limit",
          cost: units,
        },
      ];
      if (
        input.applyMemberHourlyLimit !== false &&
        policy.perMemberHourlyLimit !== null
      ) {
        buckets.push({
          action: MEMBER_HOURLY_CREDIT_ACTION,
          identifier: `${input.organizationId}\0${input.userId}`,
          limit: policy.perMemberHourlyLimit,
          resetAt: windows.nextHour,
          reason: "member_hourly_credit_limit",
          cost: units,
        });
      }

      let monthlyAttempts = 0;
      for (const bucket of buckets) {
        const claimed = await claimCreditBucket(tx, bucket, now);
        if (bucket.action === MONTHLY_CREDIT_ACTION) {
          monthlyAttempts = claimed.attempts;
        }
      }
      return {
        creditsUsed: monthlyAttempts,
        remaining: Math.max(0, monthlyLimit - monthlyAttempts),
        resetAt: windows.nextMonth,
      };
    });
  } catch (error) {
    if (error instanceof CreditLimitExceeded) {
      throw new ApiError(
        429,
        "rate_limit_exceeded",
        error.bucket.reason === "tenant_monthly_credit_limit"
          ? "Das monatliche KI-Creditbudget dieser Academy ist erreicht."
          : "Dein stuendliches KI-Creditlimit ist erreicht.",
        {
          reason: error.bucket.reason,
          limit: error.bucket.limit,
          resetAt: error.bucket.resetAt.toISOString(),
        },
      );
    }
    throw error;
  }
}

export async function getCurrentAiAgentCreditUsage(
  organizationId: string,
  policy: AiAgentPolicy,
  now = new Date(),
) {
  const [contract] = await db
    .select({ limit: organizationContracts.aiMonthlyCredits })
    .from(organizationContracts)
    .where(eq(organizationContracts.organizationId, organizationId))
    .limit(1);
  const effectiveLimit =
    contract?.limit === null || contract?.limit === undefined
      ? policy.monthlyCreditLimit
      : Math.min(policy.monthlyCreditLimit, contract.limit);
  const { nextMonth } = aiAgentBudgetWindows(now);
  const [row] = await db
    .select({
      attempts: authRateLimits.attempts,
      resetAt: authRateLimits.resetAt,
    })
    .from(authRateLimits)
    .where(
      and(
        eq(authRateLimits.action, MONTHLY_CREDIT_ACTION),
        eq(
          authRateLimits.keyHash,
          creditKeyHash(MONTHLY_CREDIT_ACTION, organizationId),
        ),
      ),
    )
    .limit(1);
  const creditsUsed =
    row && row.resetAt.getTime() > now.getTime() ? row.attempts : 0;
  return {
    creditsUsed,
    remaining: Math.max(0, effectiveLimit - creditsUsed),
    limit: effectiveLimit,
    resetAt: row && row.resetAt > now ? row.resetAt : nextMonth,
  };
}

export async function getAiAgentUsageInsights(input: {
  organizationId: string;
  period: AiAgentInsightsPeriod;
  now?: Date;
}): Promise<AiAgentUsageInsights> {
  const period = aiAgentInsightsPeriodSchema.parse(input.period);
  const { startsAt, endsAt } = aiAgentInsightsWindow(
    period,
    input.now ?? new Date(),
  );
  const messageScope = and(
    eq(aiMessages.organizationId, input.organizationId),
    gte(aiMessages.createdAt, startsAt),
    lt(aiMessages.createdAt, endsAt),
  );
  const aggregateSelection = {
    conversations:
      sql<number>`count(distinct ${aiConversations.id})::int`.mapWith(Number),
    activeUsers:
      sql<number>`count(distinct ${aiConversations.userId})::int`.mapWith(Number),
    messages: sql<number>`count(${aiMessages.id})::int`.mapWith(Number),
    inputTokens:
      sql<number>`coalesce(sum(${aiMessages.inputTokens}), 0)::bigint`.mapWith(
        Number,
      ),
    outputTokens:
      sql<number>`coalesce(sum(${aiMessages.outputTokens}), 0)::bigint`.mapWith(
        Number,
      ),
  };
  const [totalsRows, agentRows] = await Promise.all([
    db
      .select(aggregateSelection)
      .from(aiMessages)
      .innerJoin(
        aiConversations,
        and(
          eq(aiConversations.id, aiMessages.conversationId),
          eq(aiConversations.organizationId, input.organizationId),
        ),
      )
      .where(messageScope),
    db
      .select({ name: aiAgents.name, ...aggregateSelection })
      .from(aiMessages)
      .innerJoin(
        aiConversations,
        and(
          eq(aiConversations.id, aiMessages.conversationId),
          eq(aiConversations.organizationId, input.organizationId),
        ),
      )
      .innerJoin(
        aiAgents,
        and(
          eq(aiAgents.id, aiConversations.agentId),
          eq(aiAgents.organizationId, input.organizationId),
        ),
      )
      .where(messageScope)
      .groupBy(aiAgents.id, aiAgents.name)
      .orderBy(asc(aiAgents.name)),
  ]);
  const totals = totalsRows[0] ?? {
    conversations: 0,
    activeUsers: 0,
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  return {
    period,
    startsAt,
    endsAt,
    totals,
    agents: agentRows.sort(
      (left, right) =>
        right.messages - left.messages || left.name.localeCompare(right.name),
    ),
  };
}
