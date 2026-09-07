// MIT License — Copyright (c) 2026 Mateus Gaio

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { constants, existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const sidecarEntry = join(projectDirectory, "sidecar", "dist", "index.js");
const desktopBinary = join(
  projectDirectory,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "blackwall.exe" : "blackwall",
);
const acceptancePrompt =
  "Explore o workspace selecionado e entenda o projeto dentro dele. Comece listando a raiz e use apenas os caminhos realmente retornados pelas ferramentas. Ignore dependências, ambientes virtuais, caches, builds e arquivos gerados. Leia a documentação, manifests, configurações, pontos de entrada, código principal e testes relevantes. Crie ou atualize `BLACKWALL_CONTEXT.md` na raiz do workspace com um resumo técnico completo. Inclua wikilinks para arquivos Markdown existentes e links Markdown para os arquivos de código citados. Ao terminar, releia o resumo, valide todos os links e informe o que foi criado.";

function findTauriDriver() {
  if (process.env.TAURI_DRIVER_BIN) return process.env.TAURI_DRIVER_BIN;
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["tauri-driver"], { encoding: "utf8" });
  const candidate = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
  if (candidate) return candidate;
  throw new Error(
    "tauri-driver não encontrado. Instale o driver externamente e repita test:harness:desktop.",
  );
}

function findNativeWebDriver() {
  if (process.env.TAURI_NATIVE_DRIVER) return process.env.TAURI_NATIVE_DRIVER;
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["WebKitWebDriver"], { encoding: "utf8" });
  const candidate = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
  if (candidate) return candidate;
  throw new Error(
    "WebKitWebDriver não encontrado. Instale webkit2gtk-driver (Linux) ou defina TAURI_NATIVE_DRIVER.",
  );
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Não foi possível reservar uma porta.");
  const port = address.port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitForHttp(url, headers = {}, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "sem resposta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.name : "erro de conexão";
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`O serviço não ficou disponível (${lastError}).`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit"),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
}

async function jsonRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Preparação do harness falhou (HTTP ${response.status}).`);
  return response.json();
}

async function seedWorkspace(storageDirectory, sidecarPort, sidecarToken, workspaceRoot) {
  const sidecar = spawn(process.execPath, [sidecarEntry], {
    env: {
      ...process.env,
      BLACKWALL_DATA_DIR: storageDirectory,
      BLACKWALL_E2E_AGENT: "1",
      BLACKWALL_E2E_MOCK: "1",
      BLACKWALL_SIDECAR_PORT: String(sidecarPort),
      BLACKWALL_SIDECAR_TOKEN: sidecarToken,
    },
    stdio: "ignore",
  });
  try {
    const baseUrl = `http://127.0.0.1:${sidecarPort}`;
    await waitForHttp(`${baseUrl}/health`);
    const state = await jsonRequest(`${baseUrl}/v1/bootstrap`, sidecarToken, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "ask",
        profileName: "Desktop harness",
        profileSoul: "Valide o workspace com segurança.",
        workspaceName: "Desktop harness workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Explore apenas caminhos retornados pelas ferramentas.",
      }),
      method: "POST",
    });
    const provider = await jsonRequest(`${baseUrl}/v1/providers`, sidecarToken, {
      body: JSON.stringify({
        apiKey: "desktop-harness-key",
        baseUrl: "https://mock.invalid/v1",
        model: "mock-model",
        name: "Desktop harness provider",
        type: "openai-compatible",
      }),
      method: "POST",
    });
    await jsonRequest(`${baseUrl}/v1/providers/models`, sidecarToken, {
      body: JSON.stringify({
        apiKey: "desktop-harness-key",
        baseUrl: "https://mock.invalid/v1",
        id: provider.provider.id,
        model: "mock-model",
        name: "Desktop harness provider",
        type: "openai-compatible",
      }),
      method: "POST",
    });
    await jsonRequest(`${baseUrl}/v1/sessions/${state.activeSessionId}/model`, sidecarToken, {
      body: JSON.stringify({ model: "mock-model", providerId: provider.provider.id }),
      method: "POST",
    });
  } finally {
    await stopProcess(sidecar);
  }
}

async function ensureShell(browser) {
  const composer = await browser.$('[data-testid="chat-composer"]');
  if (!(await composer.isExisting())) {
    const profiles = await browser.$$('[data-testid="profile-option"]');
    for (const profile of profiles) {
      if ((await profile.getText()).includes("Desktop harness")) {
        await profile.click();
        break;
      }
    }
  }
  await composer.waitForExist({ timeout: 20_000 });
  return composer;
}

async function approveToolsAndWaitForCompletion(browser) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const body = await (await browser.$("body")).getText();
    if (body.includes("Workspace analisado. Criei e validei BLACKWALL_CONTEXT.md")) return;
    const buttons = await browser.$$("button");
    for (const button of buttons) {
      const label = await button.getText();
      if (label.includes("Permitir uma vez") || label.includes("Allow once")) {
        await button.click();
        break;
      }
    }
    await browser.pause(250);
  }
  throw new Error("O fluxo de ferramentas não terminou dentro do timeout.");
}

async function openVaultAndVerify(browser) {
  const tabs = await browser.$$('[role="tab"]');
  for (const tab of tabs) {
    const label = await tab.getText();
    if (label === "Arquivos" || label === "Files") {
      await tab.click();
      break;
    }
  }
  const body = await (await browser.$("body")).getText();
  if (!body.includes("Blackwall Context"))
    throw new Error("O arquivo de contexto não apareceu no Vault desktop.");
}

async function openDesktop(browserOptions) {
  return remote({
    capabilities: {
      browserName: "",
      "tauri:options": { application: desktopBinary },
    },
    hostname: "127.0.0.1",
    logLevel: "warn",
    port: browserOptions.driverPort,
  });
}

async function main() {
  if (!existsSync(desktopBinary) || !existsSync(sidecarEntry)) {
    throw new Error(
      "Binário desktop ausente. Execute npm run build:desktop antes de test:harness:desktop.",
    );
  }
  await access(desktopBinary, constants.X_OK);
  const tauriDriver = findTauriDriver();
  const nativeWebDriver = findNativeWebDriver();
  const storageDirectory = await mkdtemp(join(tmpdir(), "blackwall-desktop-harness-"));
  const workspaceRoot = join(storageDirectory, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, "tests"), { recursive: true });
  await writeFile(join(workspaceRoot, "README.md"), "# Desktop harness\n\nWorkspace sintético.\n");
  await writeFile(join(workspaceRoot, "ARCHITECTURE.md"), "# Architecture\n\nRuntime local.\n");
  await writeFile(join(workspaceRoot, "src", "index.ts"), "export const main = true;\n");
  await writeFile(
    join(workspaceRoot, "tests", "index.test.ts"),
    "import { expect, test } from 'vitest'; test('main', () => expect(true).toBe(true));\n",
  );

  const sidecarPort = await freePort();
  const driverPort = await freePort();
  const sidecarToken = "desktop-harness-token";
  const driver = spawn(
    tauriDriver,
    ["--native-driver", nativeWebDriver, "--port", String(driverPort)],
    {
      env: {
        ...process.env,
        BLACKWALL_DATA_DIR: storageDirectory,
        BLACKWALL_E2E_AGENT: "1",
        BLACKWALL_E2E_MOCK: "1",
        BLACKWALL_SIDECAR_TOKEN: sidecarToken,
        PATH: process.platform === "win32" ? "" : "/nonexistent",
      },
      stdio: "ignore",
    },
  );
  const startedAt = Date.now();
  let browser;
  try {
    await seedWorkspace(storageDirectory, sidecarPort, sidecarToken, workspaceRoot);
    await waitForHttp(`http://127.0.0.1:${driverPort}/status`, {}, 20_000);
    browser = await openDesktop({ driverPort });
    let composer = await ensureShell(browser);
    await composer.setValue(acceptancePrompt);
    await composer.keys("ENTER");
    await approveToolsAndWaitForCompletion(browser);
    const context = await readFile(join(workspaceRoot, "BLACKWALL_CONTEXT.md"), "utf8");
    if (!context.includes("# Blackwall Context"))
      throw new Error("BLACKWALL_CONTEXT.md não foi persistido no workspace.");
    await openVaultAndVerify(browser);
    await browser.deleteSession();
    browser = undefined;

    browser = await openDesktop({ driverPort });
    composer = await ensureShell(browser);
    if (!(await composer.isExisting()))
      throw new Error("A sessão não foi restaurada após reinício.");
    await openVaultAndVerify(browser);
    console.info(
      JSON.stringify({
        durationMs: Date.now() - startedAt,
        model: "mock-model",
        provider: "desktop-e2e-mock",
        result: "passed",
      }),
    );
  } finally {
    if (browser) await browser.deleteSession().catch(() => undefined);
    await stopProcess(driver);
    await rm(storageDirectory, { force: true, recursive: true });
  }
}

await main();
