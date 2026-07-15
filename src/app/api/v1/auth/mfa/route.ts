import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";
import { publicData, publicProblem } from "@/lib/api/public-auth";
import {
  canonicalTenantAuthOrigin,
  getAuthTenantForRequest,
  safeAuthLinkOrigin,
} from "@/lib/branding";
import { parseSessionJson } from "@/lib/session-json";
import { authMfaCompleteSchema } from "@/lib/api/schemas";
import {
  completeMfaLoginChallenge,
  getMfaLoginChallengeView,
  MfaLoginChallengeError,
} from "@/lib/mfa/login-challenge";

export const dynamic = "force-dynamic";

async function trustedTenantMutation(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite !== null && fetchSite !== "same-origin")) return false;
  const tenant = await getAuthTenantForRequest(request.headers);
  if (!tenant.organizationId) return false;
  try {
    const requestOrigin = safeAuthLinkOrigin({
      request,
      expectedOrganizationId: tenant.organizationId,
      requestTenant: tenant,
    });
    const canonical = canonicalTenantAuthOrigin(
      tenant,
      requestOrigin,
    );
    return new URL(origin).origin === canonical;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    return publicData(request, await getMfaLoginChallengeView());
  } catch (error) {
    if (error instanceof MfaLoginChallengeError) {
      return publicProblem(request, 401, error.code, error.message);
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!(await trustedTenantMutation(request))) {
    return publicProblem(request, 403, "forbidden", "Die Anfrage muss von der konfigurierten Anwendung stammen.");
  }
  let input: unknown;
  try {
    input = await parseSessionJson(request, { maxBytes: 512 });
  } catch (error) {
    if (error instanceof ApiError) {
      return publicProblem(request, error.status, error.code, error.message);
    }
    throw error;
  }
  const parsed = authMfaCompleteSchema.safeParse(input);
  if (!parsed.success) {
    return publicProblem(request, 422, "validation_error", "Der MFA-Code ist ungueltig.", parsed.error.issues);
  }
  try {
    const completion = await completeMfaLoginChallenge(parsed.data.code);
    const session = await createSession(
      completion.user,
      completion.authentication,
      { method: completion.method },
    );
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, completion.user.id));
    return publicData(request, {
      user: {
        id: completion.user.id,
        email: completion.user.email,
        firstName: completion.user.firstName,
        lastName: completion.user.lastName,
        role: completion.user.role,
        organizationId: completion.user.organizationId,
      },
      sessionId: session.id,
      recoveryCodes: completion.recoveryCodes,
      redirectTo: completion.destination,
    });
  } catch (error) {
    if (error instanceof MfaLoginChallengeError) {
      const status = error.code === "rate_limited" ? 429 : error.code === "invalid_code" ? 401 : 409;
      const response = publicProblem(request, status, error.code, error.message);
      if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
      return response;
    }
    throw error;
  }
}
