import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INTERNAL_CLEANUP_MAX_LIMIT,
  INTERNAL_JOB_DISPATCH_MAX_LIMIT,
  INTERNAL_JOB_DISPATCH_QUERY,
  INTERNAL_MEDIA_DISPATCH_MAX_LIMIT,
  INTERNAL_MEDIA_DISPATCH_QUERY,
  INTERNAL_MEDIA_MAINTENANCE_MAX_LIMIT,
  INTERNAL_MEDIA_MAINTENANCE_QUERY,
  INTERNAL_WEBHOOK_DISPATCH_MAX_LIMIT,
  INTERNAL_WEBHOOK_DISPATCH_QUERY,
  internalJobProblem,
  parseInternalJobQuery,
} from "../src/lib/internal-job-request";

function request(query = "") {
  return new Request(`https://academy.example.test/internal${query}`);
}

function expectInvalid(
  result: { ok: boolean; detail?: string },
  expectedDetail?: string,
) {
  assert.equal(result.ok, false);
  assert.equal(typeof result.detail, "string");
  if (expectedDetail) assert.equal(result.detail, expectedDetail);
}

test("internal job query defaults and hard maxima are explicit", () => {
  assert.equal(INTERNAL_JOB_DISPATCH_MAX_LIMIT, 100);
  assert.equal(INTERNAL_CLEANUP_MAX_LIMIT, 1_000);
  assert.equal(INTERNAL_WEBHOOK_DISPATCH_MAX_LIMIT, 100);
  assert.equal(INTERNAL_MEDIA_DISPATCH_MAX_LIMIT, 1);
  assert.equal(INTERNAL_MEDIA_MAINTENANCE_MAX_LIMIT, 5);

  assert.deepEqual(
    parseInternalJobQuery(request(), INTERNAL_JOB_DISPATCH_QUERY),
    {
      ok: true,
      value: { limit: 25, cleanup: null, cleanupLimit: 250 },
    },
  );
  assert.deepEqual(
    parseInternalJobQuery(
      request("?limit=100&cleanup=run&cleanupLimit=1000"),
      INTERNAL_JOB_DISPATCH_QUERY,
    ),
    {
      ok: true,
      value: { limit: 100, cleanup: "run", cleanupLimit: 1_000 },
    },
  );
  assert.deepEqual(
    parseInternalJobQuery(
      request("?limit=100"),
      INTERNAL_WEBHOOK_DISPATCH_QUERY,
    ),
    { ok: true, value: { limit: 100 } },
  );
  assert.deepEqual(
    parseInternalJobQuery(request(), INTERNAL_MEDIA_DISPATCH_QUERY),
    { ok: true, value: { limit: 1 } },
  );
  assert.deepEqual(
    parseInternalJobQuery(request(), INTERNAL_MEDIA_MAINTENANCE_QUERY),
    { ok: true, value: { limit: 5 } },
  );
});

test("job dispatch rejects non-canonical, negative, and oversized batches", () => {
  for (const query of [
    "?limit=",
    "?limit=-1",
    "?limit=0",
    "?limit=01",
    "?limit=1.5",
    "?limit=1e2",
    "?limit=101",
    "?limit=99999999999999999",
  ]) {
    expectInvalid(
      parseInternalJobQuery(request(query), INTERNAL_JOB_DISPATCH_QUERY),
      "limit muss eine ganze Zahl zwischen 1 und 100 sein.",
    );
  }

  for (const query of [
    "?cleanupLimit=0",
    "?cleanupLimit=-1",
    "?cleanupLimit=1001",
  ]) {
    expectInvalid(
      parseInternalJobQuery(request(query), INTERNAL_JOB_DISPATCH_QUERY),
      "cleanupLimit muss eine ganze Zahl zwischen 1 und 1000 sein.",
    );
  }
  expectInvalid(
    parseInternalJobQuery(
      request("?cleanup=delete"),
      INTERNAL_JOB_DISPATCH_QUERY,
    ),
    "Der Parameter cleanup unterstuetzt nur run oder dry-run.",
  );
});

test("all internal job schemas reject duplicate and unknown query keys", () => {
  const cases = [
    parseInternalJobQuery(
      request("?limit=1&limit=1"),
      INTERNAL_JOB_DISPATCH_QUERY,
    ),
    parseInternalJobQuery(
      request("?cleanup=run&cleanup=run"),
      INTERNAL_JOB_DISPATCH_QUERY,
    ),
    parseInternalJobQuery(
      request("?cleanupLimit=1&cleanupLimit=1"),
      INTERNAL_JOB_DISPATCH_QUERY,
    ),
    parseInternalJobQuery(
      request("?limit=1&limit=1"),
      INTERNAL_WEBHOOK_DISPATCH_QUERY,
    ),
    parseInternalJobQuery(
      request("?limit=1&limit=1"),
      INTERNAL_MEDIA_DISPATCH_QUERY,
    ),
    parseInternalJobQuery(
      request("?limit=5&limit=5"),
      INTERNAL_MEDIA_MAINTENANCE_QUERY,
    ),
  ];
  for (const result of cases) {
    expectInvalid(
      result,
      "Query-Parameter duerfen nur einmal gesetzt werden.",
    );
  }

  for (const schema of [
    INTERNAL_JOB_DISPATCH_QUERY,
    INTERNAL_WEBHOOK_DISPATCH_QUERY,
    INTERNAL_MEDIA_DISPATCH_QUERY,
    INTERNAL_MEDIA_MAINTENANCE_QUERY,
  ]) {
    expectInvalid(
      parseInternalJobQuery(request("?unknown=1"), schema),
      "Die Anfrage enthaelt unbekannte Query-Parameter.",
    );
  }
});

test("dedicated webhook and media workers enforce their route maxima", () => {
  expectInvalid(
    parseInternalJobQuery(
      request("?limit=101"),
      INTERNAL_WEBHOOK_DISPATCH_QUERY,
    ),
  );
  expectInvalid(
    parseInternalJobQuery(
      request("?limit=2"),
      INTERNAL_MEDIA_DISPATCH_QUERY,
    ),
  );
  expectInvalid(
    parseInternalJobQuery(
      request("?limit=6"),
      INTERNAL_MEDIA_MAINTENANCE_QUERY,
    ),
  );
});

test("internal query failures use one no-store Problem Details contract", async () => {
  const requestId = "10000000-0000-4000-8000-000000000001";
  const response = internalJobProblem(
    requestId,
    400,
    "limit muss eine ganze Zahl zwischen 1 und 100 sein.",
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/problem+json");
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.deepEqual(await response.json(), {
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    detail: "limit muss eine ganze Zahl zwischen 1 und 100 sein.",
    requestId,
  });
});

test("every internal batch route uses central auth, parsing, and problems", () => {
  const routes = [
    [
      "src/app/api/internal/jobs/dispatch/route.ts",
      "INTERNAL_JOB_DISPATCH_QUERY",
    ],
    [
      "src/app/api/internal/webhooks/dispatch/route.ts",
      "INTERNAL_WEBHOOK_DISPATCH_QUERY",
    ],
    [
      "src/app/api/internal/jobs/media/dispatch/route.ts",
      "INTERNAL_MEDIA_DISPATCH_QUERY",
    ],
    [
      "src/app/api/internal/jobs/media/maintenance/route.ts",
      "INTERNAL_MEDIA_MAINTENANCE_QUERY",
    ],
  ] as const;

  for (const [file, schema] of routes) {
    const source = readFileSync(file, "utf8");
    const handler = source.indexOf("export async function POST");
    const authentication = source.indexOf(
      "authorizeInternalJobRequest(request)",
      handler,
    );
    const parsing = source.indexOf("parseInternalJobQuery(", handler);
    assert.ok(authentication >= 0 && parsing > authentication, file);
    assert.match(source, new RegExp(schema), file);
    assert.match(source, /internalJobProblem\(requestId, 400, query\.detail\)/, file);
    assert.doesNotMatch(source, /searchParams\.(?:get|getAll)\(/, file);
  }

  const webhookRoute = readFileSync(routes[1][0], "utf8");
  assert.doesNotMatch(webhookRoute, /timingSafeEqual|getCronSecret|function authorized/);
});
