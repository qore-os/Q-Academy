const DEVELOPMENT_TRANSACTION_COOKIE = "q_academy_oidc_transaction";
const PRODUCTION_TRANSACTION_COOKIE = "__Host-q_academy_oidc_transaction";
const DEVELOPMENT_RATE_CLIENT_COOKIE = "q_academy_oidc_client";
const PRODUCTION_RATE_CLIENT_COOKIE = "__Host-q_academy_oidc_client";

function sharedOptions(production: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}

export function oidcTransactionCookiePolicy(production: boolean) {
  return {
    name: production
      ? PRODUCTION_TRANSACTION_COOKIE
      : DEVELOPMENT_TRANSACTION_COOKIE,
    options: sharedOptions(production, 10 * 60),
  };
}

export function oidcRateClientCookiePolicy(production: boolean) {
  return {
    name: production
      ? PRODUCTION_RATE_CLIENT_COOKIE
      : DEVELOPMENT_RATE_CLIENT_COOKIE,
    options: sharedOptions(production, 15 * 60),
  };
}
