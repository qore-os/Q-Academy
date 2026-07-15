import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import {
  oidcConfigurations,
  userSessions,
  users,
  type User,
} from "@/db/schema";
import {
  acquireMfaUserAdvisoryLock,
  type MfaTransaction,
} from "@/lib/mfa/locks";
import { lockOidcConfiguration } from "@/lib/oidc-configuration";
import { isMfaProtectedRole } from "@/lib/mfa/roles";

export type MfaPrimaryFactorProof =
  | { method: "password"; passwordHash: string }
  | { method: "oidc"; sessionId: string };

export class MfaActorRevalidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaActorRevalidationError";
  }
}

export async function lockAndRevalidateMfaActor(
  tx: MfaTransaction,
  input: {
    actor: Pick<User, "id" | "organizationId">;
    proof: MfaPrimaryFactorProof;
    requiredRole: "privileged" | "owner";
    now: Date;
  },
) {
  await acquireMfaUserAdvisoryLock(tx, input.actor);
  await lockOidcConfiguration(tx, input.actor.organizationId);
  const [loginConfiguration] = await tx
    .select({
      enabled: oidcConfigurations.enabled,
      passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
    })
    .from(oidcConfigurations)
    .where(eq(oidcConfigurations.organizationId, input.actor.organizationId))
    .limit(1)
    .for("share");
  const [lockedActor] = await tx
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, input.actor.id),
        eq(users.organizationId, input.actor.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  const roleAllowed =
    lockedActor &&
    (input.requiredRole === "owner"
      ? lockedActor.role === "owner"
      : isMfaProtectedRole(lockedActor.role));
  if (!lockedActor || lockedActor.status !== "active" || !roleAllowed) {
    throw new MfaActorRevalidationError(
      "Die Berechtigung fuer diese Sicherheitsaktion hat sich geaendert.",
    );
  }

  if (input.proof.method === "password") {
    if (
      lockedActor.passwordHash !== input.proof.passwordHash ||
      loginConfiguration?.passwordLoginEnabled === false
    ) {
      throw new MfaActorRevalidationError(
        "Die Primaer-Anmeldung hat sich geaendert. Bitte bestaetige die Aktion erneut.",
      );
    }
    return lockedActor;
  }

  const recentCutoff = new Date(input.now.getTime() - 5 * 60_000);
  if (
    loginConfiguration?.enabled !== true ||
    loginConfiguration.passwordLoginEnabled !== false
  ) {
    throw new MfaActorRevalidationError(
      "Bitte bestaetige diese Sicherheitsaktion erneut beim Identity Provider.",
    );
  }
  const [recentOidcProof] = await tx
    .select({ id: userSessions.id })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.id, input.proof.sessionId),
        eq(userSessions.organizationId, lockedActor.organizationId),
        eq(userSessions.userId, lockedActor.id),
        eq(userSessions.authMethod, "oidc"),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, input.now),
        gt(userSessions.authenticatedAt, recentCutoff),
        gt(userSessions.oidcAuthTime, recentCutoff),
      ),
    )
    .limit(1)
    .for("update");
  if (!recentOidcProof) {
    throw new MfaActorRevalidationError(
      "Bitte bestaetige diese Sicherheitsaktion erneut beim Identity Provider.",
    );
  }
  return lockedActor;
}
