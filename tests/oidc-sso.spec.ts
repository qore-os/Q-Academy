import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { compare, hash } from "bcryptjs";
import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
} from "@playwright/test";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import postgres from "postgres";
import { getPrivacyAdminCopy } from "@/lib/i18n/privacy-admin";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const password = "Demo123!";
const clientId = "q-academy-oidc-e2e";
const clientSecret = "oidc-e2e-client-secret-value";
const privacyCopy = getPrivacyAdminCopy("de");

type ProviderIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  givenName: string;
  familyName: string;
};

type AuthorizationCode = {
  clientId: string;
  challenge: string;
  nonce: string;
  redirectUri: string;
  identity: ProviderIdentity;
  freshAuthentication: boolean;
};

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("OIDC mock request exceeded limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function startOidcProvider(
  initialIdentity: ProviderIdentity,
  expectedRedirectUri: string,
) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    alg: "RS256",
    kid: "oidc-e2e-key",
    use: "sig",
  };
  const codes = new Map<string, AuthorizationCode>();
  let identity = initialIdentity;
  let issuer = "";
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", issuer || "http://127.0.0.1");
      if (
        request.method === "GET" &&
        url.pathname === "/oidc/.well-known/openid-configuration"
      ) {
        json(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          scopes_supported: ["openid", "email", "profile"],
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/oidc/jwks") {
        json(response, 200, { keys: [publicJwk] });
        return;
      }
      if (request.method === "GET" && url.pathname === "/oidc/authorize") {
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const challenge = url.searchParams.get("code_challenge") ?? "";
        if (
          url.searchParams.get("client_id") !== clientId ||
          url.searchParams.get("response_type") !== "code" ||
          url.searchParams.get("code_challenge_method") !== "S256" ||
          !url.searchParams.get("scope")?.split(" ").includes("openid") ||
          redirectUri !== expectedRedirectUri ||
          !state ||
          !nonce ||
          !challenge
        ) {
          response.writeHead(400).end("invalid authorization request");
          return;
        }
        const code = randomUUID();
        codes.set(code, {
          clientId,
          challenge,
          nonce,
          redirectUri,
          identity: { ...identity },
          freshAuthentication:
            url.searchParams.get("prompt") === "login" &&
            url.searchParams.get("max_age") === "0",
        });
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", state);
        response.writeHead(302, { location: callback.toString() }).end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/oidc/token") {
        const form = new URLSearchParams(await readRequestBody(request));
        const code = form.get("code") ?? "";
        const record = codes.get(code);
        const verifier = form.get("code_verifier") ?? "";
        const verifierChallenge = createHash("sha256")
          .update(verifier)
          .digest("base64url");
        if (
          !record ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== clientId ||
          form.get("client_secret") !== clientSecret ||
          form.get("redirect_uri") !== record.redirectUri ||
          verifierChallenge !== record.challenge
        ) {
          json(response, 400, { error: "invalid_grant" });
          return;
        }
        codes.delete(code);
        const idToken = await new SignJWT({
          email: record.identity.email,
          email_verified: record.identity.emailVerified,
          given_name: record.identity.givenName,
          family_name: record.identity.familyName,
          nonce: record.nonce,
          ...(record.freshAuthentication
            ? { auth_time: Math.floor(Date.now() / 1000) }
            : {}),
        })
          .setProtectedHeader({ alg: "RS256", kid: "oidc-e2e-key" })
          .setIssuer(issuer)
          .setAudience(record.clientId)
          .setSubject(record.identity.subject)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey as CryptoKey);
        json(response, 200, {
          access_token: randomUUID(),
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
        return;
      }
      response.writeHead(404).end("not found");
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end("provider error");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}/oidc`;
  return {
    issuer,
    setIdentity(next: ProviderIdentity) {
      identity = next;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function passwordLogin(page: Page, loginUrl: string, email: string) {
  await page.goto(loginUrl);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: /anmelden$/ }).click();
  await page.waitForURL("**/admin");
}

async function logout(page: Page, loginUrl: string) {
  const status = await page.evaluate(async () =>
    fetch("/api/v1/auth/logout", { method: "POST" }).then(
      (response) => response.status,
    ),
  );
  expect(status).toBe(200);
  await page.goto(loginUrl);
}

test.describe("tenant OpenID Connect", () => {
  test("validates, links and provisions through a fail-closed SSO flow", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/hydrated but some attributes|hydration failed/i.test(text)) {
        hydrationWarnings.push(`${page.url()}: ${text}`);
      }
    });
    const sql = postgres(databaseUrl, { max: 3, prepare: false });
    const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();
    const ownerEmail = `owner-${suffix}@oidc.example.test`;
    const memberEmail = `member-${suffix}@oidc.example.test`;
    const invitedEmail = `invited-${suffix}@oidc.example.test`;
    const rejectedEmail = `rejected-${suffix}@outside.example.test`;
    const organizationSlug = `oidc-${suffix}`;
    const appOrigin = `http://${organizationSlug}.localhost:3000`;
    const tenantApiOrigin = "http://127.0.0.1:3000";
    const tenantHost = `${organizationSlug}.localhost:3000`;
    const provider = await startOidcProvider({
      subject: `owner-${suffix}`,
      email: ownerEmail,
      emailVerified: true,
      givenName: "Olivia",
      familyName: "Owner",
    }, `${appOrigin}/api/v1/auth/oidc/callback`);
    const testStartedAt = new Date(Date.now() - 1_000);
    let organizationId = "";
    try {
      const passwordHash = await hash(password, 12);
      const [organization] = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`OIDC E2E ${suffix}`}, ${organizationSlug})
        returning id
      `;
      organizationId = organization.id;
      const [owner] = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${organizationId}, ${ownerEmail}, ${passwordHash}, 'Olivia', 'Owner',
          'owner', 'active'
        )
        returning id
      `;
      await sql`
        insert into platform_settings (organization_id, key, value)
        values (
          ${organizationId}, 'design',
          ${sql.json({ platformName: "OIDC Test Academy" })}
        )
      `;

      const loginUrl = `${appOrigin}/login`;
      await passwordLogin(page, loginUrl, ownerEmail);
      await page.goto(`${appOrigin}/admin/settings#sso`);
      const ssoForm = page.locator("form#sso");
      await ssoForm.getByLabel("Aktiv", { exact: true }).check();
      await ssoForm.getByLabel("Anzeigename").fill("Test Identity");
      await ssoForm.getByLabel("Client-ID").fill(clientId);
      await ssoForm.getByLabel("Issuer-URL").fill(provider.issuer);
      await ssoForm.getByLabel("Client-Secret").fill(clientSecret);
      await ssoForm
        .getByLabel("Erlaubte E-Mail-Domains")
        .fill("oidc.example.test");
      await ssoForm.getByLabel("Mitglieder automatisch anlegen").check();
      await ssoForm.getByLabel("Aktuelles Owner-Passwort").fill(password);

      await ssoForm.getByLabel("Passwort-Login aktiviert").uncheck();
      await ssoForm
        .getByRole("button", { name: "Verbindung pruefen & speichern" })
        .click();
      await expect(
        page.getByText(
          "Speichere zuerst die Provider-Aenderungen, teste den Owner-Login per SSO und schalte den Passwort-Login danach separat ab.",
        ),
      ).toBeVisible();
      await expect(ssoForm.getByLabel("Aktiv", { exact: true })).toBeChecked();
      await expect(
        ssoForm.getByLabel("Mitglieder automatisch anlegen"),
      ).toBeChecked();
      await expect(ssoForm.getByLabel("Client-Secret")).toHaveValue(clientSecret);
      expect(
        Number(
          (
            await sql<Array<{ count: number }>>`
              select count(*)::int as count
              from oidc_configurations
              where organization_id = ${organizationId}
            `
          )[0].count,
        ),
      ).toBe(0);

      await ssoForm.getByLabel("Passwort-Login aktiviert").check();
      await ssoForm
        .getByRole("button", { name: "Verbindung pruefen & speichern" })
        .click();
      await expect(
        page.getByText("Unternehmens-Login geprueft und gespeichert."),
      ).toBeVisible();
      const [storedConfiguration] = await sql<
        Array<{
          encrypted: unknown;
          version: number;
          passwordLoginEnabled: boolean;
        }>
      >`
        select client_secret_encrypted as encrypted, version,
               password_login_enabled as "passwordLoginEnabled"
        from oidc_configurations
        where organization_id = ${organizationId}
      `;
      expect(storedConfiguration.version).toBe(1);
      expect(storedConfiguration.passwordLoginEnabled).toBe(true);
      expect(JSON.stringify(storedConfiguration.encrypted)).not.toContain(
        clientSecret,
      );
      expect(await page.locator("body").innerText()).not.toContain(clientSecret);

      const rateClientA = await playwrightRequest.newContext({
        extraHTTPHeaders: { Host: tenantHost },
      });
      const rateClientB = await playwrightRequest.newContext({
        extraHTTPHeaders: { Host: tenantHost },
      });
      try {
        for (let attempt = 0; attempt < 9; attempt += 1) {
          const response = await rateClientA.get(
            `${tenantApiOrigin}/api/v1/auth/oidc/start`,
            { maxRedirects: 0 },
          );
          expect(response.status()).toBe(302);
          expect(response.headers().location).toContain(`${provider.issuer}/authorize`);
        }
        const independentResponse = await rateClientB.get(
          `${tenantApiOrigin}/api/v1/auth/oidc/start`,
          { maxRedirects: 0 },
        );
        expect(independentResponse.status()).toBe(302);
        expect(independentResponse.headers().location).toContain(
          `${provider.issuer}/authorize`,
        );
      } finally {
        await rateClientA.dispose();
        await rateClientB.dispose();
      }
      const rateBuckets = await sql<
        Array<{ action: string; attempts: number }>
      >`
        select action, attempts
        from auth_rate_limits
        where action in ('oidc_login', 'oidc_login_scope')
          and updated_at >= ${testStartedAt}
        order by action, attempts
      `;
      expect(
        rateBuckets
          .filter((bucket) => bucket.action === "oidc_login")
          .map((bucket) => bucket.attempts),
      ).toEqual([1, 9]);
      expect(
        rateBuckets
          .filter((bucket) => bucket.action === "oidc_login_scope")
          .map((bucket) => bucket.attempts),
      ).toEqual([10]);

      await logout(page, loginUrl);
      const publicHtml = await page.content();
      expect(publicHtml).not.toContain(provider.issuer);
      expect(publicHtml).not.toContain(clientId);
      expect(publicHtml).not.toContain("oidc.example.test");
      await page
        .getByRole("link", { name: /Test Identity anmelden$/ })
        .click();
      await page.waitForURL("**/login?oidc_error=account");
      const [prematureOwnerLinks] = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from oidc_identities
        where organization_id = ${organizationId}
          and user_id = ${owner.id}
      `;
      expect(prematureOwnerLinks.count).toBe(0);
      await passwordLogin(page, loginUrl, ownerEmail);
      await page.goto(`${appOrigin}/admin/settings#sso`);

      type LinkStartCapture = {
        body: Buffer;
        cacheControl: string | undefined;
        headers: Array<{ name: string; value: string }>;
        status: number;
      };
      let resolveLinkStartCapture:
        | ((capture: LinkStartCapture) => void)
        | undefined;
      let rejectLinkStartCapture: ((reason: unknown) => void) | undefined;
      const linkStartCapturePromise = new Promise<LinkStartCapture>(
        (resolve, reject) => {
          resolveLinkStartCapture = resolve;
          rejectLinkStartCapture = reject;
        },
      );
      await page.route(
        (url) => url.pathname === "/api/v1/auth/oidc/start",
        async (route) => {
          try {
            const request = route.request();
            const requestUrl = new URL(request.url());
            const upstreamUrl = new URL(requestUrl);
            upstreamUrl.hostname = "127.0.0.1";
            const response = await route.fetch({
              headers: {
                ...(await request.allHeaders()),
                host: requestUrl.host,
              },
              url: upstreamUrl.toString(),
            });
            const body = await response.body();
            const headers = await response.headersArray();
            const cacheControl = headers.find(
              (header) => header.name.toLowerCase() === "cache-control",
            )?.value;

            await route.fulfill({ body, response });
            resolveLinkStartCapture?.({
              body,
              cacheControl,
              headers,
              status: response.status(),
            });
          } catch (error) {
            rejectLinkStartCapture?.(error);
            await route.abort("failed");
          }
        },
        { times: 1 },
      );
      const linkCallbackResponsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/v1/auth/oidc/callback?"),
      );
      await page
        .getByRole("button", { name: "Mein Konto mit SSO verknuepfen" })
        .click();
      const [linkStartCapture, linkCallbackResponse] = await Promise.all([
        linkStartCapturePromise,
        linkCallbackResponsePromise,
      ]);
      expect(linkStartCapture.status).toBe(200);
      expect(linkStartCapture.cacheControl).toBe("no-store");
      const linkStartCookies = linkStartCapture.headers
        .filter((header) => header.name.toLowerCase() === "set-cookie")
        .map((header) => header.value);
      const transactionCookie = linkStartCookies.find((cookie) =>
        cookie.startsWith("q_academy_oidc_transaction="),
      );
      expect(transactionCookie).toBeDefined();
      expect(transactionCookie).toContain("; Path=/");
      expect(transactionCookie).toContain("; HttpOnly");
      expect(transactionCookie).toMatch(/; SameSite=Lax/i);
      expect(transactionCookie).toContain("; Max-Age=600");
      const linkStartPayload = JSON.parse(
        linkStartCapture.body.toString("utf8"),
      ) as {
        authorizationUrl?: string;
      };
      expect(linkStartPayload.authorizationUrl).toContain(
        `${provider.issuer}/authorize`,
      );
      expect(linkCallbackResponse.status()).toBe(307);
      expect(linkCallbackResponse.headers().location).toBe(
        `${appOrigin}/admin/settings`,
      );
      await page.waitForURL("**/admin/settings");
      const [linkedOwner] = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from oidc_identities
        where organization_id = ${organizationId}
          and user_id = ${owner.id}
          and issuer = ${provider.issuer}
          and last_configuration_version = 1
      `;
      expect(linkedOwner.count).toBe(1);
      const [freshOwnerSession] = await sql<
        Array<{
          authMethod: string;
          identityId: string | null;
          configurationVersion: number | null;
          authTime: Date | null;
          expiresAt: Date;
          activePasswordSessions: number;
        }>
      >`
        select s.auth_method as "authMethod",
               s.oidc_identity_id as "identityId",
               s.oidc_configuration_version as "configurationVersion",
               s.oidc_auth_time as "authTime",
               s.expires_at as "expiresAt",
               (select count(*)::int from user_sessions password_session
                where password_session.organization_id = ${organizationId}
                  and password_session.user_id = ${owner.id}
                  and password_session.auth_method = 'password'
                  and password_session.revoked_at is null) as "activePasswordSessions"
        from user_sessions s
        where s.organization_id = ${organizationId}
          and s.user_id = ${owner.id}
          and s.revoked_at is null
        order by s.created_at desc
        limit 1
      `;
      expect(freshOwnerSession.authMethod).toBe("oidc");
      expect(freshOwnerSession.identityId).toBeTruthy();
      expect(freshOwnerSession.configurationVersion).toBe(1);
      expect(freshOwnerSession.authTime).toBeInstanceOf(Date);
      expect(freshOwnerSession.activePasswordSessions).toBe(0);
      expect(freshOwnerSession.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
        12 * 60 * 60_000,
      );

      await logout(page, loginUrl);
      await page
        .getByRole("link", { name: /Test Identity anmelden$/ })
        .click();
      await page.waitForURL("**/admin");
      const [existingOwnerLink] = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from oidc_identities
        where organization_id = ${organizationId}
          and user_id = ${owner.id}
          and issuer = ${provider.issuer}
      `;
      expect(existingOwnerLink.count).toBe(1);
      const [regularOidcSession] = await sql<
        Array<{ authMethod: string; authTime: Date | null }>
      >`
        select auth_method as "authMethod", oidc_auth_time as "authTime"
        from user_sessions
        where organization_id = ${organizationId}
          and user_id = ${owner.id}
          and revoked_at is null
        order by created_at desc
        limit 1
      `;
      expect(regularOidcSession).toEqual({
        authMethod: "oidc",
        authTime: null,
      });

      await page.goto(`${appOrigin}/admin/settings#sso`);
      await ssoForm.getByLabel("Aktuelles Owner-Passwort").fill(password);
      await ssoForm.getByLabel("Passwort-Login aktiviert").uncheck();
      await ssoForm
        .getByRole("button", { name: "Verbindung pruefen & speichern" })
        .click();
      await expect(
        page.getByText("Unternehmens-Login geprueft und gespeichert."),
      ).toBeVisible();
      await page.goto(`${appOrigin}/admin/api`);
      await page
        .getByRole("button", { name: "API-Schluessel", exact: true })
        .click();
      const apiKeyDialog = page.getByRole("dialog", {
        name: "API-Schluessel erstellen",
      });
      await apiKeyDialog.getByLabel("Name").fill(`OIDC owner ${suffix}`);
      await apiKeyDialog
        .locator('input[name="scopes"][value="authentication:read"]')
        .check();
      await expect(apiKeyDialog.getByLabel("Aktuelles Passwort")).toHaveCount(0);
      const apiReturnResponsePromise = page.waitForResponse(
        (response) =>
          response.request().resourceType() === "document" &&
          response.url() === `${appOrigin}/admin/api` &&
          response.status() === 200,
      );
      await apiKeyDialog
        .getByRole("button", { name: "Owner per SSO bestaetigen" })
        .click();
      await apiReturnResponsePromise;
      await expect(apiKeyDialog).toHaveCount(0);
      await expect(async () => {
        if (!(await apiKeyDialog.isVisible())) {
          await page
            .getByRole("button", { name: "API-Schluessel", exact: true })
            .click({ timeout: 1_500 });
        }
        await expect(apiKeyDialog).toBeVisible({ timeout: 1_500 });
      }).toPass({ intervals: [250, 500], timeout: 10_000 });
      await apiKeyDialog.getByLabel("Name").fill(`OIDC owner ${suffix}`);
      await apiKeyDialog
        .locator('input[name="scopes"][value="authentication:read"]')
        .check();
      await apiKeyDialog
        .getByRole("button", { name: "Schluessel erstellen" })
        .click();
      await expect(
        apiKeyDialog.getByText("Nur einmal sichtbar", { exact: true }),
      ).toBeVisible();
      const [ownerBoundApiKey] = await sql<
        Array<{ scopes: string[]; createdById: string }>
      >`
        select scopes, created_by_id as "createdById"
        from api_keys
        where organization_id = ${organizationId}
          and name = ${`OIDC owner ${suffix}`}
        limit 1
      `;
      expect(ownerBoundApiKey).toEqual({
        scopes: ["authentication:read"],
        createdById: owner.id,
      });

      const privacyRequestId = randomUUID();
      const privacyClientRequestId = `OIDC-DSAR-${suffix}`;
      await sql`
        insert into privacy_requests (
          id, organization_id, subject_user_id, subject_reference,
          requested_by_id, client_request_id, type, status, due_at,
          policy_version, policy_snapshot
        ) values (
          ${privacyRequestId}, ${organizationId}, ${owner.id},
          ${"d".repeat(64)}, ${owner.id}, ${privacyClientRequestId},
          'access_export', 'received', now() + interval '30 days',
          'privacy-dsar-v1', ${sql.json({ fixture: "oidc-owner-step-up" })}
        )
      `;
      await sql`
        update user_sessions
        set authenticated_at = now() - interval '10 minutes',
            oidc_auth_time = now() - interval '10 minutes'
        where organization_id = ${organizationId}
          and user_id = ${owner.id}
          and auth_method = 'oidc'
          and revoked_at is null
      `;
      await page.goto(
        `${appOrigin}/admin/privacy/${privacyRequestId}`,
      );
      await page
        .getByRole("button", { name: privacyCopy.actions.verify, exact: true })
        .click();
      let privacyDialog = page.getByRole("dialog");
      await expect(
        privacyDialog.getByLabel("Aktuelles Owner-Passwort"),
      ).toHaveCount(0);
      await privacyDialog
        .getByRole("button", { name: privacyCopy.actions.verify, exact: true })
        .click();
      await expect(privacyDialog.getByRole("status")).toContainText(
        privacyCopy.messages.stepUpReauthenticationRequired,
      );
      const privacyReturnUrl = `${appOrigin}/admin/privacy/${privacyRequestId}`;
      const privacyReturnResponsePromise = page.waitForResponse(
        (response) =>
          response.request().resourceType() === "document" &&
          response.url() === privacyReturnUrl &&
          response.status() === 200,
      );
      await privacyDialog
        .getByRole("button", { name: privacyCopy.stepUp.oidcButton })
        .click();
      await privacyReturnResponsePromise;
      await expect(privacyDialog).toHaveCount(0);
      privacyDialog = page.getByRole("dialog");
      await expect(async () => {
        if (!(await privacyDialog.isVisible())) {
          await page
            .getByRole("button", {
              name: privacyCopy.actions.verify,
              exact: true,
            })
            .click({ timeout: 1_500 });
        }
        await expect(privacyDialog).toBeVisible({ timeout: 1_500 });
      }).toPass({ intervals: [250, 500], timeout: 10_000 });
      await privacyDialog
        .getByRole("button", { name: privacyCopy.actions.verify, exact: true })
        .click();
      await expect(
        page
          .getByText(privacyCopy.statuses.identity_verified, { exact: true })
          .first(),
      ).toBeVisible();
      await logout(page, loginUrl);
      await expect(page.getByLabel("E-Mail-Adresse")).toHaveCount(0);
      await expect(page.getByLabel("Passwort", { exact: true })).toHaveCount(0);

      const passwordResponse = await request.post(
        `${tenantApiOrigin}/api/v1/auth/login`,
        {
          headers: { Host: tenantHost },
          data: { email: ownerEmail, password },
        },
      );
      expect(passwordResponse.status()).toBe(401);
      const [deliveriesBefore] = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from email_deliveries
        where organization_id = ${organizationId}
      `;
      const forgotResponse = await request.post(
        `${tenantApiOrigin}/api/v1/password/forgot`,
        {
          headers: { Host: tenantHost },
          data: { email: ownerEmail },
        },
      );
      expect(forgotResponse.status()).toBe(202);
      const forgotPayload = (await forgotResponse.json()) as {
        data?: { developmentToken?: string };
      };
      expect(forgotPayload.data?.developmentToken).toBeUndefined();
      const [deliveriesAfter] = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from email_deliveries
        where organization_id = ${organizationId}
      `;
      expect(deliveriesAfter.count).toBe(deliveriesBefore.count);

      const invitationToken = `invite_${randomUUID()}`;
      const invitedPasswordHash = await hash(randomUUID(), 12);
      const [invitedMember] = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${organizationId}, ${invitedEmail}, ${invitedPasswordHash},
          'Ida', 'Invited', 'member', 'invited'
        )
        returning id
      `;
      await sql`
        insert into invitations (
          organization_id, user_id, email, token_hash, expires_at
        ) values (
          ${organizationId}, ${invitedMember.id}, ${invitedEmail},
          ${createHash("sha256").update(invitationToken).digest("hex")},
          now() + interval '1 day'
        )
      `;
      provider.setIdentity({
        subject: `invited-${suffix}`,
        email: invitedEmail,
        emailVerified: true,
        givenName: "Ida",
        familyName: "Invited",
      });
      await page.goto(
        `${appOrigin}/invitations/${encodeURIComponent(invitationToken)}`,
      );
      await expect(page.getByLabel("Neues Passwort")).toHaveCount(0);
      await page
        .getByRole("link", { name: /Test Identity aktivieren$/ })
        .click();
      await page.waitForURL("**/academy");
      const [activatedInvitation] = await sql<
        Array<{
          status: string;
          accepted: boolean;
          identityCount: number;
        }>
      >`
        select u.status,
               (i.accepted_at is not null) as accepted,
               (select count(*)::int from oidc_identities oi
                where oi.organization_id = ${organizationId}
                  and oi.user_id = u.id) as "identityCount"
        from users u
        join invitations i
          on i.organization_id = u.organization_id and i.user_id = u.id
        where u.id = ${invitedMember.id}
        limit 1
      `;
      expect(activatedInvitation).toEqual({
        status: "active",
        accepted: true,
        identityCount: 1,
      });
      await page.goto(`${appOrigin}/academy/profile`);
      await expect(
        page.getByRole("heading", { name: "Unternehmens-Login" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Passwort" })).toHaveCount(
        0,
      );
      await expect(page.getByLabel("Aktuelles Passwort")).toHaveCount(0);
      await expect(
        page.getByRole("definition").filter({ hasText: invitedEmail }),
      ).toBeVisible();
      await expect(
        page.getByText("Mit SSO angemeldet", { exact: true }),
      ).toBeVisible();
      await logout(page, loginUrl);

      provider.setIdentity({
        subject: `member-${suffix}`,
        email: memberEmail,
        emailVerified: true,
        givenName: "Mara",
        familyName: "Member",
      });
      await page
        .getByRole("link", { name: /Test Identity anmelden$/ })
        .click();
      await page.waitForURL("**/academy");
      const [provisionedMember] = await sql<
        Array<{ id: string; role: string; passwordHash: string }>
      >`
        select id, role, password_hash as "passwordHash"
        from users
        where organization_id = ${organizationId} and email = ${memberEmail}
      `;
      expect(provisionedMember.role).toBe("member");
      await expect(compare(password, provisionedMember.passwordHash)).resolves.toBe(
        false,
      );

      await logout(page, loginUrl);
      provider.setIdentity({
        subject: `rejected-${suffix}`,
        email: rejectedEmail,
        emailVerified: true,
        givenName: "Rejected",
        familyName: "Domain",
      });
      await page
        .getByRole("link", { name: /Test Identity anmelden$/ })
        .click();
      await page.waitForURL("**/login?oidc_error=account");
      await expect(
        page.getByText(
          "Fuer diesen Unternehmens-Login ist kein aktives Konto verfuegbar.",
        ),
      ).toBeVisible();
      const [rejectedUsers] = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from users
        where organization_id = ${organizationId} and email = ${rejectedEmail}
      `;
      expect(rejectedUsers.count).toBe(0);

      provider.setIdentity({
        subject: `owner-${suffix}`,
        email: ownerEmail,
        emailVerified: true,
        givenName: "Olivia",
        familyName: "Owner",
      });
      let successfulCallback = "";
      page.on("request", (browserRequest) => {
        if (browserRequest.url().includes("/api/v1/auth/oidc/callback?")) {
          successfulCallback = browserRequest.url();
        }
      });
      await page
        .getByRole("link", { name: /Test Identity anmelden$/ })
        .click();
      await page.waitForURL("**/admin");
      expect(successfulCallback).toContain("code=");
      await logout(page, loginUrl);
      await page.goto(successfulCallback);
      await page.waitForURL("**/login?oidc_error=expired");
      await expect(
        page.getByText(
          "Die Anmeldeanfrage ist abgelaufen. Bitte starte sie erneut.",
        ),
      ).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`oidc-login-${testInfo.project.name}.png`),
        fullPage: true,
      });
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await sql`
        delete from auth_rate_limits
        where action in ('oidc_login', 'oidc_login_scope', 'oidc_login_ip')
          and updated_at >= ${testStartedAt}
      `;
      if (organizationId) {
        await sql.begin(async (tx) => {
          await tx.unsafe("set local session_replication_role = replica");
          await tx`
            delete from privacy_request_events
            where organization_id = ${organizationId}
          `;
          await tx.unsafe("set local session_replication_role = origin");
          await tx`delete from organizations where id = ${organizationId}`;
        });
      }
      await sql.end();
      await provider.close();
    }
  });
});
