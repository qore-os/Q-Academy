import { timingSafeEqual } from "node:crypto";

import { normalizeCustomDomainHostname } from "@/lib/custom-domain-model";

export function authorizeCaddyTlsAskRequest(
  request: Request,
  expectedSecret: string | null | undefined,
) {
  if (!expectedSecret) return false;
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export function caddyTlsAskHostname(request: Request) {
  const url = new URL(request.url);
  const parameters = [...url.searchParams.keys()];
  const domains = url.searchParams.getAll("domain");
  if (
    url.hash ||
    parameters.length !== 1 ||
    parameters[0] !== "domain" ||
    domains.length !== 1
  ) {
    return null;
  }
  return normalizeCustomDomainHostname(domains[0] ?? "");
}
