import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_PRODUCTION_BASE_URL;

if (!baseURL) {
  throw new Error("PLAYWRIGHT_PRODUCTION_BASE_URL is required.");
}

const productionOrigin = new URL(baseURL);

if (productionOrigin.protocol !== "https:") {
  throw new Error("The production artifact smoke must run over HTTPS.");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: /production-artifact-smoke\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/production-artifact-smoke",
  reporter: "list",
  use: {
    baseURL: productionOrigin.origin,
    actionTimeout: 20_000,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "production-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            `--host-resolver-rules=MAP ${productionOrigin.hostname} 127.0.0.1`,
          ],
        },
      },
    },
  ],
});
