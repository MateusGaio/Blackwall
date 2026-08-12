// MIT License — Copyright (c) 2026 Mateus Gaio
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSidecar, SIDECAR_HOST } from "../sidecar/dist/index.js";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const viteArguments = process.argv.slice(2);
const { port, server } = await createSidecar();
const sidecarUrl = `http://${SIDECAR_HOST}:${port}`;

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
  server.close(() => process.exit(exitCode));
}

vite.once("exit", (code) => stop(code ?? 1));
vite.once("error", () => stop(1));
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
