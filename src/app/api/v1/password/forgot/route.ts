import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { publicData, publicProblem } from "@/lib/api/public-auth";
import { passwordForgotSchema } from "@/lib/api/schemas";
import { createPasswordResetDelivery } from "@/lib/auth-tokens";
import {
  BoundedJsonRequestError,
  parseBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  consumeAuthRateLimit,
  normalizeAuthEmail,
  retryAfterSeconds,
  tenantAuthIdentifier,
} from "@/lib/auth-rate-limit";
import { authRateLimitScopeForOrganization } from "@/lib/auth-rate-limit-guards";
import {
  getAuthTenantForRequest,
  safeAuthLinkOrigin,
} from "@/lib/branding";
import { InactiveOrganizationError } from "@/lib/organization-status";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await parseBoundedJsonRequest(request, { maxBytes: 1_024 });
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
  const parsed = passwordForgotSchema.safeParse(body);
  if (!parsed.success) return publicProblem(request, 422, "validation_error", "Die Anfrage ist ungueltig.", parsed.error.issues);
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
  const requestTenant = await getAuthTenantForRequest(request.headers);
  const organizationId = explicitSlug
    ? explicitTenant?.id
    : requestTenant.organizationId;
  const tenantScope = authRateLimitScopeForOrganization(organizationId);
  const rateIdentifier = tenantAuthIdentifier(
    tenantScope,
    email,
  );
  const rateLimit = await consumeAuthRateLimit({
    action: "password_forgot",
    identifier: rateIdentifier,
    scopeIdentifier: tenantScope,
    headers: request.headers,
  });
  if (rateLimit.limited) {
    const response = publicProblem(request, 429, "rate_limit_exceeded", "Zu viele Anfragen. Bitte spaeter erneut versuchen.");
    response.headers.set("Retry-After", String(retryAfterSeconds(rateLimit.resetAt)));
    return response;
  }
  const loginConfiguration = await getPublicOidcLoginConfiguration(
    organizationId,
  );
  const [user] = organizationId && loginConfiguration.passwordLoginEnabled
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
  const responseNotBefore = Date.now() + 250 + randomInt(0, 101);
  let developmentToken: string | undefined;
  if (user?.status === "active") {
    const origin = safeAuthLinkOrigin({
      request,
      expectedOrganizationId: user.organizationId,
      requestTenant,
    });
    if (origin) {
      try {
        const { token } = await createPasswordResetDelivery({
          organizationId: user.organizationId,
          userId: user.id,
          email: user.email,
          origin,
        });
        if (process.env.NODE_ENV !== "production") developmentToken = token;
      } catch (error) {
        if (!(error instanceof InactiveOrganizationError)) throw error;
      }
    }
  }
  await delay(Math.max(0, responseNotBefore - Date.now()));
  return publicData(
    request,
    { accepted: true, ...(developmentToken ? { developmentToken } : {}) },
    202,
    { message: "Falls ein passendes Konto existiert, wurde ein Reset-Link versendet." },
  );
}
