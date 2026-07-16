import { createHash } from "node:crypto";

export const ZAP_ROUTE_CONTRACT_ORIGIN =
  "http://academy.ci.q-academy.de:3000";
export const ZAP_ROUTE_CONTRACT_HOST = "academy.ci.q-academy.de:3000";
export const ZAP_ROUTE_CONTRACT_CONNECT_ADDRESS = "127.0.0.1:3000";
export const ZAP_ROUTE_CONTRACT_PATHS = [
  "/login",
  "/password/forgot",
  "/robots.txt",
  "/sitemap.xml",
] as const;
export const ZAP_ROUTE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type ContractPath = (typeof ZAP_ROUTE_CONTRACT_PATHS)[number];

export type ZapRouteObservation = {
  path: string;
  status: number | null;
  headers: Record<string, readonly string[]>;
  body: Uint8Array;
  transportError?:
    | "request_failed"
    | "request_timeout"
    | "response_too_large";
};

export type ZapRouteEvidence = {
  path: ContractPath;
  status: number | null;
  contentType: string | null;
  bodyBytes: number;
  bodySha256: string;
  normalizedCspSha256: string | null;
  issueCodes: string[];
};

export type ZapRouteContractEvidence = {
  schemaVersion: 1;
  target: typeof ZAP_ROUTE_CONTRACT_ORIGIN;
  connectAddress: typeof ZAP_ROUTE_CONTRACT_CONNECT_ADDRESS;
  passed: boolean;
  issueCodes: string[];
  routes: ZapRouteEvidence[];
};

const NONCE_SOURCE_PATTERN = /'nonce-([A-Za-z0-9_-]{32,128})'/g;
const EXPECTED_DOCUMENT_POLICY =
  "default-src 'self'; script-src 'self' 'nonce-{reviewed}' 'strict-dynamic'; " +
  "script-src-attr 'none'; style-src 'self' 'unsafe-inline'; " +
  "style-src-attr 'unsafe-inline'; img-src 'self' blob: data: https:; " +
  "media-src 'self' blob: https:; font-src 'self' data:; " +
  "connect-src 'self' https: wss:; frame-src 'self' https:; " +
  "worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const EXPECTED_PERMISSIONS_POLICY =
  "accelerometer=(), autoplay=(self), browsing-topics=(), camera=(self), " +
  "display-capture=(self), fullscreen=*, geolocation=(), gyroscope=(), " +
  "hid=(), magnetometer=(), microphone=(self), payment=(), " +
  "picture-in-picture=*, publickey-credentials-get=(self), serial=(), usb=()";
const EXPECTED_ROBOTS_BODY = "User-Agent: *\nDisallow: /\n\n";
const EXPECTED_SITEMAP_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  "</urlset>\n";
const EXPECTED_COMMON_HEADERS = {
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "origin-agent-cluster": "?1",
  "permissions-policy": EXPECTED_PERMISSIONS_POLICY,
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "SAMEORIGIN",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
} as const;

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function headerValues(
  observation: ZapRouteObservation,
  name: string,
) {
  return observation.headers[name] ?? [];
}

function singleHeader(
  observation: ZapRouteObservation,
  name: string,
  issueCodes: string[],
) {
  const values = headerValues(observation, name);
  if (values.length !== 1 || typeof values[0] !== "string") {
    issueCodes.push(`${name}_cardinality`);
    return null;
  }
  return values[0];
}

function validateExactHeader(
  observation: ZapRouteObservation,
  name: string,
  expected: string,
  issueCodes: string[],
) {
  const value = singleHeader(observation, name, issueCodes);
  if (value !== null && value !== expected) {
    issueCodes.push(`${name}_value`);
  }
  return value;
}

function normalizedDocumentPolicy(
  value: string,
  issueCodes: string[],
) {
  const matches = [...value.matchAll(NONCE_SOURCE_PATTERN)];
  if (matches.length !== 1) {
    issueCodes.push("content-security-policy_nonce");
    return null;
  }
  const normalized = value.replace(
    NONCE_SOURCE_PATTERN,
    "'nonce-{reviewed}'",
  );
  if (normalized !== EXPECTED_DOCUMENT_POLICY) {
    issueCodes.push("content-security-policy_value");
    return null;
  }
  return { nonce: matches[0]![1]!, normalized };
}

function decodeBody(body: Uint8Array, issueCodes: string[]) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    issueCodes.push("body_utf8");
    return null;
  }
}

function validateRoute(
  path: ContractPath,
  observation: ZapRouteObservation,
): ZapRouteEvidence {
  const issueCodes: string[] = [];
  if (observation.transportError) {
    issueCodes.push(observation.transportError);
  }
  if (observation.status !== 200) issueCodes.push("status");
  if (observation.body.byteLength > ZAP_ROUTE_MAX_RESPONSE_BYTES) {
    issueCodes.push("response_too_large");
  }

  for (const [name, expected] of Object.entries(EXPECTED_COMMON_HEADERS)) {
    validateExactHeader(observation, name, expected, issueCodes);
  }
  for (const forbiddenHeader of ["location", "set-cookie", "x-powered-by"]) {
    if (headerValues(observation, forbiddenHeader).length !== 0) {
      issueCodes.push(`${forbiddenHeader}_present`);
    }
  }

  const contentType = singleHeader(observation, "content-type", issueCodes);
  const csp = singleHeader(
    observation,
    "content-security-policy",
    issueCodes,
  );
  const body = decodeBody(observation.body, issueCodes);
  let normalizedCsp: string | null = null;

  if (path === "/login" || path === "/password/forgot") {
    if (contentType !== null && contentType !== "text/html; charset=utf-8") {
      issueCodes.push("content-type_value");
    }
    if (csp !== null) {
      const documentPolicy = normalizedDocumentPolicy(csp, issueCodes);
      normalizedCsp = documentPolicy?.normalized ?? null;
      if (
        body !== null &&
        documentPolicy !== null &&
        (!body.startsWith("<!DOCTYPE html>") ||
          !body.includes(`<html`) ||
          !body.includes(`nonce="${documentPolicy.nonce}"`))
      ) {
        issueCodes.push("document_body");
      }
    }
  } else {
    const expectedContentType =
      path === "/robots.txt" ? "text/plain" : "application/xml";
    if (contentType !== null && contentType !== expectedContentType) {
      issueCodes.push("content-type_value");
    }
    if (csp !== null) {
      normalizedCsp =
        normalizedDocumentPolicy(csp, issueCodes)?.normalized ?? null;
    }
    const expectedBody =
      path === "/robots.txt" ? EXPECTED_ROBOTS_BODY : EXPECTED_SITEMAP_BODY;
    if (body !== null && body !== expectedBody) issueCodes.push("body_value");
  }

  return {
    path,
    status: observation.status,
    contentType,
    bodyBytes: observation.body.byteLength,
    bodySha256: sha256(observation.body),
    normalizedCspSha256:
      normalizedCsp === null ? null : sha256(normalizedCsp),
    issueCodes: [...new Set(issueCodes)].sort(),
  };
}

export function evaluateZapRouteContract(
  observations: readonly ZapRouteObservation[],
): ZapRouteContractEvidence {
  const issueCodes: string[] = [];
  const byPath = new Map<string, ZapRouteObservation>();
  for (const observation of observations) {
    if (!ZAP_ROUTE_CONTRACT_PATHS.includes(observation.path as ContractPath)) {
      issueCodes.push("unexpected_route");
      continue;
    }
    if (byPath.has(observation.path)) {
      issueCodes.push("duplicate_route");
      continue;
    }
    byPath.set(observation.path, observation);
  }

  const routes = ZAP_ROUTE_CONTRACT_PATHS.map((path) => {
    const observation = byPath.get(path);
    if (observation) return validateRoute(path, observation);
    issueCodes.push("missing_route");
    return validateRoute(path, {
      path,
      status: null,
      headers: {},
      body: new Uint8Array(),
      transportError: "request_failed",
    });
  });
  if (observations.length !== ZAP_ROUTE_CONTRACT_PATHS.length) {
    issueCodes.push("route_count");
  }

  const uniqueIssues = [...new Set(issueCodes)].sort();
  return {
    schemaVersion: 1,
    target: ZAP_ROUTE_CONTRACT_ORIGIN,
    connectAddress: ZAP_ROUTE_CONTRACT_CONNECT_ADDRESS,
    passed:
      uniqueIssues.length === 0 &&
      routes.every((route) => route.issueCodes.length === 0),
    issueCodes: uniqueIssues,
    routes,
  };
}
