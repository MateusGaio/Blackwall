// MIT License — Copyright (c) 2026 Mateus Gaio

import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const sidecarEntry = join(projectDirectory, "sidecar", "dist", "index.js");
const sidecarProtocol = "blackwall.v1";
const defaultTimeoutMs = 120_000;

function timeoutError() {
  const error = new Error("O harness live excedeu o timeout configurado.");
  error.name = "TimeoutError";
  return error;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta indisponível.");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // O sidecar ainda pode estar inicializando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw timeoutError();
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function jsonRequest(url, token, init = {}, timeoutMs = defaultTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.name = "HttpError";
      throw error;
    }
    return response.json();
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function liveConfig() {
  return [
    {
      apiKey: process.env.BLACKWALL_LIVE_OLLAMA_API_KEY,
      label: "ollama",
      model: process.env.BLACKWALL_LIVE_OLLAMA_MODEL,
      type: "ollama",
      url: process.env.BLACKWALL_LIVE_OLLAMA_URL,
    },
    {
      apiKey: process.env.BLACKWALL_LIVE_OPENAI_API_KEY,
      label: "openai-compatible",
      model: process.env.BLACKWALL_LIVE_OPENAI_MODEL,
      type: "openai-compatible",
      url: process.env.BLACKWALL_LIVE_OPENAI_URL,
    },
  ].filter((provider) => provider.url && provider.model);
}

function categorizeError(error) {
  if (error?.name === "TimeoutError") return "timeout";
  if (error?.name === "HttpError") return "http";
  if (error?.name === "WebSocketError") return "websocket";
  if (error?.name === "ProviderConnectionError") return "provider-unreachable";
  return "unexpected";
}

async function runProvider(provider, timeoutMs) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw timeoutError();
    return value;
  };
  const storageDirectory = await mkdtemp(join(tmpdir(), "blackwall-live-harness-"));
  const workspaceRoot = join(storageDirectory, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "README.md"), "# Live harness\n\nWorkspace sintético.\n");
  const sidecarPort = await freePort();
  const token = "live-harness-token";
  const sidecar = spawn(process.execPath, [sidecarEntry], {
    env: {
      ...process.env,
      BLACKWALL_DATA_DIR: storageDirectory,
      BLACKWALL_SIDECAR_PORT: String(sidecarPort),
      BLACKWALL_SIDECAR_TOKEN: token,
      BLACKWALL_E2E_AGENT: "0",
      BLACKWALL_E2E_MOCK: "0",
    },
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${sidecarPort}`;
  try {
    await waitForHttp(`${baseUrl}/health`, remaining());
    const state = await jsonRequest(
      `${baseUrl}/v1/bootstrap`,
      token,
      {
        body: JSON.stringify({
          locale: "pt-BR",
          permissionMode: "ask",
          profileName: "Live harness",
          profileSoul: "Responda apenas com OK.",
          workspaceName: "Live harness workspace",
          workspaceRootPath: workspaceRoot,
          workspaceSoul: "Use somente o workspace selecionado.",
        }),
        method: "POST",
      },
      remaining(),
    );
    const saved = await jsonRequest(
      `${baseUrl}/v1/providers`,
      token,
      {
        body: JSON.stringify({
          apiKey: provider.apiKey,
          baseUrl: provider.url,
          model: provider.model,
          name: `Live ${provider.label}`,
          type: provider.type,
        }),
        method: "POST",
      },
      remaining(),
    );
    await jsonRequest(
      `${baseUrl}/v1/sessions/${state.activeSessionId}/model`,
      token,
      {
        body: JSON.stringify({ model: provider.model, providerId: saved.provider.id }),
        method: "POST",
      },
      remaining(),
    );
    await chatOnce({
      model: provider.model,
      providerId: saved.provider.id,
      sessionId: state.activeSessionId,
      timeoutMs: remaining(),
      token,
      url: baseUrl,
      workspaceId: state.activeWorkspaceId,
    });
    return {
      durationMs: Date.now() - startedAt,
      model: provider.model,
      provider: provider.label,
      result: "passed",
    };
  } finally {
    await stopProcess(sidecar);
    await rm(storageDirectory, { force: true, recursive: true });
  }
}

async function chatOnce({ model, providerId, sessionId, timeoutMs, token, url, workspaceId }) {
  const socket = new WebSocket(`${url.replace(/^http/, "ws")}`, [sidecarProtocol, token]);
  const requestId = `live-harness-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(timeoutError());
    }, timeoutMs);
    const finish = (error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    socket.once("error", () => {
      const error = new Error("WebSocket indisponível.");
      error.name = "WebSocketError";
      finish(error);
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.requestId && message.requestId !== requestId) return;
      if (message.type === "chat.completed") {
        socket.close();
        finish();
      }
      if (message.type === "chat.failed") {
        const error = new Error("O provedor não concluiu o turno.");
        error.name = "ProviderConnectionError";
        socket.close();
        finish(error);
      }
    });
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          messages: [{ content: "Responda apenas com OK.", role: "user" }],
          model,
          providerId,
          requestId,
          sessionId,
          type: "chat.start",
          workspaceId,
        }),
      );
    });
  });
}

if (process.env.BLACKWALL_RUN_LIVE_HARNESS !== "1") {
  console.info(JSON.stringify({ errorCategory: "opt-in-required", result: "skipped" }));
  process.exit(0);
}

await access(sidecarEntry);
const configuredTimeoutMs = Number(process.env.BLACKWALL_LIVE_TIMEOUT_MS);
const timeoutMs =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : defaultTimeoutMs;
const providers = liveConfig();
if (providers.length === 0) {
  console.info(JSON.stringify({ errorCategory: "configuration", result: "failed" }));
  process.exitCode = 1;
} else {
  let failed = false;
  const deadline = Date.now() + timeoutMs;
  for (const provider of providers) {
    const providerStartedAt = Date.now();
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw timeoutError();
      console.info(JSON.stringify(await runProvider(provider, remainingMs)));
    } catch (error) {
      failed = true;
      console.info(
        JSON.stringify({
          durationMs: Date.now() - providerStartedAt,
          model: provider.model,
          provider: provider.label,
          errorCategory: categorizeError(error),
          result: "failed",
        }),
      );
    }
  }
  process.exitCode = failed ? 1 : 0;
}
