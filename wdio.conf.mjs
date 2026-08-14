// MIT License — Copyright (c) 2026 Mateus Gaio
import { resolve } from "node:path";

export const config = {
  capabilities: [
    {
      "tauri:options": {
        application: resolve("src-tauri/target/release/blackwall"),
        args: [`--blackwall-data-dir=${process.env.BLACKWALL_DATA_DIR}`, "--blackwall-e2e-agent"],
      },
    },
  ],
  connectionRetryCount: 1,
  connectionRetryTimeout: 120_000,
  framework: "mocha",
  hostname: "127.0.0.1",
  logLevel: "warn",
  maxInstances: 1,
  mochaOpts: { timeout: 120_000 },
  port: 4444,
  specs: ["./e2e-desktop/**/*.spec.mjs"],
  waitforTimeout: 15_000,
};
