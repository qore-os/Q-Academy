import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "@/proxy";

test("proxy creates an absolute login redirect for an anonymous root request", async () => {
  const response = proxy(new NextRequest("https://academy.example/"));

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://academy.example/login",
  );
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0, must-revalidate",
  );
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(await response.text(), "");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /script-src [^;]*'strict-dynamic'/,
  );
});

for (const cookieName of [
  "q_academy_session",
  "__Host-q_academy_session",
] as const) {
  test(`proxy preserves the role-aware root route for ${cookieName}`, () => {
    const response = proxy(
      new NextRequest("https://academy.example/", {
        headers: { cookie: `${cookieName}=opaque-session` },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
}
