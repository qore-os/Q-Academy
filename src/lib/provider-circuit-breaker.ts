import "server-only";

import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { authRateLimits } from "@/db/schema";
import { getAuthRateLimitSecret } from "@/lib/server-environment";

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 5 * 60_000;
const OPEN_INTERVAL_MS = 60_000;
const HALF_OPEN_LEASE_MS = 35_000;
const CIRCUIT_ACTION = "provider_circuit_breaker";

function circuitHash(providerKey: string) {
  return createHmac("sha256", getAuthRateLimitSecret())
    .update("q-academy:provider-circuit:v1\0")
    .update(providerKey)
    .digest("hex");
}

function safeProviderKey(value: string) {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(value)) {
    throw new Error("Provider circuit key is invalid.");
  }
  return value;
}

export async function acquireProviderCircuitPermission(input: {
  providerKey: string;
  now?: Date;
}) {
  const providerKey = safeProviderKey(input.providerKey);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`provider-circuit:${providerKey}`}, 0))`,
    );
    const keyHash = circuitHash(providerKey);
    const [state] = await tx
      .select({
        failures: authRateLimits.attempts,
        retryAt: authRateLimits.resetAt,
      })
      .from(authRateLimits)
      .where(
        and(
          eq(authRateLimits.action, CIRCUIT_ACTION),
          eq(authRateLimits.keyHash, keyHash),
        ),
      )
      .limit(1)
      .for("update");
    if (!state || state.failures < FAILURE_THRESHOLD) {
      return { allowed: true, probe: false, retryAt: null } as const;
    }
    if (state.retryAt > now) {
      return { allowed: false, probe: false, retryAt: state.retryAt } as const;
    }

    const retryAt = new Date(now.getTime() + HALF_OPEN_LEASE_MS);
    await tx
      .update(authRateLimits)
      .set({ resetAt: retryAt, updatedAt: now })
      .where(
        and(
          eq(authRateLimits.action, CIRCUIT_ACTION),
          eq(authRateLimits.keyHash, keyHash),
        ),
      );
    return { allowed: true, probe: true, retryAt } as const;
  });
}

export async function recordProviderCircuitSuccess(providerKeyInput: string) {
  const providerKey = safeProviderKey(providerKeyInput);
  await db
    .delete(authRateLimits)
    .where(
      and(
        eq(authRateLimits.action, CIRCUIT_ACTION),
        eq(authRateLimits.keyHash, circuitHash(providerKey)),
      ),
    );
}

export async function recordProviderCircuitFailure(input: {
  providerKey: string;
  now?: Date;
}) {
  const providerKey = safeProviderKey(input.providerKey);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`provider-circuit:${providerKey}`}, 0))`,
    );
    const keyHash = circuitHash(providerKey);
    const [current] = await tx
      .select({
        failures: authRateLimits.attempts,
        retryAt: authRateLimits.resetAt,
        updatedAt: authRateLimits.updatedAt,
      })
      .from(authRateLimits)
      .where(
        and(
          eq(authRateLimits.action, CIRCUIT_ACTION),
          eq(authRateLimits.keyHash, keyHash),
        ),
      )
      .limit(1)
      .for("update");
    const withinFailureWindow =
      current && current.updatedAt.getTime() > now.getTime() - FAILURE_WINDOW_MS;
    const failures = withinFailureWindow ? current.failures + 1 : 1;
    const retryAt = new Date(
      now.getTime() +
        (failures >= FAILURE_THRESHOLD ? OPEN_INTERVAL_MS : FAILURE_WINDOW_MS),
    );
    await tx
      .insert(authRateLimits)
      .values({
        action: CIRCUIT_ACTION,
        keyHash,
        attempts: failures,
        resetAt: retryAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [authRateLimits.action, authRateLimits.keyHash],
        set: { attempts: failures, resetAt: retryAt, updatedAt: now },
      });
    return { failures, open: failures >= FAILURE_THRESHOLD, retryAt };
  });
}
