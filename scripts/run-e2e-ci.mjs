// MIT License — Copyright (c) 2026 Mateus Gaio
import { spawn } from "node:child_process";

const playwrightCommand = process.platform === "win32" ? "playwright.cmd" : "playwright";
const exitCode = await new Promise((resolve) => {
  const child = spawn(playwrightCommand, ["test", "--forbid-only"], {
    env: { ...process.env, BLACKWALL_E2E_CI: "1" },
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  child.once("error", (error) => {
    console.error(`Não foi possível iniciar o Playwright: ${error.message}`);
    resolve(1);
  });
  child.once("exit", (code) => resolve(code ?? 1));
});

process.exit(exitCode);
