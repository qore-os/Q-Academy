import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  invitations,
  oidcConfigurations,
  oidcIdentities,
  organizations,
  userSessions,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  assertOrganizationFeatureAvailable,
  assertOrganizationSeatCapacity,
} from "@/lib/organization-contracts";
import {
  oidcEmailIsAllowed,
  oidcIdentityClaimsSchema,
  oidcNamesFromClaims,
} from "@/lib/oidc-model";

function issuerHash(issuer: string) {
  return createHash("sha256").update(issuer).digest("hex");
}

function unavailableAccount(): never {
  throw new ApiError(
    403,
    "forbidden",
    "Fuer diesen Unternehmens-Login ist kein aktives Konto verfuegbar.",
  );
}

export async function resolveOidcUser(input: {
  organizationId: string;
  expectedConfigurationVersion: number;
  issuer: string;
  rawClaims: unknown;
  authorizedLink?: { userId: string; sessionId: string } | null;
}): Promise<{ user: User; identityId: string }> {
  const claims = oidcIdentityClaimsSchema.parse(input.rawClaims);
  await assertOrganizationFeatureAvailable(db, input.organizationId, "oidc_sso");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`oidc-configuration:${input.organizationId}`}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`oidc-login:${input.organizationId}`}, 0))`,
    );
    const [configuration] = await tx
      .select({
        enabled: oidcConfigurations.enabled,
        issuer: oidcConfigurations.issuer,
        autoProvisionMembers: oidcConfigurations.autoProvisionMembers,
        allowedEmailDomains: oidcConfigurations.allowedEmailDomains,
        version: oidcConfigurations.version,
      })
      .from(oidcConfigurations)
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, oidcConfigurations.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .where(eq(oidcConfigurations.organizationId, input.organizationId))
      .limit(1)
      .for("share");
    if (
      !configuration?.enabled ||
      configuration.issuer !== input.issuer ||
      configuration.version !== input.expectedConfigurationVersion
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die Login-Konfiguration wurde geaendert. Bitte die Anmeldung neu starten.",
      );
    }
    if (!oidcEmailIsAllowed(claims.email, configuration.allowedEmailDomains)) {
      unavailableAccount();
    }
    if (input.authorizedLink) {
      const [authorizedSession] = await tx
        .select({ id: userSessions.id })
        .from(userSessions)
        .innerJoin(
          users,
          and(
            eq(users.id, userSessions.userId),
            eq(users.organizationId, userSessions.organizationId),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(userSessions.id, input.authorizedLink.sessionId),
            eq(userSessions.userId, input.authorizedLink.userId),
            eq(userSessions.organizationId, input.organizationId),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, new Date()),
          ),
        )
        .limit(1)
        .for("share");
      if (!authorizedSession) unavailableAccount();
    }
    const authorizedLinkUserId = input.authorizedLink?.userId ?? null;

    const [linked] = await tx
      .select({ identity: oidcIdentities, user: users })
      .from(oidcIdentities)
      .innerJoin(
        users,
        and(
          eq(users.id, oidcIdentities.userId),
          eq(users.organizationId, oidcIdentities.organizationId),
        ),
      )
      .where(
        and(
          eq(oidcIdentities.organizationId, input.organizationId),
          eq(oidcIdentities.issuer, input.issuer),
          eq(oidcIdentities.subject, claims.sub),
        ),
      )
      .limit(1)
      .for("update");
    const now = new Date();
    if (linked) {
      if (
        authorizedLinkUserId &&
        linked.user.id !== authorizedLinkUserId
      ) {
        unavailableAccount();
      }
      if (linked.user.status !== "active") unavailableAccount();
      await tx
        .update(oidcIdentities)
        .set({
          lastLoginAt: now,
          lastConfigurationVersion: input.expectedConfigurationVersion,
        })
        .where(eq(oidcIdentities.id, linked.identity.id));
      await tx
        .update(users)
        .set({ lastLoginAt: now })
        .where(
          and(
            eq(users.id, linked.user.id),
            eq(users.organizationId, input.organizationId),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: input.organizationId,
        userId: linked.user.id,
        type: "auth.oidc.login",
        entityType: "user",
        entityId: linked.user.id,
        metadata: {
          source: "oidc",
          issuerHash: issuerHash(input.issuer),
          identityId: linked.identity.id,
          firstLink: false,
        },
      });
      return {
        user: { ...linked.user, lastLoginAt: now },
        identityId: linked.identity.id,
      };
    }

    const [account] = await tx
      .select()
      .from(users)
      .where(
        and(
          eq(users.organizationId, input.organizationId),
          eq(users.email, claims.email),
        ),
      )
      .limit(1)
      .for("update");
    let user = account;
    let provisioned = false;
    let invitationActivated = false;
    if (user) {
      if (
        authorizedLinkUserId &&
        user.id !== authorizedLinkUserId
      ) {
        unavailableAccount();
      }
      if (
        user.role !== "member" &&
        user.id !== authorizedLinkUserId
      ) {
        unavailableAccount();
      }
      if (user.status === "invited" && user.role === "member") {
        invitationActivated = true;
      } else if (user.status !== "active") {
        unavailableAccount();
      }
    }
    if (!user) {
      if (authorizedLinkUserId) unavailableAccount();
      if (!configuration.autoProvisionMembers) unavailableAccount();
      const names = oidcNamesFromClaims(claims);
      const unusablePassword = randomBytes(64).toString("base64url");
      const passwordHash = await hash(unusablePassword, 12);
      await assertOrganizationSeatCapacity(tx, {
        organizationId: input.organizationId,
      });
      const [created] = await tx
        .insert(users)
        .values({
          organizationId: input.organizationId,
          email: claims.email,
          passwordHash,
          firstName: names.firstName,
          lastName: names.lastName,
          role: "member",
          status: "active",
          preferredLocale: null,
          lastLoginAt: now,
        })
        .returning();
      if (!created) {
        throw new ApiError(
          409,
          "conflict",
          "Das SSO-Konto konnte nicht atomar bereitgestellt werden.",
        );
      }
      user = created;
      provisioned = true;
    }

    const [otherIdentity] = await tx
      .select({ id: oidcIdentities.id })
      .from(oidcIdentities)
      .where(
        and(
          eq(oidcIdentities.organizationId, input.organizationId),
          eq(oidcIdentities.userId, user.id),
          eq(oidcIdentities.issuer, input.issuer),
        ),
      )
      .limit(1)
      .for("update");
    if (otherIdentity) {
      throw new ApiError(
        409,
        "conflict",
        "Das lokale Konto ist bereits mit einer anderen Identitaet dieses Providers verknuepft.",
      );
    }
    const [identity] = await tx
      .insert(oidcIdentities)
      .values({
        organizationId: input.organizationId,
        userId: user.id,
        issuer: input.issuer,
        subject: claims.sub,
        emailAtLink: claims.email,
        lastConfigurationVersion: input.expectedConfigurationVersion,
        lastLoginAt: now,
        createdAt: now,
      })
      .returning({ id: oidcIdentities.id });
    if (!identity) {
      throw new ApiError(
        409,
        "conflict",
        "Die SSO-Identitaet konnte nicht atomar verknuepft werden.",
      );
    }
    if (!provisioned) {
      await tx
        .update(users)
        .set({
          lastLoginAt: now,
          ...(invitationActivated ? { status: "active" as const } : {}),
        })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.organizationId, input.organizationId),
          ),
        );
      if (invitationActivated) {
        await tx
          .update(invitations)
          .set({ acceptedAt: now })
          .where(
            and(
              eq(invitations.organizationId, input.organizationId),
              eq(invitations.userId, user.id),
              isNull(invitations.acceptedAt),
            ),
          );
      }
      user = {
        ...user,
        lastLoginAt: now,
        status: invitationActivated ? "active" : user.status,
      };
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: user.id,
      type: provisioned
        ? "auth.oidc.user_provisioned"
        : invitationActivated
          ? "auth.oidc.invitation_accepted"
          : "auth.oidc.identity_linked",
      entityType: "user",
      entityId: user.id,
      metadata: {
        source: "oidc",
        issuerHash: issuerHash(input.issuer),
        identityId: identity.id,
        firstLink: true,
        provisioned,
        invitationActivated,
        assignedRole: provisioned ? "member" : user.role,
        localeSource: user.preferredLocale
          ? "account_preference"
          : "organization_default",
      },
    });
    return { user, identityId: identity.id };
  });
}
