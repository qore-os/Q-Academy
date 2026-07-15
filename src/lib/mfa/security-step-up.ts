import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  userMfaConfigurations,
  userSessions,
  type User,
} from "@/db/schema";
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { acquireMfaUserAdvisoryLock } from "@/lib/mfa/locks";
import { verifyMfaSecondFactor } from "@/lib/mfa/second-factor";

export class MfaSecurityStepUpError extends Error {
  constructor(
    readonly code: "required" | "invalid" | "rate_limited",
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "MfaSecurityStepUpError";
  }
}

export async function verifyAndConsumeMfaSecurityStepUp(
  actor: Pick<User, "id" | "organizationId">,
  code: string,
  sessionId?: string,
) {
  const [current] = await db
    .select({ status: userMfaConfigurations.status })
    .from(userMfaConfigurations)
    .where(
      and(
        eq(userMfaConfigurations.userId, actor.id),
        eq(userMfaConfigurations.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (current?.status !== "enabled") return { required: false as const };

  const identifier = `${actor.organizationId}:${actor.id}`;
  const limit = await consumePersistentRateLimit({
    action: "mfa_management",
    identifier,
  });
  if (limit.limited) {
    throw new MfaSecurityStepUpError(
      "rate_limited",
      "Zu viele Sicherheitsversuche. Bitte spaeter erneut versuchen.",
      retryAfterSeconds(limit.resetAt),
    );
  }
  const normalizedCode = code.trim();
  if (!normalizedCode || normalizedCode.length > 64) {
    throw new MfaSecurityStepUpError(
      "required",
      "Bestaetige diese Aktion mit deinem MFA- oder Recovery-Code.",
    );
  }
  const now = new Date();
  const verificationMethod = await db.transaction(async (tx) => {
    await acquireMfaUserAdvisoryLock(tx, actor);
    const [configuration] = await tx
      .select()
      .from(userMfaConfigurations)
      .where(
        and(
          eq(userMfaConfigurations.userId, actor.id),
          eq(userMfaConfigurations.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (configuration?.status !== "enabled") return null;
    const proof = verifyMfaSecondFactor(configuration, normalizedCode);
    if (!proof) {
      throw new MfaSecurityStepUpError(
        "invalid",
        "Der MFA- oder Recovery-Code ist nicht korrekt.",
      );
    }
    await tx
      .update(userMfaConfigurations)
      .set({
        recoveryCodeHashes: proof.recoveryCodeHashes,
        lastTotpCounter: proof.counter,
        updatedAt: now,
      })
      .where(
        and(
          eq(userMfaConfigurations.userId, actor.id),
          eq(userMfaConfigurations.organizationId, actor.organizationId),
        ),
      );
    if (sessionId) {
      await tx
        .update(userSessions)
        .set({ mfaVerifiedAt: now, mfaMethod: proof.method })
        .where(
          and(
            eq(userSessions.id, sessionId),
            eq(userSessions.userId, actor.id),
            eq(userSessions.organizationId, actor.organizationId),
            isNull(userSessions.revokedAt),
          ),
        );
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "security.mfa.step_up",
      entityType: "user",
      entityId: actor.id,
      metadata: { method: proof.method, purpose: "oidc_configuration" },
    });
    return proof.method;
  });
  if (!verificationMethod) return { required: false as const };
  await clearPersistentRateLimit({
    action: "mfa_management",
    identifier,
  });
  return { required: true as const, method: verificationMethod };
}
