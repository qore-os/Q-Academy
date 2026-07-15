import { expect, test, type Page } from "@playwright/test";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const expectedRelease = requiredEnvironment("PLAYWRIGHT_EXPECTED_RELEASE");
const adminEmail = requiredEnvironment("PLAYWRIGHT_ADMIN_EMAIL");
const memberEmail = requiredEnvironment("PLAYWRIGHT_MEMBER_EMAIL");
const password = requiredEnvironment("PLAYWRIGHT_SEED_PASSWORD");
const apiKey = requiredEnvironment("PLAYWRIGHT_API_KEY");

async function passwordLogin(
  page: Page,
  email: string,
  expectedPath: "/admin" | "/academy",
) {
  const loginResponse = await page.goto("/login", {
    waitUntil: "domcontentloaded",
  });
  expect(loginResponse?.status()).toBeLessThan(400);

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const loginForm = page
    .locator('input[name="password"]')
    .locator("xpath=ancestor::form");
  await Promise.all([
    page.waitForURL(`**${expectedPath}`),
    loginForm.locator('button[type="submit"]').click(),
  ]);

  await expect(page).toHaveURL(new RegExp(`${expectedPath}/?$`));
  await expect(page.getByRole("main")).toBeVisible();
}

test("production login renders without development-only access", async ({
  page,
}) => {
  const response = await page.goto("/login", { waitUntil: "networkidle" });
  expect(response?.status()).toBeLessThan(400);
  expect(response?.headers()["x-powered-by"]).toBeUndefined();

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeEnabled();
  await expect(page.locator('input[name="email"]')).toHaveValue("");
  await expect(page.locator('input[name="password"]')).toBeEnabled();
  await expect(page.locator('input[name="password"]')).toHaveValue("");
  await expect(page.getByRole("button", { name: /testen|demo/i })).toHaveCount(0);
});

test("unauthenticated root redirect has only the bounded destination body", async ({
  request,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/login");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe(
    "private, no-store, max-age=0, must-revalidate",
  );
  expect(
    (response.headers().vary ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase()),
  ).toContain("cookie");
  expect(response.headers()["set-cookie"] ?? "").not.toContain(
    "q_academy_session",
  );

  // Next.js serializes Proxy redirects with the relative destination as the
  // response body. Pin it exactly so no rendered page or sensitive content can
  // reappear and trigger ZAP's big-redirect disclosure rule.
  expect(await response.text()).toBe("/login");
});

test("seed owner can sign in with a real password and render admin", async ({
  page,
}) => {
  await passwordLogin(page, adminEmail, "/admin");
});

test("seed member can sign in with a real password and render academy", async ({
  page,
}) => {
  await passwordLogin(page, memberEmail, "/academy");
});

test("login Server Action rejects a foreign Origin before creating a session", async ({
  context,
  page,
}) => {
  const response = await page.goto("/login", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);

  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(password);
  const loginForm = page
    .locator('input[name="password"]')
    .locator("xpath=ancestor::form");
  await expect(loginForm.locator('button[type="submit"]')).toBeEnabled();

  let interceptedActionRequests = 0;
  await page.route("**/login", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    interceptedActionRequests += 1;
    // Chromium recalculates protected request headers after route.continue().
    // route.fetch() performs the replay with the explicit foreign Origin, and
    // fulfilling the intercepted browser request preserves the real response.
    const forwardedResponse = await route.fetch({
      maxRedirects: 0,
      headers: {
        ...request.headers(),
        origin: "https://foreign-origin.example",
        "sec-fetch-site": "cross-site",
      },
    });
    await route.fulfill({ response: forwardedResponse });
  });

  const actionResponsePromise = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/login",
  );
  await loginForm.locator('button[type="submit"]').click();
  const actionResponse = await actionResponsePromise;

  expect(interceptedActionRequests).toBe(1);
  expect(actionResponse.status()).toBe(500);
  expect(actionResponse.headers()["set-cookie"] ?? "").not.toContain(
    "q_academy_session",
  );
  expect(
    (await context.cookies()).some((cookie) =>
      cookie.name.endsWith("q_academy_session"),
    ),
  ).toBe(false);
});

test("ready health exposes the exact release version", async ({ request }) => {
  const response = await request.get("/api/v1/health/ready");
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    data?: { status?: string; schema?: string; version?: string };
  };
  expect(body.data).toMatchObject({
    status: "ready",
    schema: "current",
    version: expectedRelease,
  });
});

test("public API rejects anonymous access and accepts the seeded API key", async ({
  request,
}) => {
  const anonymous = await request.get("/api/v1/courses?limit=1");
  expect(anonymous.status()).toBe(401);

  const authenticated = await request.get("/api/v1/courses?limit=1", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(authenticated.status()).toBe(200);

  const body = (await authenticated.json()) as { data?: unknown };
  expect(Array.isArray(body.data)).toBe(true);
});
