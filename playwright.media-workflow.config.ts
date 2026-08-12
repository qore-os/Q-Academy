import { defineConfig } from "@playwright/test";

import baseConfig from "./playwright.config";

const baseUrl = "http://127.0.0.1:3107";

export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: baseUrl,
  },
  webServer: {
    command: "npx next dev -p 3107",
    url: `${baseUrl}/api/v1/health/ready`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
