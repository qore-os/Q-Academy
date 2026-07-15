import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: [
    /cross-browser-core\.spec\.ts/,
    /production-artifact-smoke\.spec\.ts/,
  ],
  fullyParallel: false,
  // Integration tests share the seeded PostgreSQL database and operational queues.
  workers: 1,
  // A clean Next.js dev build compiles route groups on first use, especially on Windows CI.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/api/v1/health/ready",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
