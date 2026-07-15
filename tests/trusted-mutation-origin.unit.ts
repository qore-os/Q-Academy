import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedMutationOrigin } from "../src/lib/trusted-mutation-origin";

function trusted(request: Request, trustProxyHeaders = false) {
  return isTrustedMutationOrigin({
    request,
    trustProxyHeaders,
  });
}

test("tenant mutations accept only the exact request host and protocol", () => {
  assert.equal(
    trusted(
      new Request("http://127.0.0.1:3000/api/v1/auth/logout", {
        headers: {
          Host: "tenant.localhost:3000",
          Origin: "http://tenant.localhost:3000",
        },
      }),
    ),
    true,
  );
  assert.equal(
    trusted(
      new Request("http://127.0.0.1:3000/api/v1/auth/logout", {
        headers: {
          Host: "tenant.localhost:3000",
          Origin: "http://attacker.localhost:3000",
        },
      }),
    ),
    false,
  );
  assert.equal(
    trusted(
      new Request("http://127.0.0.1:3000/api/v1/auth/logout", {
        headers: {
          Host: "tenant.localhost:3000",
          Origin: "https://tenant.localhost:3000",
        },
      }),
    ),
    false,
  );
});

test("tenant mutations reject a public app origin and malformed origins", () => {
  const request = (origin: string) =>
    new Request("https://internal/api/v1/auth/logout", {
      headers: {
        Host: "academy.customer.example",
        Origin: origin,
      },
    });

  assert.equal(trusted(request("https://learn.example.com")), false);
  assert.equal(trusted(request("https://user:secret@academy.customer.example")), false);
  assert.equal(trusted(request("https://academy.customer.example/path")), false);
  assert.equal(trusted(request("https://academy.customer.example?query=1")), false);
  assert.equal(trusted(request("https://academy.customer.example#fragment")), false);
});

test("tenant mutations normalize default ports and retain non-default ports", () => {
  assert.equal(
    trusted(
      new Request("https://internal/api/v1/auth/logout", {
        headers: {
          Host: "academy.customer.example:443",
          Origin: "https://academy.customer.example",
        },
      }),
    ),
    true,
  );
  assert.equal(
    trusted(
      new Request("https://internal/api/v1/auth/logout", {
        headers: {
          Host: "academy.customer.example:8443",
          Origin: "https://academy.customer.example:8443",
        },
      }),
    ),
    true,
  );
  assert.equal(
    trusted(
      new Request("https://internal/api/v1/auth/logout", {
        headers: {
          Host: "academy.customer.example:8443",
          Origin: "https://academy.customer.example",
        },
      }),
    ),
    false,
  );
});

test("missing Origin remains compatible except for explicit cross-site browser requests", () => {
  assert.equal(
    trusted(
      new Request("https://internal/api/v1/auth/logout", {
        headers: { Host: "academy.customer.example" },
      }),
    ),
    true,
  );
  assert.equal(
    trusted(
      new Request("https://internal/api/v1/auth/logout", {
        headers: {
          Host: "academy.customer.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
    ),
    false,
  );
  assert.equal(
    trusted(
      new Request("https://internal/api/v1/auth/logout", {
        headers: {
          Host: "academy.customer.example",
          "Sec-Fetch-Site": "same-origin",
        },
      }),
    ),
    true,
  );
});

test("trusted proxy origins bind forwarded host and protocol", () => {
  const request = new Request("http://127.0.0.1:3000/api/v1/auth/logout", {
    headers: {
      Host: "internal:3000",
      Origin: "https://academy.customer.example",
      "X-Forwarded-Host": "academy.customer.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(trusted(request, true), true);
  assert.equal(trusted(request, false), false);

  const spoofed = new Request("http://127.0.0.1:3000/api/v1/auth/logout", {
    headers: {
      Host: "internal:3000",
      Origin: "https://attacker.example",
      "X-Forwarded-Host": "academy.customer.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(trusted(spoofed, true), false);
});
