import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { consumeAuthRateLimit, tenantAuthIdentifier } from "@/lib/auth-rate-limit";
import {
  canonicalTenantAuthOrigin,
  getAuthTenantForRequest,
  safeAuthLinkOrigin,
} from "@/lib/branding";
import { getOidcRuntimeConfiguration } from "@/lib/oidc-configuration";
import { oidcRateClientCookiePolicy } from "@/lib/oidc-cookie-policy";
import { explicitlyAcceptsJson } from "@/lib/http-accept";
import { sanitizeOidcReturnTo } from "@/lib/oidc-model";
import {
  createOidcAuthorizationRequest,
  oidcProtocolRandom,
} from "@/lib/oidc-provider";
import {
  oidcTransactionCookieName,
  oidcTransactionCookieOptions,
  sealOidcLoginTransaction,
} from "@/lib/oidc-transaction";
import { getAuthRateLimitSecret } from "@/lib/server-environment";

export const dynamic = "force-dynamic";

function rateClientCookiePolicy() {
  return oidcRateClientCookiePolicy(process.env.NODE_ENV === "production");
}

function signRateClientIdentifier(identifier: string) {
  return createHmac("sha256", getAuthRateLimitSecret())
    .update("q-academy:oidc-rate-client:v1\0")
    .update(identifier)
    .digest("hex");
}

function rateClientIdentifier(request: NextRequest) {
  const stored = request.cookies.get(rateClientCookiePolicy().name)?.value;
  const match = /^([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(stored ?? "");
  if (match) {
    const expected = Buffer.from(signRateClientIdentifier(match[1]), "hex");
    const supplied = Buffer.from(match[2], "hex");
    if (
      expected.length === supplied.length &&
      timingSafeEqual(expected, supplied)
    ) {
      return match[1];
    }
  }
  return randomBytes(32).toString("hex");
}

function withRateClient(response: NextResponse, identifier: string) {
  const policy = rateClientCookiePolicy();
  response.cookies.set(
    policy.name,
    `${identifier}.${signRateClientIdentifier(identifier)}`,
    policy.options,
  );
  return response;
}

function loginRedirect(request: NextRequest, error: string) {
  const target = new URL("/login", request.url);
  target.searchParams.set("oidc_error", error);
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function callbackUrl(origin: string) {
  return new URL("/api/v1/auth/oidc/callback", origin).toString();
}

function validLinkOrigin(request: NextRequest, expectedOrigin: string) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

async function startOidc(request: NextRequest, linkCurrentSession: boolean) {
  const branding = await getAuthTenantForRequest(request.headers);
  if (!branding.organizationId) return loginRedirect(request, "unavailable");
  const requestOrigin = safeAuthLinkOrigin({
    request,
    expectedOrganizationId: branding.organizationId,
    requestTenant: branding,
  });
  const canonicalOrigin = canonicalTenantAuthOrigin(
    branding,
    requestOrigin,
  );
  if (process.env.NODE_ENV === "production") {
    if (requestOrigin !== canonicalOrigin) {
      if (linkCurrentSession) {
        return loginRedirect(request, "failed");
      }
      const target = new URL(request.nextUrl.pathname, canonicalOrigin);
      target.search = request.nextUrl.search;
      const response = NextResponse.redirect(target, 307);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
  }
  const clientIdentifier = rateClientIdentifier(request);
  const rateLimit = await consumeAuthRateLimit({
    action: "oidc_login",
    identifier: tenantAuthIdentifier(
      branding.organizationId,
      clientIdentifier,
    ),
    scopeIdentifier: branding.organizationId,
    headers: request.headers,
  });
  if (rateLimit.limited) {
    return withRateClient(
      loginRedirect(request, "rate_limited"),
      clientIdentifier,
    );
  }

  try {
    const linkSession = linkCurrentSession ? await getSession() : null;
    if (
      linkCurrentSession &&
      (!validLinkOrigin(request, canonicalOrigin) ||
        !linkSession ||
        linkSession.organizationId !== branding.organizationId)
    ) {
      return withRateClient(
        loginRedirect(request, "failed"),
        clientIdentifier,
      );
    }
    const configuration = await getOidcRuntimeConfiguration(
      branding.organizationId,
    );
    if (!configuration) {
      return withRateClient(
        loginRedirect(request, "unavailable"),
        clientIdentifier,
      );
    }
    const redirectUri = callbackUrl(canonicalOrigin);
    const state = oidcProtocolRandom.state();
    const nonce = oidcProtocolRandom.nonce();
    const codeVerifier = oidcProtocolRandom.codeVerifier();
    const returnTo = sanitizeOidcReturnTo(
      request.nextUrl.searchParams.get("return_to"),
    );
    const authorizationUrl = await createOidcAuthorizationRequest({
      configuration,
      redirectUri,
      state,
      nonce,
      codeVerifier,
      requireFreshAuthentication: linkCurrentSession,
    });
    const transaction = await sealOidcLoginTransaction({
      state,
      nonce,
      codeVerifier,
      organizationId: configuration.organizationId,
      issuer: configuration.issuer,
      configurationVersion: configuration.version,
      redirectUri,
      returnTo,
      linkUserId: linkSession?.sub ?? null,
      linkSessionId: linkSession?.sessionId ?? null,
      requireFreshAuthentication: linkCurrentSession,
    });
    const response =
      linkCurrentSession &&
      explicitlyAcceptsJson(request.headers.get("accept"))
        ? NextResponse.json({ authorizationUrl: authorizationUrl.toString() })
        : NextResponse.redirect(
            authorizationUrl,
            linkCurrentSession ? 303 : 302,
          );
    response.cookies.set(
      oidcTransactionCookieName(),
      transaction,
      oidcTransactionCookieOptions(),
    );
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return withRateClient(response, clientIdentifier);
  } catch {
    return withRateClient(
      loginRedirect(request, "unavailable"),
      clientIdentifier,
    );
  }
}

export async function GET(request: NextRequest) {
  return startOidc(request, false);
}

export async function POST(request: NextRequest) {
  return startOidc(request, true);
}
