// MIT License — Copyright (c) 2026 Mateus Gaio
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "sidecar/src/db/generated",
  schema: "./sidecar/src/db/schema.ts",
});
