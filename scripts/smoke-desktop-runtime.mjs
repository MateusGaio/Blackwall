// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const runtimeDirectory = resolve(
  projectDirectory,
  process.env.BLACKWALL_DESKTOP_RUNTIME_DIR ?? "desktop-runtime",
);
const runtimeNode = join(runtimeDirectory, process.platform === "win32" ? "node.exe" : "node");
const sidecarScript = join(runtimeDirectory, "launch.js");

if (!existsSync(runtimeNode) || !existsSync(sidecarScript)) {
  throw new Error("Runtime desktop ausente. Execute npm run prepare:desktop-runtime primeiro.");
}

const storageDirectory = await mkdtemp(join(tmpdir(), "blackwall-runtime-smoke-"));
const port = 39000 + Math.floor(Math.random() * 1000);
const child = spawn(runtimeNode, [sidecarScript], {
  env: {
    BLACKWALL_DATA_DIR: storageDirectory,
    BLACKWALL_SIDECAR_PORT: String(port),
    PATH: process.platform === "win32" ? "" : "/nonexistent",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The sidecar may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Sidecar não respondeu ao health check.\n${output}`);
}

try {
  await waitForHealth();
  console.info("Smoke check do runtime desktop passou sem depender de Node no PATH.");
} finally {
  child.kill();
  await rm(storageDirectory, { recursive: true, force: true });
}
