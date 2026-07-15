import { hash } from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  invitations,
  oidcConfigurations,
  organizations,
  userSessions,
  users,
} from "@/db/schema";
import {
  createSession,
  PasswordLoginDisabledError,
} from "@/lib/auth";
import { publicData, publicProblem } from "@/lib/api/public-auth";
import { invitationAcceptSchema } from "@/lib/api/schemas";
import { hashOpaqueToken } from "@/lib/auth-tokens";
import { InactiveOrganizationError } from "@/lib/organization-status";
import { beginMfaLoginChallenge } from "@/lib/mfa/login-challenge";
import { parseSessionJson } from "@/lib/session-json";
import { ApiError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

class InvitationClaimError extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown;
  try {
    body = await parseSessionJson(request, { maxBytes: 512 });
  } catch (error) {
    if (error instanceof ApiError) {
      return publicProblem(request, error.status, error.code, error.message);
    }
    throw error;
  }
  const parsed = invitationAcceptSchema.safeParse(body);
  if (!parsed.success || token.length < 32) return publicProblem(request, 422, "validation_error", "Einladung oder Passwort ist ungueltig.", parsed.success ? undefined : parsed.error.issues);
  const [record] = await db
    .select({ invitationId: invitations.id, user: users })
    .from(invitations)
    .innerJoin(
      users,
      and(
        eq(users.id, invitations.userId),
        eq(users.organizationId, invitations.organizationId),
        eq(users.status, "invited"),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, invitations.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(and(eq(invitations.tokenHash, hashOpaqueToken(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  if (!record) return publicProblem(request, 400, "invalid_token", "Die Einladung ist ungueltig oder abgelaufen.");
  const passwordHash = await hash(parsed.data.password, 12);
  let user = null;
  try {
    user = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`oidc-configuration:${record.user.organizationId}`}, 0))`,
      );
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, record.user.organizationId),
            eq(organizations.status, "active"),
          ),
        )
        .limit(1)
        .for("share");
      if (!organization) return null;
      const [loginConfiguration] = await tx
        .select({
          passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
        })
        .from(oidcConfigurations)
        .where(
          eq(
            oidcConfigurations.organizationId,
            record.user.organizationId,
          ),
        )
        .limit(1)
        .for("share");
      if (loginConfiguration?.passwordLoginEnabled === false) return null;
      const [claimed] = await tx.update(invitations).set({ acceptedAt: new Date() }).where(and(eq(invitations.id, record.invitationId), isNull(invitations.acceptedAt))).returning({ id: invitations.id });
      if (!claimed) return null;
      const [updated] = await tx
        .update(users)
        .set({ passwordHash, status: "active" })
        .where(
          and(
            eq(users.id, record.user.id),
            eq(users.organizationId, record.user.organizationId),
            eq(users.status, "invited"),
          ),
        )
        .returning();
      if (!updated) throw new InvitationClaimError();
      await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, record.user.id), isNull(userSessions.revokedAt)));
      return updated;
    });
  } catch (error) {
    if (!(error instanceof InvitationClaimError)) throw error;
  }
  if (!user) return publicProblem(request, 409, "conflict", "Die Einladung wurde bereits verwendet.");
  const mfaMode = await beginMfaLoginChallenge(user, { method: "password" });
  if (mfaMode) {
    return publicData(
      request,
      {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        mfaRequired: true,
        mode: mfaMode,
      },
      202,
    );
  }
  let session;
  try {
    session = await createSession(user, { method: "password" });
  } catch (error) {
    if (error instanceof PasswordLoginDisabledError) {
      return publicProblem(
        request,
        409,
        "conflict",
        "Der Passwort-Login wurde zwischenzeitlich deaktiviert.",
      );
    }
    if (error instanceof InactiveOrganizationError) {
      return publicProblem(request, 403, "organization_inactive", "Die Organisation ist nicht aktiv.");
    }
    throw error;
  }
  return publicData(request, { user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, sessionId: session.id });
}
