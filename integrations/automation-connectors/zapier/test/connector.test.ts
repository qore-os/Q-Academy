import { afterEach, describe, expect, it } from "vitest";
import nock from "nock";
import zapier from "zapier-platform-core";
import App from "../src/index.js";
import { idempotencyKey, normalizeBaseUrl } from "../src/api.js";
import { listBundles } from "../src/choices/list-bundles.js";

const appTester = zapier.createAppTester(App);
const baseUrl = "https://academy.example.test";
const authData = { baseUrl, apiKey: "connector-test-token" };
const validConnectorStatus = {
  connected: true,
  contractVersion: "1.0.0",
  apiVersion: "v1",
  organizationId: "33333333-3333-4333-8333-333333333333",
  apiKeyName: "Zapier",
  requiredScopes: ["automations:write", "bundles:read"],
  capabilities: { memberUpsert: true, bundleSelection: true },
} as const;

function authenticationTest() {
  const authentication = App.authentication;
  if (!authentication || typeof authentication.test !== "function") {
    throw new Error("Zapier custom authentication test is not callable.");
  }
  return authentication.test;
}

afterEach(() => {
  expect(nock.isDone()).toBe(true);
  nock.cleanAll();
});

describe("custom authentication", () => {
  it("checks both connector scopes without mutating data", async () => {
    nock(baseUrl, { reqheaders: { authorization: `Bearer ${authData.apiKey}` } })
      .get("/api/v1/automation/connector-status")
      .reply(200, {
        data: validConnectorStatus,
      });

    const result = await appTester(authenticationTest(), { authData });
    expect(result).toMatchObject({ connected: true, server: "academy.example.test" });
  });

  it("rejects semantically incompatible HTTP 200 status responses", async () => {
    const incompatibleStatuses = [
      { ...validConnectorStatus, connected: false },
      { ...validConnectorStatus, contractVersion: "1.1.0" },
      { ...validConnectorStatus, requiredScopes: ["bundles:read"] },
      {
        ...validConnectorStatus,
        capabilities: { memberUpsert: false, bundleSelection: true },
      },
      { ...validConnectorStatus, unexpected: "not-in-contract" },
    ];

    for (const status of incompatibleStatuses) {
      nock(baseUrl, { reqheaders: { authorization: `Bearer ${authData.apiKey}` } })
        .get("/api/v1/automation/connector-status")
        .reply(200, { data: status });

      await expect(
        appTester(authenticationTest(), { authData }),
      ).rejects.toThrow(/required 1\.0\.0 contract/);
    }
  });

  it("rejects non-origin and insecure Academy URLs before I/O", () => {
    expect(() => normalizeBaseUrl("http://academy.example.test")).toThrow(/HTTPS origin/);
    expect(() => normalizeBaseUrl("https://academy.example.test/path")).toThrow(/HTTPS origin/);
    expect(() => normalizeBaseUrl("https://user:pass@academy.example.test")).toThrow(/HTTPS origin/);
  });
});

describe("bundle choices", () => {
  it("maps active bundles and the API cursor to Zapier's choice envelope", async () => {
    nock(baseUrl, { reqheaders: { authorization: `Bearer ${authData.apiKey}` } })
      .get("/api/v1/bundles")
      .query({ active: "true", limit: "100", sort: "name:asc" })
      .reply(200, {
        data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Onboarding" }],
        meta: { pagination: { nextCursor: "next-page" } },
      });

    const result = await appTester(listBundles, { authData });
    expect(result).toEqual({
      results: [{ id: "11111111-1111-4111-8111-111111111111", label: "Onboarding" }],
      paging_token: "next-page",
    });
  });

  it("passes Zapier's paging token back as the opaque API cursor", async () => {
    nock(baseUrl, { reqheaders: { authorization: `Bearer ${authData.apiKey}` } })
      .get("/api/v1/bundles")
      .query({
        active: "true",
        limit: "100",
        sort: "name:asc",
        cursor: "next-page",
      })
      .reply(200, {
        data: [{ id: "22222222-2222-4222-8222-222222222222", name: "Leadership" }],
        meta: { pagination: { nextCursor: null } },
      });

    const result = await appTester(listBundles, {
      authData,
      meta: { paging_token: "next-page" },
    });
    expect(result).toEqual({
      results: [{ id: "22222222-2222-4222-8222-222222222222", label: "Leadership" }],
      paging_token: null,
    });
  });
});

describe("member actions", () => {
  it("requires a stable caller-supplied idempotency key", () => {
    expect(() => idempotencyKey(undefined)).toThrow(/stable idempotency key/);
    expect(() => idempotencyKey("short")).toThrow(/stable idempotency key/);
    expect(idempotencyKey("member-grant-0001")).toBe("member-grant-0001");
  });

  it("creates or updates a member and grants bundle access", async () => {
    const bundleId = "11111111-1111-4111-8111-111111111111";
    const response = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "member@example.com",
      status: "invited",
      created: true,
      bundleId,
      bundleAction: "grant",
      bundleAccessChanged: true,
    };
    nock(baseUrl, {
      reqheaders: {
        authorization: `Bearer ${authData.apiKey}`,
        "idempotency-key": "grant-request-0001",
      },
    })
      .post("/api/v1/automation/members/upsert", {
        email: "member@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        bundleId,
        bundleAction: "grant",
        sendInvitation: true,
      })
      .reply(201, { data: response });

    const perform = App.creates.upsert_member.operation.perform;
    if (typeof perform !== "function") throw new Error("Upsert perform is not callable.");
    const result = await appTester(perform, {
      authData,
      inputData: {
        email: "member@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        bundleId,
        sendInvitation: true,
        idempotencyKey: "grant-request-0001",
      },
    });
    expect(result).toEqual(response);
  });

  it("revokes only automation-sourced bundle access", async () => {
    const bundleId = "11111111-1111-4111-8111-111111111111";
    const response = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "member@example.com",
      status: "active",
      created: false,
      bundleId,
      bundleAction: "revoke",
      bundleAccessChanged: true,
    };
    nock(baseUrl, {
      reqheaders: {
        authorization: `Bearer ${authData.apiKey}`,
        "idempotency-key": "revoke-request-0001",
      },
    })
      .post("/api/v1/automation/members/upsert", {
        email: "member@example.com",
        bundleId,
        bundleAction: "revoke",
        sendInvitation: false,
      })
      .reply(200, { data: response });

    const perform = App.creates.revoke_bundle_access.operation.perform;
    if (typeof perform !== "function") throw new Error("Revoke perform is not callable.");
    const result = await appTester(perform, {
      authData,
      inputData: {
        email: "member@example.com",
        bundleId,
        idempotencyKey: "revoke-request-0001",
      },
    });
    expect(result).toEqual(response);
  });
});
