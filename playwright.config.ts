// MIT License — Copyright (c) 2026 Mateus Gaio
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "BLACKWALL_DATA_DIR=.playwright-data BLACKWALL_E2E_MOCK=1 npm run dev -- --host 127.0.0.1 --port 1421",
    env: { BLACKWALL_DATA_DIR: ".playwright-data", BLACKWALL_E2E_MOCK: "1" },
    port: 1421,
    reuseExistingServer: false,
  },
});
