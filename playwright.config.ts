// MIT License — Copyright (c) 2026 Mateus Gaio
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  testDir: "./e2e",
  reporter: process.env.BLACKWALL_E2E_CI ? [["list"], ["./scripts/no-skips-reporter.mjs"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "BLACKWALL_E2E=1 BLACKWALL_E2E_MOCK=1 BLACKWALL_SIDECAR_PORT=1422 npm run dev -- --host 127.0.0.1 --port 1421",
    env: {
      BLACKWALL_E2E: "1",
      BLACKWALL_E2E_MOCK: "1",
      BLACKWALL_SIDECAR_PORT: "1422",
    },
    port: 1421,
    reuseExistingServer: false,
  },
});
