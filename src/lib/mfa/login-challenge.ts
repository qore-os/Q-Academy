import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  activityEvents,
  mfaLoginChallenges,
  organizationMfaPolicies,
  organizations,
  userMfaConfigurations,
  users,
  type User,
} from "@/db/schema";
import type { SessionAuthentication } from "@/lib/auth";
import { isMfaProtectedRole } from "@/lib/mfa/roles";
import {
  clearAuthRateLimit,
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
  tenantAuthIdentifier,
} from "@/lib/auth-rate-limit";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashRecoveryCode,
  recoveryHashIndex,
} from "@/lib/mfa/secrets";
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotpCode,
} from "@/lib/mfa/totp";
import { acquireMfaUserAdvisoryLock } from "@/lib/mfa/locks";
import { getSessionSecret } from "@/lib/server-environment";
import { effectiveLocale } from "@/lib/i18n/model";

const DEVELOPMENT_COOKIE = "q_academy_mfa_challenge";
const PRODUCTION_COOKIE = "__Host-q_academy_mfa_challenge";
const CHALLENGE_ISSUER = "q-academy";
const CHALLENGE_AUDIENCE = "q-academy-mfa-login";
const CHALLENGE_TTL_MS = 10 * 60_000;

type ChallengeMode = "verify" | "enroll";
export type MfaVerificationMethod = "totp" | "recovery";

export class MfaLoginChallengeError extends Error {
  constructor(
    readonly code:
      | "expired"
      | "invalid_code"
      | "rate_limited"
      | "configuration_changed",
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "MfaLoginChallengeError";
  }
}

function cookieName() {
  return process.env.NODE_ENV === "production"
    ? PRODUCTION_COOKIE
    : DEVELOPMENT_COOKIE;
}

function signingKey() {
  return new TextEncoder().encode(getSessionSecret());
}

function hashJti(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeDestination(role: User["role"], value?: string | null) {
  const root = role === "member" ? "/academy" : "/admin";
  if (
    !value ||
    value.length > 500 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return root;
  }
  try {
    const parsed = new URL(value, "https://q-academy.local");
    const roleArea =
      parsed.pathname === root || parsed.pathname.startsWith(`${root}/`);
    const staffProfile =
      role !== "member" && parsed.pathname === "/academy/profile";
    return parsed.origin === "https://q-academy.local" &&
      (roleArea || staffProfile)
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : root;
  } catch {
    return root;
  }
}

export async function mfaRequirementForUser(
  user: Pick<User, "id" | "organizationId" | "role">,
) {
  if (!isMfaProtectedRole(user.role)) return null;
  const [configuration, policy] = await Promise.all([
    db
      .select({ status: userMfaConfigurations.status })
      .from(userMfaConfigurations)
      .where(
        and(
          eq(userMfaConfigurations.userId, user.id),
          eq(userMfaConfigurations.organizationId, user.organizationId),
        ),
      )
      .limit(1),
    db
      .select({ required: organizationMfaPolicies.requireForPrivileged })
      .from(organizationMfaPolicies)
      .where(eq(organizationMfaPolicies.organizationId, user.organizationId))
      .limit(1),
  ]);
  if (configuration[0]?.status === "enabled") return "verify" as const;
  if (policy[0]?.required) return "enroll" as const;
  return null;
}

export async function beginMfaLoginChallenge(
  user: User,
  authentication: SessionAuthentication,
  returnTo?: string | null,
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const jti = randomUUID();
  const challengeId = randomUUID();
  const mode = await db.transaction(async (tx): Promise<ChallengeMode | null> => {
    await acquireMfaUserAdvisoryLock(tx, user);
    const [lockedUser] = await tx
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(
        and(
          eq(users.id, user.id),
          eq(users.organizationId, user.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!lockedUser || lockedUser.status !== "active" || !isMfaProtectedRole(lockedUser.role)) {
      return null;
    }
    const configuration = await tx
      .select({ status: userMfaConfigurations.status })
      .from(userMfaConfigurations)
      .where(
        and(
          eq(userMfaConfigurations.userId, user.id),
          eq(userMfaConfigurations.organizationId, user.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    const policy = await tx
      .select({ required: organizationMfaPolicies.requireForPrivileged })
      .from(organizationMfaPolicies)
      .where(eq(organizationMfaPolicies.organizationId, user.organizationId))
      .limit(1)
      .for("share");
    const nextMode = configuration[0]?.status === "enabled"
      ? "verify"
      : policy[0]?.required
        ? "enroll"
        : null;
    if (!nextMode) return null;
    if (nextMode === "enroll") {
      const secret = generateTotpSecret();
      await tx
        .insert(userMfaConfigurations)
        .values({
          userId: user.id,
          organizationId: user.organizationId,
          status: "pending",
          secretEncrypted: encryptMfaSecret(secret, user.organizationId, user.id),
          recoveryCodeHashes: [],
          lastTotpCounter: null,
          enabledAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userMfaConfigurations.userId,
          set: {
            status: "pending",
            secretEncrypted: encryptMfaSecret(secret, user.organizationId, user.id),
            recoveryCodeHashes: [],
            lastTotpCounter: null,
            enabledAt: null,
            updatedAt: now,
          },
        });
    }
    await tx
      .update(mfaLoginChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(mfaLoginChallenges.organizationId, user.organizationId),
          eq(mfaLoginChallenges.userId, user.id),
          isNull(mfaLoginChallenges.consumedAt),
        ),
      );
    await tx.insert(mfaLoginChallenges).values({
      id: challengeId,
      organizationId: user.organizationId,
      userId: user.id,
      jtiHash: hashJti(jti),
      mode: nextMode,
      authMethod: authentication.method,
      oidcIdentityId:
        authentication.method === "oidc" ? authentication.identityId : null,
      oidcConfigurationVersion:
        authentication.method === "oidc"
          ? authentication.configurationVersion
          : null,
      oidcAuthTime:
        authentication.method === "oidc" ? authentication.authTime ?? null : null,
      expiresAt,
    });
    return nextMode;
  });
  if (!mode) return null;

  const token = await new SignJWT({
    organizationId: user.organizationId,
    challengeId,
    mode,
    destination: safeDestination(user.role, returnTo),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(CHALLENGE_ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey());
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
  return mode;
}

type OpenChallenge = {
  id: string;
  organizationId: string;
  userId: string;
  jtiHash: string;
  mode: ChallengeMode;
  authMethod: "password" | "oidc";
  oidcIdentityId: string | null;
  oidcConfigurationVersion: number | null;
  oidcAuthTime: Date | null;
  expiresAt: Date;
  user: User;
  organizationName: string;
  organizationDefaultLocale: string;
  destination: string;
};

async function openChallenge(): Promise<OpenChallenge> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token) throw new MfaLoginChallengeError("expired", "Die MFA-Anfrage ist abgelaufen.");
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
      issuer: CHALLENGE_ISSUER,
      audience: CHALLENGE_AUDIENCE,
    });
    if (
      !payload.sub ||
      !payload.jti ||
      typeof payload.organizationId !== "string" ||
      typeof payload.challengeId !== "string" ||
      (payload.mode !== "verify" && payload.mode !== "enroll")
      || typeof payload.destination !== "string"
    ) throw new Error("Invalid challenge claims.");
    const [record] = await db
      .select({
        challenge: mfaLoginChallenges,
        user: users,
        organizationName: organizations.name,
        organizationDefaultLocale: organizations.defaultLocale,
      })
      .from(mfaLoginChallenges)
      .innerJoin(
        users,
        and(
          eq(users.id, mfaLoginChallenges.userId),
          eq(users.organizationId, mfaLoginChallenges.organizationId),
          eq(users.status, "active"),
        ),
      )
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, mfaLoginChallenges.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .where(
        and(
          eq(mfaLoginChallenges.id, payload.challengeId),
          eq(mfaLoginChallenges.organizationId, payload.organizationId),
          eq(mfaLoginChallenges.userId, payload.sub),
          eq(mfaLoginChallenges.jtiHash, hashJti(payload.jti)),
          eq(mfaLoginChallenges.mode, payload.mode),
          isNull(mfaLoginChallenges.consumedAt),
          gt(mfaLoginChallenges.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!record || !isMfaProtectedRole(record.user.role)) throw new Error("Missing challenge.");
    if (record.challenge.authMethod !== "password" && record.challenge.authMethod !== "oidc") {
      throw new Error("Invalid authentication method.");
    }
    return {
      ...record.challenge,
      mode: record.challenge.mode as ChallengeMode,
      authMethod: record.challenge.authMethod,
      user: record.user,
      organizationName: record.organizationName,
      organizationDefaultLocale: record.organizationDefaultLocale,
      destination: safeDestination(record.user.role, payload.destination),
    };
  } catch (error) {
    if (error instanceof MfaLoginChallengeError) throw error;
    throw new MfaLoginChallengeError("expired", "Die MFA-Anfrage ist abgelaufen.");
  }
}

export async function getMfaLoginChallengeView() {
  const challenge = await openChallenge();
  const [configuration] = await db
    .select({
      status: userMfaConfigurations.status,
      secretEncrypted: userMfaConfigurations.secretEncrypted,
    })
    .from(userMfaConfigurations)
    .where(
      and(
        eq(userMfaConfigurations.userId, challenge.userId),
        eq(userMfaConfigurations.organizationId, challenge.organizationId),
      ),
    )
    .limit(1);
  if (!configuration || configuration.status !== (challenge.mode === "enroll" ? "pending" : "enabled")) {
    throw new MfaLoginChallengeError(
      "configuration_changed",
      "Die MFA-Konfiguration wurde geaendert. Bitte melde dich erneut an.",
    );
  }
  const secret = challenge.mode === "enroll"
    ? decryptMfaSecret(
        configuration.secretEncrypted,
        challenge.organizationId,
        challenge.userId,
      )
    : null;
  return {
    organizationId: challenge.organizationId,
    mode: challenge.mode,
    email: challenge.user.email,
    organizationName: challenge.organizationName,
    locale: effectiveLocale({
      preferredLocale: challenge.user.preferredLocale,
      defaultLocale: challenge.organizationDefaultLocale,
    }),
    secret,
    otpAuthUri: secret
      ? buildOtpAuthUri({
          secret,
          issuer: challenge.organizationName,
          accountName: challenge.user.email,
        })
      : null,
  };
}

export async function completeMfaLoginChallenge(code: string) {
  const challenge = await openChallenge();
  const rateIdentifier = `${challenge.organizationId}:${challenge.userId}`;
  const rateLimit = await consumePersistentRateLimit({
    action: "mfa_challenge",
    identifier: rateIdentifier,
  });
  if (rateLimit.limited) {
    throw new MfaLoginChallengeError(
      "rate_limited",
      "Zu viele MFA-Versuche. Bitte versuche es spaeter erneut.",
      retryAfterSeconds(rateLimit.resetAt),
    );
  }
  const now = new Date();
  const completed = await db.transaction(async (tx) => {
    await acquireMfaUserAdvisoryLock(tx, {
      id: challenge.userId,
      organizationId: challenge.organizationId,
    });
    const [lockedUser] = await tx
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, challenge.userId),
          eq(users.organizationId, challenge.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !lockedUser ||
      lockedUser.status !== "active" ||
      !isMfaProtectedRole(lockedUser.role)
    ) {
      throw new MfaLoginChallengeError("expired", "Die MFA-Anfrage ist abgelaufen.");
    }
    const [configuration] = await tx
      .select()
      .from(userMfaConfigurations)
      .where(
        and(
          eq(userMfaConfigurations.userId, challenge.userId),
          eq(userMfaConfigurations.organizationId, challenge.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    const [lockedChallenge] = await tx
      .select()
      .from(mfaLoginChallenges)
      .where(
        and(
          eq(mfaLoginChallenges.id, challenge.id),
          eq(mfaLoginChallenges.organizationId, challenge.organizationId),
          eq(mfaLoginChallenges.userId, challenge.userId),
          isNull(mfaLoginChallenges.consumedAt),
          gt(mfaLoginChallenges.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    const expectedStatus = challenge.mode === "enroll" ? "pending" : "enabled";
    if (
      !lockedChallenge ||
      !configuration ||
      lockedChallenge.mode !== challenge.mode ||
      configuration.status !== expectedStatus
    ) {
      throw new MfaLoginChallengeError("expired", "Die MFA-Anfrage ist abgelaufen.");
    }
    const secret = decryptMfaSecret(
      configuration.secretEncrypted,
      challenge.organizationId,
      challenge.userId,
    );
    const totpCounter = verifyTotpCode({
      secret,
      code,
      lastUsedCounter: configuration.lastTotpCounter,
    });
    let method: MfaVerificationMethod = "totp";
    let recoveryCodeHashes = configuration.recoveryCodeHashes;
    if (totpCounter === null && challenge.mode === "verify") {
      const index = recoveryHashIndex(
        recoveryCodeHashes,
        code,
        challenge.organizationId,
        challenge.userId,
      );
      if (index >= 0) {
        method = "recovery";
        recoveryCodeHashes = recoveryCodeHashes.filter((_, position) => position !== index);
      }
    }
    if (totpCounter === null && method !== "recovery") {
      throw new MfaLoginChallengeError(
        "invalid_code",
        challenge.mode === "enroll"
          ? "Der Code konnte nicht bestaetigt werden."
          : "Der MFA- oder Recovery-Code ist nicht korrekt.",
      );
    }
    const recoveryCodes = challenge.mode === "enroll" ? generateRecoveryCodes() : null;
    const nextRecoveryHashes = recoveryCodes
      ? recoveryCodes.map((value) =>
          hashRecoveryCode(value, challenge.organizationId, challenge.userId),
        )
      : recoveryCodeHashes;
    await tx
      .update(userMfaConfigurations)
      .set({
        status: "enabled",
        recoveryCodeHashes: nextRecoveryHashes,
        lastTotpCounter: totpCounter ?? configuration.lastTotpCounter,
        enabledAt: configuration.enabledAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(userMfaConfigurations.userId, challenge.userId),
          eq(userMfaConfigurations.organizationId, challenge.organizationId),
        ),
      );
    await tx
      .update(mfaLoginChallenges)
      .set({ consumedAt: now })
      .where(eq(mfaLoginChallenges.id, challenge.id));
    await tx.insert(activityEvents).values({
      organizationId: lockedUser.organizationId,
      userId: lockedUser.id,
      type: challenge.mode === "enroll" ? "security.mfa.enabled" : "security.mfa.login_verified",
      entityType: "user",
      entityId: lockedUser.id,
      metadata: {
        method,
        recoveryCodesRemaining: nextRecoveryHashes.length,
      },
    });
    const authentication: SessionAuthentication = lockedChallenge.authMethod === "oidc"
      ? {
          method: "oidc",
          identityId: lockedChallenge.oidcIdentityId!,
          configurationVersion: lockedChallenge.oidcConfigurationVersion!,
          authTime: lockedChallenge.oidcAuthTime,
        }
      : { method: "password" };
    return { method, recoveryCodes, authentication, user: lockedUser };
  });
  await clearPersistentRateLimit({ action: "mfa_challenge", identifier: rateIdentifier });
  await clearAuthRateLimit({
    action: "login",
    identifier: tenantAuthIdentifier(
      completed.user.organizationId,
      completed.user.email,
    ),
  });
  (await cookies()).delete(cookieName());
  return { ...completed, destination: challenge.destination };
}

export async function clearMfaLoginChallengeCookie() {
  (await cookies()).delete(cookieName());
}
