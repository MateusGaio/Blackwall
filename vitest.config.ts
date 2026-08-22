// MIT License — Copyright (c) 2026 Mateus Gaio
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", "desktop-runtime/**", "src-tauri/**"],
    coverage: {
      all: true,
      include: ["src/app/onboarding.ts", "sidecar/src/**/*.ts"],
      exclude: ["sidecar/src/index.ts", "sidecar/src/chat.ts", "sidecar/src/tools.ts"],
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
  },
});
