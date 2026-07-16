import assert from "node:assert/strict";
import test from "node:test";

import {
  browserPermissionsPolicy,
  buildDocumentContentSecurityPolicy,
} from "@/lib/content-security-policy";
import {
  evaluateZapRouteContract,
  ZAP_ROUTE_CONTRACT_ORIGIN,
  ZAP_ROUTE_MAX_RESPONSE_BYTES,
  type ZapRouteObservation,
} from "@/lib/operations/zap-route-contract";

const commonHeaders = {
  "cross-origin-opener-policy": ["same-origin-allow-popups"],
  "origin-agent-cluster": ["?1"],
  "permissions-policy": [browserPermissionsPolicy],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "strict-transport-security": ["max-age=63072000; includeSubDomains"],
  "x-content-type-options": ["nosniff"],
  "x-dns-prefetch-control": ["off"],
  "x-download-options": ["noopen"],
  "x-frame-options": ["SAMEORIGIN"],
  "x-permitted-cross-domain-policies": ["none"],
  "x-xss-protection": ["0"],
} as const;

function observation(
  path: string,
  index: number,
): ZapRouteObservation {
  const nonce = String(index + 1).repeat(32);
  const contentSecurityPolicy = buildDocumentContentSecurityPolicy({
    nonce,
    development: false,
    upgradeInsecureRequests: false,
  });
  const contentType =
    path === "/robots.txt"
      ? "text/plain"
      : path === "/sitemap.xml"
        ? "application/xml"
        : "text/html; charset=utf-8";
  const body =
    path === "/robots.txt"
      ? "User-Agent: *\nDisallow: /\n\n"
      : path === "/sitemap.xml"
        ? '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "</urlset>\n"
        : `<!DOCTYPE html><html><body><script nonce="${nonce}"></script></body></html>`;
  return {
    path,
    status: 200,
    headers: {
      ...commonHeaders,
      "content-security-policy": [contentSecurityPolicy],
      "content-type": [contentType],
    },
    body: Buffer.from(body, "utf8"),
  };
}

function reviewedObservations() {
  return [
    observation("/login", 0),
    observation("/password/forgot", 1),
    observation("/robots.txt", 2),
    observation("/sitemap.xml", 3),
  ];
}

test("accepts and sanitizes the deterministic production route contract", () => {
  const observations = reviewedObservations();
  const evidence = evaluateZapRouteContract(observations);

  assert.equal(evidence.passed, true);
  assert.equal(evidence.target, ZAP_ROUTE_CONTRACT_ORIGIN);
  assert.equal(evidence.routes.length, 4);
  assert.deepEqual(evidence.issueCodes, []);
  assert.ok(evidence.routes.every((route) => route.issueCodes.length === 0));
  for (const [index] of observations.entries()) {
    assert.equal(
      JSON.stringify(evidence).includes(String(index + 1).repeat(32)),
      false,
    );
  }
});

test("rejects missing, duplicate, and unexpected route observations", async (t) => {
  await t.test("missing", () => {
    const evidence = evaluateZapRouteContract(reviewedObservations().slice(0, 3));
    assert.equal(evidence.passed, false);
    assert.ok(evidence.issueCodes.includes("missing_route"));
    assert.ok(evidence.issueCodes.includes("route_count"));
  });

  await t.test("duplicate", () => {
    const observations = reviewedObservations();
    observations[3] = structuredClone(observations[0]!);
    const evidence = evaluateZapRouteContract(observations);
    assert.equal(evidence.passed, false);
    assert.ok(evidence.issueCodes.includes("duplicate_route"));
    assert.ok(evidence.issueCodes.includes("missing_route"));
  });

  await t.test("unexpected", () => {
    const evidence = evaluateZapRouteContract([
      ...reviewedObservations(),
      observation("/admin", 4),
    ]);
    assert.equal(evidence.passed, false);
    assert.ok(evidence.issueCodes.includes("unexpected_route"));
  });
});

test("rejects status, redirect, cookies, disclosure, and header regressions", async (t) => {
  for (const [name, mutate] of [
    ["status", (item: ZapRouteObservation) => (item.status = 307)],
    [
      "redirect",
      (item: ZapRouteObservation) => (item.headers.location = ["/login"]),
    ],
    [
      "cookie",
      (item: ZapRouteObservation) =>
        (item.headers["set-cookie"] = ["session=unexpected"]),
    ],
    [
      "powered by",
      (item: ZapRouteObservation) =>
        (item.headers["x-powered-by"] = ["Next.js"]),
    ],
    [
      "security header",
      (item: ZapRouteObservation) =>
        (item.headers["x-frame-options"] = ["DENY"]),
    ],
  ] as const) {
    await t.test(name, () => {
      const observations = reviewedObservations();
      mutate(observations[0]!);
      assert.equal(evaluateZapRouteContract(observations).passed, false);
    });
  }
});

test("rejects MIME, static body, CSP, and HTML nonce regressions", async (t) => {
  await t.test("MIME", () => {
    const observations = reviewedObservations();
    observations[2]!.headers["content-type"] = ["text/html; charset=utf-8"];
    assert.equal(evaluateZapRouteContract(observations).passed, false);
  });

  await t.test("static body", () => {
    const observations = reviewedObservations();
    observations[3]!.body = Buffer.from("<urlset />\n");
    assert.equal(evaluateZapRouteContract(observations).passed, false);
  });

  await t.test("CSP", () => {
    const observations = reviewedObservations();
    observations[0]!.headers["content-security-policy"] = [
      observations[0]!.headers["content-security-policy"]![0]!.replace(
        "object-src 'none'",
        "object-src 'self'",
      ),
    ];
    assert.equal(evaluateZapRouteContract(observations).passed, false);
  });

  await t.test("nonce binding", () => {
    const observations = reviewedObservations();
    observations[1]!.body = Buffer.from(
      '<!DOCTYPE html><html><script nonce="different"></script></html>',
    );
    assert.equal(evaluateZapRouteContract(observations).passed, false);
  });
});

test("rejects transport failure and oversized evidence fail-closed", async (t) => {
  await t.test("timeout", () => {
    const observations = reviewedObservations();
    observations[0] = {
      path: "/login",
      status: null,
      headers: {},
      body: new Uint8Array(),
      transportError: "request_timeout",
    };
    assert.equal(evaluateZapRouteContract(observations).passed, false);
  });

  await t.test("oversized", () => {
    const observations = reviewedObservations();
    observations[0]!.body = new Uint8Array(ZAP_ROUTE_MAX_RESPONSE_BYTES + 1);
    assert.equal(evaluateZapRouteContract(observations).passed, false);
  });
});
