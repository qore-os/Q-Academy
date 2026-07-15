import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeCaddyTlsAskRequest,
  caddyTlsAskHostname,
} from "../src/lib/caddy-tls-ask";

const secret = "C4ddyAsk-3TyU9iO5pA1sD7fG2hJ8kL4zX0cVbNmQ";

function request(
  query: string,
  authorization: string | null = `Bearer ${secret}`,
) {
  return new Request(`http://tls-ask-app/api/internal/caddy/tls-ask${query}`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

test("Caddy TLS ask authentication requires one exact bearer secret", () => {
  assert.equal(authorizeCaddyTlsAskRequest(request("?domain=academy.de"), secret), true);
  assert.equal(
    authorizeCaddyTlsAskRequest(
      request("?domain=academy.de", `Bearer ${secret}x`),
      secret,
    ),
    false,
  );
  assert.equal(
    authorizeCaddyTlsAskRequest(
      request("?domain=academy.de", `Basic ${secret}`),
      secret,
    ),
    false,
  );
  assert.equal(
    authorizeCaddyTlsAskRequest(request("?domain=academy.de", null), secret),
    false,
  );
  assert.equal(authorizeCaddyTlsAskRequest(request("?domain=academy.de"), null), false);
});

test("Caddy TLS ask accepts only one strictly normalized public hostname", () => {
  assert.equal(
    caddyTlsAskHostname(request("?domain=ACADEMY.BUECHER.DE.")),
    "academy.buecher.de",
  );
  assert.equal(
    caddyTlsAskHostname(request("?domain=b%C3%BCcher.de")),
    "xn--bcher-kva.de",
  );
  for (const query of [
    "",
    "?domain=academy.de&domain=other.de",
    "?domain=academy.de&extra=1",
    "?domain=localhost",
    "?domain=academy.local",
    "?domain=academy.example",
    "?domain=https%3A%2F%2Facademy.de",
    "?domain=academy.de%3A443",
    "?domain=*.academy.de",
  ]) {
    assert.equal(caddyTlsAskHostname(request(query)), null, query);
  }
});
