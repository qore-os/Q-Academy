import { type NextRequest, NextResponse } from "next/server";

import {
  buildDocumentContentSecurityPolicy,
  createContentSecurityPolicyNonce,
} from "@/lib/content-security-policy";

const SESSION_COOKIE_NAMES = [
  "q_academy_session",
  "__Host-q_academy_session",
] as const;

function isSecureRequest(request: NextRequest) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  return forwardedProtocol === "https" || request.nextUrl.protocol === "https:";
}

function hasPotentialSession(request: NextRequest) {
  return SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
}

function applyDocumentPolicy(response: NextResponse, policy: string) {
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export function proxy(request: NextRequest) {
  const nonce = createContentSecurityPolicyNonce();
  const contentSecurityPolicy = buildDocumentContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: isSecureRequest(request),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  if (
    request.method === "GET" &&
    request.nextUrl.pathname === "/" &&
    !hasPotentialSession(request)
  ) {
    return applyDocumentPolicy(
      new NextResponse(null, {
        status: 307,
        headers: {
          Location: "/login",
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
          Vary: "Cookie",
        },
      }),
      contentSecurityPolicy,
    );
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applyDocumentPolicy(response, contentSecurityPolicy);
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|images|pwa|favicon.ico|manifest.webmanifest|offline.html|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
