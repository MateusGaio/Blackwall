// MIT License — Copyright (c) 2026 Mateus Gaio
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { type ChatMessage, sendChatMessage } from "./chat.js";
import { telemetryMode, withInstrumentation } from "./observability.js";
import { listProviders, type ProviderInput, saveProvider, validateProvider } from "./providers.js";

export const SIDECAR_HOST = "127.0.0.1";
const allowedOrigins = new Set(["http://localhost:1420", "http://tauri.localhost"]);

export function healthPayload() {
  return {
    service: "blackwall-sidecar",
    status: "ready",
    telemetry: telemetryMode,
  } as const;
}

function writeJson(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function allowOrigin(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin))
    response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

function requestBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("O pedido local está inválido."));
      }
    });
    request.on("error", reject);
  });
}

export function createSidecar(port = 0): Promise<{ port: number; server: Server }> {
  const server = createServer(async (request, response) => {
    allowOrigin(request, response);
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    if (request.url === "/health") {
      writeJson(response, 200, withInstrumentation("sidecar.health", healthPayload));
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/v1/providers") {
        writeJson(response, 200, { providers: await listProviders() });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/providers") {
        const input = (await requestBody(request)) as ProviderInput;
        await validateProvider(input);
        writeJson(response, 201, { provider: await saveProvider(input) });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        const input = (await requestBody(request)) as {
          messages: ChatMessage[];
          providerId: string;
        };
        writeJson(response, 200, await sendChatMessage(input.providerId, input.messages));
        return;
      }
      writeJson(response, 404, { error: "Rota local não encontrada." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha local inesperada.";
      writeJson(response, 400, { error: message });
    }
  });

  const socketServer = new WebSocketServer({ server });
  socketServer.on("connection", (socket) => {
    socket.send(JSON.stringify({ topic: "system:ready", ...healthPayload() }));
  });

  return new Promise((resolve) => {
    server.listen(port, SIDECAR_HOST, () => {
      const address = server.address() as AddressInfo;
      resolve({ port: address.port, server });
    });
  });
}

export function startFromEnvironment() {
  const requestedPort = Number(process.env.BLACKWALL_SIDECAR_PORT ?? 0);
  return createSidecar(requestedPort).then(({ port, server }) => {
    console.info(`Blackwall sidecar disponível em ws://${SIDECAR_HOST}:${port}`);
    return { port, server };
  });
}

/* c8 ignore next 4 -- entrada direta do processo, coberta pelo empacotamento. */
if (import.meta.url === `file://${process.argv[1]}`) {
  void startFromEnvironment();
}
