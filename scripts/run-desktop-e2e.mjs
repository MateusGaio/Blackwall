// MIT License — Copyright (c) 2026 Mateus Gaio
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDirectory = await mkdtemp(join(tmpdir(), "blackwall-desktop-e2e-data-"));
const workspaceDirectory = await mkdtemp(join(tmpdir(), "blackwall-desktop-e2e-workspace-"));
const environment = {
  ...process.env,
  BLACKWALL_DATA_DIR: dataDirectory,
  BLACKWALL_E2E: "1",
  BLACKWALL_E2E_AGENT: "1",
  BLACKWALL_E2E_MOCK: "1",
  BLACKWALL_HARNESS_WORKSPACE: workspaceDirectory,
};

for (const dependency of ["tauri-driver", "WebKitWebDriver"]) {
  if (spawnSync("which", [dependency], { encoding: "utf8" }).status !== 0) {
    throw new Error(
      `${dependency} não foi encontrado. No Linux, instale tauri-driver, webkit2gtk-driver e xvfb.`,
    );
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env: environment, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} encerrou com código ${code}.`)),
    );
  });
}

let driver;
try {
  await run(process.execPath, ["scripts/seed-desktop-harness.mjs"]);
  driver = spawn("tauri-driver", ["--port", "4444"], {
    env: environment,
    stdio: "inherit",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  await run(process.execPath, ["node_modules/@wdio/cli/bin/wdio.js", "run", "wdio.conf.mjs"]);
} finally {
  driver?.kill();
  await rm(dataDirectory, { force: true, recursive: true });
  await rm(workspaceDirectory, { force: true, recursive: true });
}
