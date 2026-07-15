import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  organizationMfaPolicies,
  oidcConfigurations,
  oidcIdentities,
  userMfaConfigurations,
  userSessions,
  users,
  nativePushDevices,
  webPushSubscriptions,
  type User,
} from "@/db/schema";
import { InactiveOrganizationError } from "@/lib/organization-status";
import { getSessionSecret } from "@/lib/server-environment";
import { safeAvatarSource } from "@/lib/avatar-policy";
import { getTeamAccessForUser } from "@/lib/team-permissions";
import {
  teamPermissionAllows,
  type TeamPermissionKey,
} from "@/lib/team-permission-policy";
import { isMfaProtectedRole } from "@/lib/mfa/roles";

const DEVELOPMENT_SESSION_COOKIE = "q_academy_session";
const PRODUCTION_SESSION_COOKIE = "__Host-q_academy_session";
const SESSION_ISSUER = "q-academy";
const SESSION_AUDIENCE = "q-academy-web";
const ADMIN_AREA_ROLES = ["owner", "admin", "trainer"] as const satisfies readonly User["role"][];
const ORGANIZATION_ADMIN_ROLES = ["owner", "admin"] as const satisfies readonly User["role"][];
const USER_ROLES = ["owner", "admin", "trainer", "member"] as const satisfies readonly User["role"][];

function sessionCookieName() {
  return process.env.NODE_ENV === "production"
    ? PRODUCTION_SESSION_COOKIE
    : DEVELOPMENT_SESSION_COOKIE;
}

function sessionSigningKey() {
  return new TextEncoder().encode(getSessionSecret());
}

function isUserRole(value: unknown): value is User["role"] {
  return typeof value === "string" && USER_ROLES.some((role) => role === value);
}

export type SessionPayload = {
  sub: string;
  sessionId: string;
  organizationId: string;
  role: User["role"];
  email: string;
  authMethod: "password" | "oidc";
};

export type SessionAuthentication =
  | { method: "password" }
  | {
      method: "oidc";
      identityId: string;
      configurationVersion: number;
      authTime?: Date | null;
    };

export type SessionMfaProof = {
  method: "totp" | "recovery";
  verifiedAt?: Date;
};

export class PasswordLoginDisabledError extends Error {
  constructor() {
    super("Password login is disabled for this organization.");
    this.name = "PasswordLoginDisabledError";
  }
}

export class OidcAuthenticationChangedError extends Error {
  constructor() {
    super("The OIDC configuration changed before the session was created.");
    this.name = "OidcAuthenticationChangedError";
  }
}

function hashJti(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(
  user: User,
  authentication: SessionAuthentication,
  mfaProof?: SessionMfaProof,
) {
  const authenticatedAt = new Date();
  const expiresAt = new Date(
    authenticatedAt.getTime() +
      (authentication.method === "oidc"
        ? 12 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000),
  );
  const jti = randomUUID();
  const token = await new SignJWT({
    organizationId: user.organizationId,
    role: user.role,
    email: user.email,
    authMethod: authentication.method,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(sessionSigningKey());

  const cookieStore = await cookies();
  const previousToken = cookieStore.get(sessionCookieName())?.value;
  let previousJtiHash: string | null = null;
  if (previousToken) {
    try {
      const { payload } = await jwtVerify(previousToken, sessionSigningKey(), {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
      });
      if (payload.jti) previousJtiHash = hashJti(payload.jti);
    } catch {
      previousJtiHash = null;
    }
  }
  const requestHeaders = await headers();
  const [session] = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`oidc-configuration:${user.organizationId}`}, 0))`,
    );
    if (authentication.method === "password") {
      const [loginConfiguration] = await tx
        .select({
          passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
        })
        .from(oidcConfigurations)
        .where(eq(oidcConfigurations.organizationId, user.organizationId))
        .limit(1)
        .for("share");
      if (loginConfiguration?.passwordLoginEnabled === false) {
        throw new PasswordLoginDisabledError();
      }
    } else {
      const [oidcProof] = await tx
        .select({ id: oidcIdentities.id })
        .from(oidcIdentities)
        .innerJoin(
          oidcConfigurations,
          and(
            eq(
              oidcConfigurations.organizationId,
              oidcIdentities.organizationId,
            ),
            eq(oidcConfigurations.enabled, true),
            eq(oidcConfigurations.issuer, oidcIdentities.issuer),
            eq(
              oidcConfigurations.version,
              authentication.configurationVersion,
            ),
          ),
        )
        .where(
          and(
            eq(oidcIdentities.id, authentication.identityId),
            eq(oidcIdentities.organizationId, user.organizationId),
            eq(oidcIdentities.userId, user.id),
            eq(
              oidcIdentities.lastConfigurationVersion,
              authentication.configurationVersion,
            ),
          ),
        )
        .limit(1)
        .for("share");
      if (!oidcProof) throw new OidcAuthenticationChangedError();
    }
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .innerJoin(
        users,
        and(
          eq(users.id, user.id),
          eq(users.organizationId, organizations.id),
          eq(users.status, "active"),
        ),
      )
      .where(
        and(
          eq(organizations.id, user.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .limit(1)
      .for("share");
    if (!organization) throw new InactiveOrganizationError();
    const created = await tx
      .insert(userSessions)
      .values({
        organizationId: user.organizationId,
        userId: user.id,
        jtiHash: hashJti(jti),
        ipAddress:
          requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: requestHeaders.get("user-agent"),
        authMethod: authentication.method,
        oidcIdentityId:
          authentication.method === "oidc"
            ? authentication.identityId
            : null,
        oidcConfigurationVersion:
          authentication.method === "oidc"
            ? authentication.configurationVersion
            : null,
        authenticatedAt,
        oidcAuthTime:
          authentication.method === "oidc"
            ? authentication.authTime ?? null
            : null,
        mfaVerifiedAt: mfaProof?.verifiedAt ?? (mfaProof ? authenticatedAt : null),
        mfaMethod: mfaProof?.method ?? null,
        expiresAt,
      })
      .returning({ id: userSessions.id });
    if (previousJtiHash) {
      await tx
        .update(userSessions)
        .set({ revokedAt: authenticatedAt })
        .where(
          and(
            eq(userSessions.organizationId, user.organizationId),
            eq(userSessions.userId, user.id),
            eq(userSessions.jtiHash, previousJtiHash),
            isNull(userSessions.revokedAt),
          ),
        );
    }
    return created;
  });

  cookieStore.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
  return session;
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, sessionSigningKey(), {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
      });
      if (payload.jti) {
        await db.transaction(async (tx) => {
          const [session] = await tx
            .select({ id: userSessions.id })
            .from(userSessions)
            .where(eq(userSessions.jtiHash, hashJti(payload.jti!)))
            .limit(1)
            .for("update", { of: userSessions });
          if (!session) return;
          await tx
            .delete(webPushSubscriptions)
            .where(eq(webPushSubscriptions.sessionId, session.id));
          await tx
            .delete(nativePushDevices)
            .where(eq(nativePushDevices.sessionId, session.id));
          await tx
            .update(userSessions)
            .set({ revokedAt: new Date() })
            .where(eq(userSessions.id, session.id));
        });
      }
    } catch {
      // Expired or malformed sessions are removed from the browser below.
    }
  }
  cookieStore.delete(sessionCookieName());
}

export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, sessionSigningKey(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    if (
      !payload.sub ||
      !payload.jti ||
      !payload.organizationId ||
      !isUserRole(payload.role) ||
      !payload.email ||
      (payload.authMethod !== "password" && payload.authMethod !== "oidc")
    ) return null;
    const [session] = await db
      .select({
        id: userSessions.id,
        lastSeenAt: userSessions.lastSeenAt,
        authMethod: userSessions.authMethod,
        oidcIdentityId: oidcIdentities.id,
        oidcIdentityIssuer: oidcIdentities.issuer,
        oidcConfigurationEnabled: oidcConfigurations.enabled,
        oidcConfigurationIssuer: oidcConfigurations.issuer,
        mfaVerifiedAt: userSessions.mfaVerifiedAt,
        mfaMethod: userSessions.mfaMethod,
        mfaStatus: userMfaConfigurations.status,
        mfaRequired: organizationMfaPolicies.requireForPrivileged,
      })
      .from(userSessions)
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, userSessions.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, userSessions.userId),
          eq(users.organizationId, userSessions.organizationId),
          eq(users.status, "active"),
          eq(users.role, payload.role),
          eq(users.email, String(payload.email)),
        ),
      )
      .leftJoin(
        oidcIdentities,
        and(
          eq(oidcIdentities.id, userSessions.oidcIdentityId),
          eq(oidcIdentities.userId, userSessions.userId),
          eq(oidcIdentities.organizationId, userSessions.organizationId),
        ),
      )
      .leftJoin(
        oidcConfigurations,
        eq(oidcConfigurations.organizationId, userSessions.organizationId),
      )
      .leftJoin(
        userMfaConfigurations,
        and(
          eq(userMfaConfigurations.userId, userSessions.userId),
          eq(
            userMfaConfigurations.organizationId,
            userSessions.organizationId,
          ),
        ),
      )
      .leftJoin(
        organizationMfaPolicies,
        eq(
          organizationMfaPolicies.organizationId,
          userSessions.organizationId,
        ),
      )
      .where(
        and(
          eq(userSessions.jtiHash, hashJti(payload.jti)),
          eq(userSessions.userId, payload.sub),
          eq(userSessions.organizationId, String(payload.organizationId)),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) return null;
    const invalidOidcSession =
      session.authMethod === "oidc" &&
      (!session.oidcIdentityId ||
        session.oidcConfigurationEnabled !== true ||
        session.oidcConfigurationIssuer !== session.oidcIdentityIssuer ||
        session.lastSeenAt.getTime() < Date.now() - 60 * 60_000);
    const privileged = isMfaProtectedRole(payload.role);
    const invalidMfaSession =
      privileged &&
      (session.mfaStatus === "enabled" || session.mfaRequired === true) &&
      (!session.mfaVerifiedAt ||
        (session.mfaMethod !== "totp" && session.mfaMethod !== "recovery"));
    if (
      session.authMethod !== payload.authMethod ||
      invalidOidcSession ||
      invalidMfaSession
    ) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userSessions.id, session.id),
            isNull(userSessions.revokedAt),
          ),
        );
      return null;
    }
    if (session.lastSeenAt.getTime() < Date.now() - 5 * 60_000) {
      await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, session.id));
    }
    return {
      sub: payload.sub,
      sessionId: session.id,
      organizationId: String(payload.organizationId),
      role: payload.role,
      email: String(payload.email),
      authMethod: payload.authMethod,
    };
  } catch {
    return null;
  }
});

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await getSession();
  if (!session) return null;
  const [record] = await db
    .select({ user: users })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.id, session.sub),
        eq(users.organizationId, session.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const user = record?.user;
  if (
    !user ||
    user.status !== "active" ||
    user.organizationId !== session.organizationId ||
    user.role !== session.role ||
    user.email !== session.email
  ) {
    return null;
  }
  return { ...user, avatarUrl: safeAvatarSource(user.avatarUrl) };
});

export async function hasBrowserSessionCookie() {
  return Boolean((await cookies()).get(sessionCookieName())?.value);
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!ADMIN_AREA_ROLES.some((role) => role === user.role)) redirect("/academy");
  return user;
}

export async function requireTeamPermission(permission: TeamPermissionKey) {
  const user = await requireAdmin();
  const access = await getTeamAccessForUser(user);
  if (!teamPermissionAllows(access.permissions, permission)) {
    redirect("/admin?access=denied");
  }
  return user;
}

export async function requireOrganizationAdmin() {
  const user = await requireUser();
  if (!ORGANIZATION_ADMIN_ROLES.some((role) => role === user.role)) redirect("/academy");
  return user;
}

export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/academy");
  return user;
}
