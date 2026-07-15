import { hash } from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  oidcConfigurations,
  passwordResetTokens,
  userSessions,
  users,
} from "@/db/schema";
import { publicData, publicProblem } from "@/lib/api/public-auth";
import { passwordResetSchema } from "@/lib/api/schemas";
import { hashOpaqueToken } from "@/lib/auth-tokens";
import {
  BoundedJsonRequestError,
  parseBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  clearAuthRateLimit,
  consumeAuthRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";

export const dynamic = "force-dynamic";

class PasswordResetClaimError extends Error {}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await parseBoundedJsonRequest(request, { maxBytes: 2_048 });
  } catch (error) {
    if (
      error instanceof BoundedJsonRequestError &&
      error.reason === "too_large"
    ) {
      return publicProblem(
        request,
        413,
        "bad_request",
        "Der Request-Body ist zu gross.",
      );
    }
    if (!(error instanceof BoundedJsonRequestError)) throw error;
    return publicProblem(request, 400, "bad_request", "Der Request-Body muss gueltiges JSON enthalten.");
  }
  const parsed = passwordResetSchema.safeParse(body);
  if (!parsed.success) return publicProblem(request, 422, "validation_error", "Token oder Passwort ist ungueltig.", parsed.error.issues);
  const tokenHash = hashOpaqueToken(parsed.data.token);
  const rateLimit = await consumeAuthRateLimit({
    action: "password_reset",
    identifier: tokenHash,
    scopeIdentifier: "global",
    headers: request.headers,
  });
  if (rateLimit.limited) {
    const response = publicProblem(request, 429, "rate_limit_exceeded", "Zu viele Anfragen. Bitte spaeter erneut versuchen.");
    response.headers.set("Retry-After", String(retryAfterSeconds(rateLimit.resetAt)));
    return response;
  }
  const [tokenRecord] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      organizationId: users.organizationId,
    })
    .from(passwordResetTokens)
    .innerJoin(
      users,
      and(
        eq(users.id, passwordResetTokens.userId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
    .limit(1);
  if (!tokenRecord) return publicProblem(request, 400, "invalid_token", "Der Reset-Link ist ungueltig oder abgelaufen.");
  const passwordHash = await hash(parsed.data.password, 12);
  let passwordReset = false;
  try {
    passwordReset = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`oidc-configuration:${tokenRecord.organizationId}`}, 0))`,
      );
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, tokenRecord.organizationId),
            eq(organizations.status, "active"),
          ),
        )
        .limit(1)
        .for("share");
      if (!organization) return false;
      const [loginConfiguration] = await tx
        .select({
          passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
        })
        .from(oidcConfigurations)
        .where(
          eq(
            oidcConfigurations.organizationId,
            tokenRecord.organizationId,
          ),
        )
        .limit(1)
        .for("share");
      if (loginConfiguration?.passwordLoginEnabled === false) return false;
      const [claimed] = await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(and(eq(passwordResetTokens.id, tokenRecord.id), isNull(passwordResetTokens.usedAt))).returning({ id: passwordResetTokens.id });
      if (!claimed) return false;
      const [updatedUser] = await tx
        .update(users)
        .set({ passwordHash })
        .where(
          and(
            eq(users.id, tokenRecord.userId),
            eq(users.organizationId, tokenRecord.organizationId),
            eq(users.status, "active"),
          ),
        )
        .returning({ id: users.id });
      if (!updatedUser) throw new PasswordResetClaimError();
      await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, tokenRecord.userId), isNull(userSessions.revokedAt)));
      return true;
    });
  } catch (error) {
    if (!(error instanceof PasswordResetClaimError)) throw error;
  }
  if (!passwordReset) return publicProblem(request, 400, "invalid_token", "Der Reset-Link ist ungueltig oder abgelaufen.");
  await clearAuthRateLimit({
    action: "password_reset",
    identifier: tokenHash,
  });
  return publicData(request, { passwordReset: true });
}
