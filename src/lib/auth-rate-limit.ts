import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { authRateLimits } from "@/db/schema";
import {
  authRateLimitGuardIdentifiers,
  claimGuardFirstBuckets,
  claimPrimaryFirstBuckets,
} from "@/lib/auth-rate-limit-guards";
import { getAuthRateLimitSecret, trustProxyHeaders } from "@/lib/server-environment";

const CLEANUP_BATCH_SIZE = 32;

export const RATE_LIMIT_POLICIES = {
  login: { limit: 8, windowMs: 15 * 60_000 },
  oidc_login: { limit: 20, windowMs: 15 * 60_000 },
  password_forgot: { limit: 8, windowMs: 15 * 60_000 },
  password_reset: { limit: 8, windowMs: 15 * 60_000 },
  ai_course_generation: { limit: 5, windowMs: 60 * 60_000 },
  ai_course_generation_concurrent: { limit: 1, windowMs: 60_000 },
  ai_message: { limit: 60, windowMs: 60 * 60_000 },
  ai_message_tenant: { limit: 1_000, windowMs: 60 * 60_000 },
  ai_message_concurrent: { limit: 1, windowMs: 90_000 },
  api_read: { limit: 240, windowMs: 60_000 },
  api_write: { limit: 120, windowMs: 60_000 },
  api_read_tenant: { limit: 4_000, windowMs: 60_000 },
  api_write_tenant: { limit: 2_000, windowMs: 60_000 },
  media_upload_intent: { limit: 30, windowMs: 60_000 },
  media_upload_intent_tenant: { limit: 300, windowMs: 60_000 },
  media_download: { limit: 60, windowMs: 60_000 },
  media_download_tenant: { limit: 600, windowMs: 60_000 },
  privacy_step_up: { limit: 6, windowMs: 15 * 60_000 },
  privacy_export_download: { limit: 6, windowMs: 15 * 60_000 },
  privacy_export_download_tenant: { limit: 30, windowMs: 15 * 60_000 },
  privacy_export_download_concurrent: { limit: 1, windowMs: 15 * 60_000 },
  mfa_challenge: { limit: 6, windowMs: 10 * 60_000 },
  mfa_management: { limit: 6, windowMs: 15 * 60_000 },
  community_report: { limit: 20, windowMs: 60 * 60_000 },
  community_report_tenant: { limit: 500, windowMs: 60 * 60_000 },
  community_post_create: { limit: 30, windowMs: 10 * 60_000 },
  community_post_create_tenant: { limit: 600, windowMs: 10 * 60_000 },
  community_comment_create: { limit: 60, windowMs: 10 * 60_000 },
  community_comment_create_tenant: { limit: 1_200, windowMs: 10 * 60_000 },
  community_follow_mutation: { limit: 60, windowMs: 10 * 60_000 },
  community_follow_mutation_tenant: { limit: 2_000, windowMs: 10 * 60_000 },
  community_boost_mutation: { limit: 30, windowMs: 10 * 60_000 },
  community_boost_mutation_tenant: { limit: 500, windowMs: 10 * 60_000 },
  community_feed_read: { limit: 120, windowMs: 60_000 },
  community_feed_read_tenant: { limit: 3_000, windowMs: 60_000 },
  community_comment_read: { limit: 180, windowMs: 60_000 },
  community_comment_read_tenant: { limit: 4_000, windowMs: 60_000 },
  community_reaction_mutation: { limit: 120, windowMs: 10 * 60_000 },
  community_reaction_mutation_tenant: { limit: 4_000, windowMs: 10 * 60_000 },
  community_vote_mutation: { limit: 120, windowMs: 10 * 60_000 },
  community_vote_mutation_tenant: { limit: 4_000, windowMs: 10 * 60_000 },
  transcript_search: { limit: 240, windowMs: 60_000 },
  transcript_search_tenant: { limit: 5_000, windowMs: 60_000 },
  learning_time_heartbeat: { limit: 300, windowMs: 10 * 60_000 },
  learning_time_heartbeat_tenant: { limit: 30_000, windowMs: 10 * 60_000 },
  media_playback_heartbeat: { limit: 180, windowMs: 10 * 60_000 },
  media_playback_heartbeat_tenant: { limit: 30_000, windowMs: 10 * 60_000 },
} as const;

const AUTH_SCOPE_POLICIES = {
  login: { limit: 2_000, windowMs: 15 * 60_000 },
  oidc_login: { limit: 2_000, windowMs: 15 * 60_000 },
  password_forgot: { limit: 2_000, windowMs: 15 * 60_000 },
  password_reset: { limit: 10_000, windowMs: 15 * 60_000 },
} as const;

const AUTH_GLOBAL_POLICIES = {
  login: { limit: 20_000, windowMs: 15 * 60_000 },
  oidc_login: { limit: 20_000, windowMs: 15 * 60_000 },
  password_forgot: { limit: 10_000, windowMs: 15 * 60_000 },
  password_reset: { limit: 20_000, windowMs: 15 * 60_000 },
} as const;

const AUTH_IP_POLICIES = {
  login: { limit: 40, windowMs: 15 * 60_000 },
  oidc_login: { limit: 80, windowMs: 15 * 60_000 },
  password_forgot: { limit: 24, windowMs: 15 * 60_000 },
  password_reset: { limit: 40, windowMs: 15 * 60_000 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMIT_POLICIES;
export type AuthRateLimitAction = Extract<
  RateLimitAction,
  "login" | "oidc_login" | "password_forgot" | "password_reset"
>;

type HeaderReader = Pick<Headers, "get">;
type BucketPolicy = { limit: number; windowMs: number };
type BucketSpec = {
  action: string;
  identifier: string;
  policy: BucketPolicy;
};
type BucketClaimOrder = "guard-first" | "primary-first";

export type RateLimitResult = {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
};

class RollbackRateLimitClaim extends Error {
  constructor(readonly result: RateLimitResult) {
    super("Rollback authenticated rate-limit claims.");
    this.name = "RollbackRateLimitClaim";
  }
}

function getHashSecret() {
  return getAuthRateLimitSecret();
}

function trustedProxyIp(headers?: HeaderReader) {
  if (!trustProxyHeaders() || !headers) return null;
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor || forwardedFor.length > 512) return null;
  const candidate = forwardedFor.split(",")[0]?.trim();
  if (!candidate || isIP(candidate) === 0) return null;
  return candidate.toLowerCase();
}

function keyHash(action: string, identifier: string) {
  const material = ["v1", action, identifier, ""].join("\0");
  return createHmac("sha256", getHashSecret()).update(material).digest("hex");
}

export function normalizeAuthEmail(email: string) {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function tenantAuthIdentifier(
  tenantIdOrSlug: string | null | undefined,
  email: string,
) {
  const tenant = tenantIdOrSlug?.normalize("NFKC").trim().toLowerCase();
  return `${tenant || "unresolved"}\0${normalizeAuthEmail(email)}`;
}

async function consumeBucketSet(
  guardBuckets: BucketSpec[],
  primaryBucket: BucketSpec,
  order: BucketClaimOrder,
): Promise<RateLimitResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`
        delete from ${authRateLimits}
        where ctid in (
          select ctid
          from ${authRateLimits}
          where ${authRateLimits.resetAt} <= ${nowIso}::timestamptz
          order by ${authRateLimits.resetAt} asc
          limit ${CLEANUP_BATCH_SIZE}
        )
      `);

      const claim = async (bucket: BucketSpec) => {
        const nextResetAt = new Date(now.getTime() + bucket.policy.windowMs);
        const nextResetAtIso = nextResetAt.toISOString();
        const [claimed] = await tx
          .insert(authRateLimits)
          .values({
            action: bucket.action,
            keyHash: keyHash(bucket.action, bucket.identifier),
            attempts: 1,
            resetAt: nextResetAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [authRateLimits.action, authRateLimits.keyHash],
            set: {
              attempts: sql<number>`case when ${authRateLimits.resetAt} <= ${nowIso}::timestamptz then 1 else ${authRateLimits.attempts} + 1 end`,
              resetAt: sql<Date>`case when ${authRateLimits.resetAt} <= ${nowIso}::timestamptz then ${nextResetAtIso}::timestamptz else ${authRateLimits.resetAt} end`,
              updatedAt: now,
            },
          })
          .returning({
            attempts: authRateLimits.attempts,
            resetAt: authRateLimits.resetAt,
          });
        if (!claimed) {
          throw new Error("The persistent rate-limit bucket could not be claimed.");
        }
        return {
          limited: claimed.attempts > bucket.policy.limit,
          limit: bucket.policy.limit,
          remaining: Math.max(0, bucket.policy.limit - claimed.attempts),
          resetAt: claimed.resetAt,
        };
      };

      if (order === "guard-first") {
        return claimGuardFirstBuckets(guardBuckets, primaryBucket, claim);
      }

      const outcome = await claimPrimaryFirstBuckets(
        primaryBucket,
        guardBuckets,
        claim,
      );
      if (outcome.rollbackRequired) {
        throw new RollbackRateLimitClaim(outcome.result);
      }
      return outcome.result;
    });
  } catch (error) {
    if (error instanceof RollbackRateLimitClaim) return error.result;
    throw error;
  }
}

export async function consumePersistentRateLimit(input: {
  action: RateLimitAction;
  identifier: string;
}) {
  return consumeBucketSet(
    [],
    {
      action: input.action,
      identifier: input.identifier,
      policy: RATE_LIMIT_POLICIES[input.action],
    },
    "primary-first",
  );
}

export async function consumeGuardedPersistentRateLimit(input: {
  guards: Array<{ action: RateLimitAction; identifier: string }>;
  primary: { action: RateLimitAction; identifier: string };
}) {
  return consumeBucketSet(
    input.guards.map((guard) => ({
      ...guard,
      policy: RATE_LIMIT_POLICIES[guard.action],
    })),
    {
      ...input.primary,
      policy: RATE_LIMIT_POLICIES[input.primary.action],
    },
    // Authenticated actors have a stable primary key. Checking it first keeps
    // their rejected traffic from exhausting the shared tenant bucket.
    "primary-first",
  );
}

export async function clearPersistentRateLimit(input: {
  action: RateLimitAction;
  identifier: string;
  expectedResetAt?: Date;
}) {
  const predicates = [
    eq(authRateLimits.action, input.action),
    eq(authRateLimits.keyHash, keyHash(input.action, input.identifier)),
  ];
  if (input.expectedResetAt) {
    predicates.push(eq(authRateLimits.resetAt, input.expectedResetAt));
  }
  return db
    .delete(authRateLimits)
    .where(and(...predicates))
    .returning({ resetAt: authRateLimits.resetAt });
}

export async function consumeAuthRateLimit(input: {
  action: AuthRateLimitAction;
  identifier: string;
  scopeIdentifier: string;
  headers?: HeaderReader;
}) {
  const ip = trustedProxyIp(input.headers);
  const guardBuckets: BucketSpec[] = authRateLimitGuardIdentifiers(
    input.scopeIdentifier,
    ip,
  ).map((guard) => ({
    action: `${input.action}_${guard.kind}`,
    identifier: guard.identifier,
    policy:
      guard.kind === "ip"
        ? AUTH_IP_POLICIES[input.action]
        : guard.kind === "global"
          ? AUTH_GLOBAL_POLICIES[input.action]
          : AUTH_SCOPE_POLICIES[input.action],
  }));

  return consumeBucketSet(
    guardBuckets,
    {
      action: input.action,
      identifier: input.identifier,
      policy: RATE_LIMIT_POLICIES[input.action],
    },
    // Public auth attackers can vary the email or slug, so stable aggregate
    // IP, scope, and global guards must be claimed before the primary bucket.
    "guard-first",
  );
}

export async function clearAuthRateLimit(input: {
  action: AuthRateLimitAction;
  identifier: string;
}) {
  return clearPersistentRateLimit(input);
}

export function retryAfterSeconds(resetAt: Date) {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
}
