import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import {
  createSession,
  PasswordLoginDisabledError,
} from "@/lib/auth";
import { verifyActiveUserPassword } from "@/lib/auth-credentials";
import { publicData, publicProblem } from "@/lib/api/public-auth";
import { authLoginSchema } from "@/lib/api/schemas";
import {
  clearAuthRateLimit,
  consumeAuthRateLimit,
  normalizeAuthEmail,
  retryAfterSeconds,
  tenantAuthIdentifier,
} from "@/lib/auth-rate-limit";
import { authRateLimitScopeForOrganization } from "@/lib/auth-rate-limit-guards";
import { getAuthTenantForRequest } from "@/lib/branding";
import { InactiveOrganizationError } from "@/lib/organization-status";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";
import { beginMfaLoginChallenge } from "@/lib/mfa/login-challenge";
import { parseSessionJson } from "@/lib/session-json";
import { ApiError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await parseSessionJson(request, { maxBytes: 1_024 });
  } catch (error) {
    if (error instanceof ApiError) {
      return publicProblem(request, error.status, error.code, error.message);
    }
    throw error;
  }
  const parsed = authLoginSchema.safeParse(input);
  if (!parsed.success) return publicProblem(request, 422, "validation_error", "Die Anmeldedaten sind ungueltig.", parsed.error.issues);
  const email = normalizeAuthEmail(parsed.data.email);
  const explicitSlug = parsed.data.organizationSlug?.toLowerCase();
  const [explicitTenant] = explicitSlug
    ? await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.slug, explicitSlug),
            eq(organizations.status, "active"),
          ),
        )
        .limit(1)
    : [];
  const publicTenant = explicitSlug
    ? null
    : await getAuthTenantForRequest(request.headers);
  const organizationId = explicitTenant?.id ?? publicTenant?.organizationId;
  const tenantScope = authRateLimitScopeForOrganization(organizationId);
  const rateIdentifier = tenantAuthIdentifier(
    tenantScope,
    email,
  );
  const rateLimit = await consumeAuthRateLimit({
    action: "login",
    identifier: rateIdentifier,
    scopeIdentifier: tenantScope,
    headers: request.headers,
  });
  if (rateLimit.limited) {
    const response = publicProblem(request, 429, "rate_limit_exceeded", "Zu viele Anmeldeversuche. Bitte spaeter erneut versuchen.");
    response.headers.set("Retry-After", String(retryAfterSeconds(rateLimit.resetAt)));
    return response;
  }
  const loginConfiguration = await getPublicOidcLoginConfiguration(
    organizationId,
  );
  if (!loginConfiguration.passwordLoginEnabled) {
    return publicProblem(request, 401, "invalid_credentials", "E-Mail-Adresse, Workspace oder Passwort ist nicht korrekt.");
  }
  const [user] = organizationId
    ? await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.email, email),
          ),
        )
        .limit(1)
    : [];
  if (!(await verifyActiveUserPassword(user, parsed.data.password))) {
    return publicProblem(request, 401, "invalid_credentials", "E-Mail-Adresse, Workspace oder Passwort ist nicht korrekt.");
  }
  const mfaMode = await beginMfaLoginChallenge(user, { method: "password" });
  if (mfaMode) {
    return publicData(request, { mfaRequired: true, mode: mfaMode }, 202);
  }
  await clearAuthRateLimit({
    action: "login",
    identifier: rateIdentifier,
  });
  let session;
  try {
    session = await createSession(user, { method: "password" });
  } catch (error) {
    if (
      error instanceof InactiveOrganizationError ||
      error instanceof PasswordLoginDisabledError
    ) {
      return publicProblem(request, 401, "invalid_credentials", "E-Mail-Adresse, Workspace oder Passwort ist nicht korrekt.");
    }
    throw error;
  }
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return publicData(request, {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizationId: user.organizationId },
    sessionId: session.id,
  });
}
