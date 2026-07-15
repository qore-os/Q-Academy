import assert from "node:assert/strict";
import test from "node:test";

import { onRequestError } from "../src/instrumentation";

test("onRequestError emits only a fixed route category and method class", async () => {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...values: unknown[]) => {
    calls.push(values);
  };
  try {
    await onRequestError(
      new Error(
        "Failed for https://private.example/users/alice@example.test?token=secret",
      ),
      {
        path: "/api/v1/users/private-user-id?email=alice@example.test",
        method: "POST",
        headers: {
          "x-request-id": "018f47a2-7b9d-7a31-8f65-a91a92d81234",
          authorization: "Bearer private-token",
          cookie: "session=private",
        },
      },
      {
        routerKind: "App Router",
        routePath: "/app/api/v1/admin/users/[id]/route",
        routeType: "route",
        revalidateReason: undefined,
      },
    );
  } finally {
    console.error = original;
  }

  assert.equal(calls.length, 1);
  const serialized = calls[0][0] as string;
  const event = JSON.parse(serialized) as Record<string, unknown>;
  assert.equal(event.action, "next.request_error.admin_api.write");
  assert.equal(
    event.requestId,
    "018f47a2-7b9d-7a31-8f65-a91a92d81234",
  );
  for (const forbidden of [
    "/api/v1/users/private-user-id",
    "/app/api/v1/admin/users/[id]/route",
    "alice@example.test",
    "private-token",
    "session=private",
    '"authorization"',
    '"cookie"',
    '"path"',
    '"headers"',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("onRequestError maps unknown methods and render routes to fixed fallbacks", async () => {
  const original = console.error;
  let serialized = "";
  console.error = (value: unknown) => {
    serialized = String(value);
  };
  try {
    await onRequestError(
      "non-error secret=private",
      {
        path: "/customers/private-tenant",
        method: "PRIVATE-METHOD-WITH-ID",
        headers: { "x-request-id": ["ambiguous", "private"] },
      },
      {
        routerKind: "App Router",
        routePath: "/app/(academy)/customers/[tenantId]/page",
        routeType: "render",
        renderSource: "server-rendering",
        revalidateReason: undefined,
      },
    );
  } finally {
    console.error = original;
  }

  const event = JSON.parse(serialized) as Record<string, unknown>;
  assert.equal(event.action, "next.request_error.academy_page.other");
  assert.equal(event.requestId, undefined);
  assert.equal(serialized.includes("PRIVATE-METHOD"), false);
  assert.equal(serialized.includes("private-tenant"), false);
});
