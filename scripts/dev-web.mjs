// MIT License — Copyright (c) 2026 Mateus Gaio
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSidecar, SIDECAR_HOST } from "../sidecar/dist/index.js";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const viteArguments = process.argv.slice(2);
const ownsDataDirectory = process.env.BLACKWALL_E2E === "1";
const dataDirectory = ownsDataDirectory
  ? await mkdtemp(join(tmpdir(), "blackwall-e2e-"))
  : process.env.BLACKWALL_DATA_DIR;
if (dataDirectory) process.env.BLACKWALL_DATA_DIR = dataDirectory;
// Development has one shared, deterministic sidecar. Both the browser at
// localhost:1420 and Tauri dev use it, avoiding concurrent SQLite writers.
const sidecarPort = Number(process.env.BLACKWALL_SIDECAR_PORT ?? 1422);
let sidecar;
try {
  sidecar = await createSidecar(sidecarPort);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("EADDRINUSE") || message.includes("address already in use")) {
    throw new Error(
      `A porta ${sidecarPort} já está em uso. Feche outra instância do Blackwall ou use BLACKWALL_SIDECAR_PORT com uma porta livre.`,
    );
  }
  throw error;
}
const { port, server } = sidecar;
const sidecarUrl = `http://${SIDECAR_HOST}:${port}`;

async function waitForHealth(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "erro desconhecido";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        const payload = await response.json();
        if (payload.status === "ready") return;
        lastError = `status inesperado: ${payload.status ?? "desconhecido"}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`O sidecar não ficou saudável em ${timeoutMs} ms (${lastError}).`);
}

try {
  await waitForHealth(sidecarUrl);
} catch (error) {
  await new Promise((resolve) => server.close(resolve));
  if (ownsDataDirectory) await rm(dataDirectory, { force: true, recursive: true });
  throw error;
}
console.info(`Blackwall sidecar de desenvolvimento disponível em ${sidecarUrl}`);

const vite = spawn(npmCommand, ["exec", "vite", "--", ...viteArguments], {
  cwd: projectDirectory,
  env: { ...process.env, VITE_SIDECAR_URL: sidecarUrl },
  stdio: "inherit",
});

let isStopping = false;

function stop(exitCode = 0) {
  if (isStopping) return;
  isStopping = true;
  vite.kill();
  server.close(() => {
    const cleanup = ownsDataDirectory
      ? rm(dataDirectory, { force: true, recursive: true })
      : Promise.resolve();
    void cleanup.finally(() => process.exit(exitCode));
  });
}

vite.once("exit", (code) => stop(code ?? 1));
vite.once("error", () => stop(1));
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
