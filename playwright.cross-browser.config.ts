import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /cross-browser-core\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    actionTimeout: 20_000,
    trace: {
      mode: "retain-on-failure",
      screenshots: false,
    },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/api/v1/health/ready",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
