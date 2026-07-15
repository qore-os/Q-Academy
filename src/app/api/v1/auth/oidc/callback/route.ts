import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSession, getSession } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";
import {
  getAuthTenantForRequest,
  safeAuthLinkOrigin,
} from "@/lib/branding";
import { getOidcRuntimeConfiguration } from "@/lib/oidc-configuration";
import { resolveOidcUser } from "@/lib/oidc-identity";
import {
  isFreshOidcAuthenticationTime,
  oidcDestinationForRole,
  parseOidcAuthenticationTime,
} from "@/lib/oidc-model";
import { beginMfaLoginChallenge } from "@/lib/mfa/login-challenge";
import { exchangeOidcAuthorizationCode } from "@/lib/oidc-provider";
import {
  oidcTransactionCookieName,
  oidcTransactionCookieOptions,
  openOidcLoginTransaction,
} from "@/lib/oidc-transaction";

export const dynamic = "force-dynamic";

function equalState(left: string | null, right: string) {
  if (!left || left.length > 256 || right.length > 256) return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function redirectWithClearedTransaction(
  request: NextRequest,
  pathname: string,
  error?: string,
  transactionOrigin?: string,
) {
  const target = new URL(pathname, transactionOrigin ?? request.url);
  if (error) target.searchParams.set("oidc_error", error);
  const response = NextResponse.redirect(target);
  response.cookies.set(oidcTransactionCookieName(), "", {
    ...oidcTransactionCookieOptions(),
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const transaction = await openOidcLoginTransaction(
    request.cookies.get(oidcTransactionCookieName())?.value,
  );
  if (!transaction) {
    return redirectWithClearedTransaction(request, "/login", "expired");
  }
  const redirectFromTransaction = (pathname: string, error?: string) =>
    redirectWithClearedTransaction(
      request,
      pathname,
      error,
      transaction.redirectUri,
    );
  const returnedState = request.nextUrl.searchParams.get("state");
  if (!equalState(returnedState, transaction.state)) {
    return redirectFromTransaction("/login", "failed");
  }
  if (request.nextUrl.searchParams.has("error")) {
    return redirectFromTransaction("/login", "denied");
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4096) {
    return redirectFromTransaction("/login", "failed");
  }

  try {
    const branding = await getAuthTenantForRequest(request.headers);
    if (branding.organizationId !== transaction.organizationId) {
      return redirectFromTransaction("/login", "failed");
    }
    const expectedCallback = new URL(transaction.redirectUri);
    const requestOrigin = safeAuthLinkOrigin({
      request,
      expectedOrganizationId: transaction.organizationId,
      requestTenant: branding,
    });
    if (
      requestOrigin !== expectedCallback.origin ||
      request.nextUrl.pathname !== expectedCallback.pathname
    ) {
      return redirectFromTransaction("/login", "failed");
    }
    const linkSession = transaction.linkUserId
      ? await getSession()
      : null;
    if (
      transaction.linkUserId &&
      (!linkSession ||
        linkSession.sub !== transaction.linkUserId ||
        linkSession.sessionId !== transaction.linkSessionId ||
        linkSession.organizationId !== transaction.organizationId)
    ) {
      return redirectFromTransaction("/login", "failed");
    }
    const configuration = await getOidcRuntimeConfiguration(
      transaction.organizationId,
    );
    if (
      !configuration ||
      configuration.issuer !== transaction.issuer ||
      configuration.version !== transaction.configurationVersion
    ) {
      return redirectFromTransaction("/login", "changed");
    }
    const currentUrl = new URL(transaction.redirectUri);
    currentUrl.search = request.nextUrl.search;
    const claims = await exchangeOidcAuthorizationCode({
      configuration,
      currentUrl,
      state: transaction.state,
      nonce: transaction.nonce,
      codeVerifier: transaction.codeVerifier,
      requireFreshAuthentication: transaction.requireFreshAuthentication,
    });
    const authTime = parseOidcAuthenticationTime(claims.auth_time);
    if (
      transaction.requireFreshAuthentication &&
      !isFreshOidcAuthenticationTime(authTime)
    ) {
      return redirectFromTransaction("/login", "failed");
    }
    const resolved = await resolveOidcUser({
      organizationId: transaction.organizationId,
      expectedConfigurationVersion: transaction.configurationVersion,
      issuer: transaction.issuer,
      rawClaims: claims,
      authorizedLink:
        transaction.linkUserId && transaction.linkSessionId
          ? {
              userId: transaction.linkUserId,
              sessionId: transaction.linkSessionId,
            }
          : null,
    });
    const authentication = {
      method: "oidc",
      identityId: resolved.identityId,
      configurationVersion: transaction.configurationVersion,
      authTime,
    } as const;
    const destination = oidcDestinationForRole(
      resolved.user.role,
      transaction.returnTo,
    );
    if (await beginMfaLoginChallenge(resolved.user, authentication, destination)) {
      return redirectFromTransaction("/login/mfa");
    }
    await createSession(resolved.user, authentication);
    return redirectFromTransaction(destination);
  } catch (error) {
    const errorCode =
      error instanceof ApiError
        ? error.status === 403
          ? "account"
          : error.status === 409
            ? "changed"
            : error.status >= 500
              ? "unavailable"
              : "failed"
        : "failed";
    return redirectFromTransaction("/login", errorCode);
  }
}
