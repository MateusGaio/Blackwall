// MIT License — Copyright (c) 2026 Mateus Gaio
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const frontendUrl = process.env.BLACKWALL_DEV_URL ?? "http://127.0.0.1:1420";
const sidecarUrl = process.env.BLACKWALL_SIDECAR_URL ?? "http://127.0.0.1:1422";
const suppliedSidecarToken = process.env.BLACKWALL_SIDECAR_TOKEN;
const sidecarToken = suppliedSidecarToken ?? randomBytes(32).toString("hex");
const reuseConfig = join(projectDirectory, "src-tauri", "tauri.reuse.conf.json");

async function isHealthy(url, validate) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return false;
    return validate ? validate(await response.text()) : true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const [frontendReady, sidecarReady] = suppliedSidecarToken
  ? await Promise.all([
      isHealthy(`${frontendUrl}/`, (body) => body.includes("Blackwall") || body.includes("root")),
      isHealthy(`${sidecarUrl}/health`, (body) => {
    try {
      const payload = JSON.parse(body);
      return payload.service === "blackwall-sidecar" && payload.status === "ready";
    } catch {
      return false;
    }
      }),
    ])
  : [false, false];

const args = ["exec", "tauri", "--", "dev"];
if (frontendReady && sidecarReady) {
  // `npm run dev` may already be serving the browser. Reusing that pair avoids
  // a second SQLite writer and prevents Tauri from killing beforeDevCommand
  // with SIGTERM (143) after the second sidecar fails to bind 1422.
  args.push("--config", reuseConfig);
  console.info("Blackwall: reutilizando o servidor web e o sidecar já ativos.");
}
args.push(...process.argv.slice(2));

const tauri = spawn(npmCommand, args, {
  cwd: projectDirectory,
  env: { ...process.env, BLACKWALL_SIDECAR_TOKEN: sidecarToken },
  stdio: "inherit",
});

tauri.once("error", (error) => {
  console.error(`Não foi possível iniciar o Blackwall desktop: ${error.message}`);
  process.exit(1);
});

tauri.once("exit", (code, signal) => {
  if (typeof code === "number") process.exit(code);
  if (signal) process.exit(128 + (signal === "SIGTERM" ? 15 : signal === "SIGINT" ? 2 : 1));
  process.exit(1);
});
