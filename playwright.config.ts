// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const e2eSidecarToken = process.env.BLACKWALL_E2E_SIDECAR_TOKEN ?? randomBytes(32).toString("hex");
// Playwright evaluates this config in the runner and in worker processes;
// persist the generated value so both sides authenticate the same sidecar.
process.env.BLACKWALL_E2E_SIDECAR_TOKEN = e2eSidecarToken;

export default defineConfig({
  // O sidecar E2E usa um único SQLite/diretório de dados compartilhado por
  // run (scripts/dev-web.mjs); testes paralelos criariam perfis/sessões
  // concorrentes no mesmo estado. Serializa tudo.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  testDir: "./e2e",
  reporter: process.env.BLACKWALL_E2E_CI ? [["list"], ["./scripts/no-skips-reporter.mjs"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:1421",
    extraHTTPHeaders: { authorization: `Bearer ${e2eSidecarToken}` },
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1421",
    env: {
      BLACKWALL_E2E: "1",
      BLACKWALL_E2E_AGENT: "1",
      BLACKWALL_E2E_MOCK: "1",
      BLACKWALL_SIDECAR_PORT: "1423",
      BLACKWALL_SIDECAR_TOKEN: e2eSidecarToken,
      VITE_SIDECAR_TOKEN: e2eSidecarToken,
      VITE_SIDECAR_URL: "http://127.0.0.1:1423",
    },
    port: 1421,
    reuseExistingServer: false,
  },
});
