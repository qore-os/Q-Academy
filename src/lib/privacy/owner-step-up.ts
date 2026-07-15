import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  oidcConfigurations,
  userSessions,
  type User,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { verifyActiveUserPassword } from "@/lib/auth-credentials";

export class PrivacyOwnerStepUpError extends Error {
  constructor(
    readonly code:
      | "invalid_password"
      | "rate_limited"
      | "owner_required"
      | "reauth_required",
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "PrivacyOwnerStepUpError";
  }
}

export async function verifyPrivacyOwnerStepUp(
  actor: Pick<
    User,
    "id" | "organizationId" | "passwordHash" | "status" | "role"
  >,
  password: string,
) {
  if (actor.role !== "owner" || actor.status !== "active") {
    throw new PrivacyOwnerStepUpError(
      "owner_required",
      "Diese Aktion ist dem aktiven Organisations-Owner vorbehalten.",
    );
  }
  const [configuration] = await db
    .select({
      enabled: oidcConfigurations.enabled,
      passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
    })
    .from(oidcConfigurations)
    .where(eq(oidcConfigurations.organizationId, actor.organizationId))
    .limit(1);
  if (configuration?.passwordLoginEnabled === false) {
    const session = await getSession();
    const recentCutoff = new Date(Date.now() - 5 * 60_000);
    const [recentOidcProof] = session
      ? await db
          .select({ id: userSessions.id })
          .from(userSessions)
          .where(
            and(
              eq(userSessions.id, session.sessionId),
              eq(userSessions.organizationId, actor.organizationId),
              eq(userSessions.userId, actor.id),
              eq(userSessions.authMethod, "oidc"),
              isNull(userSessions.revokedAt),
              gt(userSessions.expiresAt, new Date()),
              gt(userSessions.authenticatedAt, recentCutoff),
              gt(userSessions.oidcAuthTime, recentCutoff),
            ),
          )
          .limit(1)
      : [];
    if (!configuration.enabled || !recentOidcProof) {
      throw new PrivacyOwnerStepUpError(
        "reauth_required",
        "Bitte bestaetige diese Owner-Aktion erneut beim Identity Provider.",
      );
    }
    return;
  }
  const identifier = `${actor.organizationId}\0${actor.id}`;
  const rateLimit = await consumePersistentRateLimit({
    action: "privacy_step_up",
    identifier,
  });
  if (rateLimit.limited) {
    throw new PrivacyOwnerStepUpError(
      "rate_limited",
      "Zu viele Passwortversuche. Bitte spaeter erneut versuchen.",
      retryAfterSeconds(rateLimit.resetAt),
    );
  }
  if (!(await verifyActiveUserPassword(actor, password))) {
    throw new PrivacyOwnerStepUpError(
      "invalid_password",
      "Das aktuelle Passwort ist nicht korrekt.",
    );
  }
  await clearPersistentRateLimit({
    action: "privacy_step_up",
    identifier,
  });
}
