import { expect, test } from "@playwright/test";

test("manifest and service worker expose a tenant-neutral secure PWA contract", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "PWA contract runs once");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()["content-type"]).toContain(
    "application/manifest+json",
  );
  await expect(manifestResponse.json()).resolves.toMatchObject({
    id: "/",
    name: "Q-Academy",
    short_name: "Q-Academy",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f9fb",
    theme_color: "#17324d",
    icons: [
      {
        src: "/pwa/q-academy-v1-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/pwa/q-academy-v1-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  });

  for (const icon of [
    "/pwa/q-academy-v1-192.svg",
    "/pwa/q-academy-v1-512.svg",
  ]) {
    const iconResponse = await request.get(icon);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");
  }

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBe(true);
  expect(workerResponse.headers()["cache-control"]).toContain("max-age=0");
  expect(workerResponse.headers()["service-worker-allowed"]).toBe("/");
  const worker = await workerResponse.text();

  expect(worker).toContain('credentials: "omit"');
  expect(worker).toContain('request.mode === "navigate"');
  expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
  expect(worker).toContain('response.headers.get("cache-control")');
  expect(worker).toContain("immutable");
  expect(worker).not.toContain('"/api/');
  expect(worker).not.toContain('"/login');
  expect(worker).not.toContain("Authorization");
  expect(worker).not.toContain("Cookie");
});

test("development does not register a service worker by default", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Registration check runs once");

  await page.addInitScript(() => {
    const registerCalls: string[] = [];
    Object.defineProperty(window, "__qAcademyServiceWorkerRegisterCalls", {
      configurable: false,
      value: registerCalls,
    });
    if (!("serviceWorker" in navigator)) return;

    const serviceWorker = navigator.serviceWorker;
    const register = serviceWorker.register.bind(serviceWorker);
    Object.defineProperty(serviceWorker, "register", {
      configurable: true,
      value: (scriptURL: string | URL, options?: RegistrationOptions) => {
        registerCalls.push(String(scriptURL));
        return register(scriptURL, options);
      },
    });
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[name="email"]')).toBeEnabled();
  const registerCalls = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __qAcademyServiceWorkerRegisterCalls?: string[];
        }
      ).__qAcademyServiceWorkerRegisterCalls ?? [],
  );
  expect(registerCalls).toEqual([]);
  const registrations = await page.evaluate(async () =>
    "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
  );
  expect(registrations).toBe(0);
});

test("neutral offline page fits a mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Offline layout is mobile-specific");

  await page.goto("/offline.html");
  await expect(page.getByRole("heading", { name: "Keine Verbindung" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Erneut versuchen" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByAltText("Q-Academy")).toBeVisible();

  const layout = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    iconWidth: document.querySelector("img")?.getBoundingClientRect().width ?? 0,
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.iconWidth).toBe(64);
  await page.screenshot({
    path: testInfo.outputPath("offline-mobile.png"),
    fullPage: true,
  });
});
