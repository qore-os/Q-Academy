import { authorizeCaddyTlsAskRequest, caddyTlsAskHostname } from "@/lib/caddy-tls-ask";
import { isCustomDomainTlsAuthorized } from "@/lib/custom-domains";
import { getCaddyTlsAskSecret } from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Length": "0",
  "X-Content-Type-Options": "nosniff",
};

function emptyResponse(status: 200 | 404 | 503) {
  return new Response(null, { status, headers: responseHeaders });
}

export async function GET(request: Request) {
  let expectedSecret: string | null;
  try {
    expectedSecret = getCaddyTlsAskSecret();
  } catch (error) {
    logServerError(error, { action: "caddy.tls_ask.configuration" });
    return emptyResponse(503);
  }
  if (!authorizeCaddyTlsAskRequest(request, expectedSecret)) {
    return emptyResponse(404);
  }

  const hostname = caddyTlsAskHostname(request);
  if (!hostname) return emptyResponse(404);
  try {
    return emptyResponse(
      (await isCustomDomainTlsAuthorized(hostname)) ? 200 : 404,
    );
  } catch (error) {
    logServerError(error, { action: "caddy.tls_ask.lookup" });
    return emptyResponse(503);
  }
}
