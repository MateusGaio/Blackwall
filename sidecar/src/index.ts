// MIT License — Copyright (c) 2026 Mateus Gaio
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { type ChatMessage, sendChatMessage } from "./chat.js";
import { dataDirectory, openDatabase } from "./db/database.js";
import { type BootstrapInput, createStore, type PermissionMode } from "./db/store.js";
import { telemetryMode, withInstrumentation } from "./observability.js";
import { listProviders, type ProviderInput, saveProvider, validateProvider } from "./providers.js";

export const SIDECAR_HOST = "127.0.0.1";
const allowedOrigins = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://tauri.localhost",
]);

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

export function createSidecar(
  port = 0,
  storageDirectory = dataDirectory(),
): Promise<{ port: number; server: Server }> {
  const database = openDatabase(storageDirectory);
  const store = createStore(database);
  const server = createServer(async (request, response) => {
    allowOrigin(request, response);
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    const pathname = new URL(request.url ?? "/", "http://blackwall.local").pathname;
    if (request.url === "/health") {
      writeJson(response, 200, withInstrumentation("sidecar.health", healthPayload));
      return;
    }
    try {
      if (request.method === "GET" && pathname === "/v1/state") {
        writeJson(response, 200, store.getState());
        return;
      }
      if (request.method === "POST" && pathname === "/v1/bootstrap") {
        const input = (await requestBody(request)) as BootstrapInput;
        writeJson(response, 200, await store.bootstrap(input));
        return;
      }
      if (request.method === "POST" && pathname === "/v1/profiles") {
        const input = (await requestBody(request)) as {
          locale: string;
          name: string;
          soul: string;
        };
        writeJson(response, 201, { profile: await store.createProfile(input) });
        return;
      }
      if (request.method === "GET" && pathname === "/v1/workspaces") {
        const profileId = new URL(request.url ?? "/", "http://blackwall.local").searchParams.get(
          "profileId",
        );
        if (!profileId) throw new Error("Informe o perfil para listar os workspaces.");
        writeJson(response, 200, { workspaces: store.listWorkspaces(profileId) });
        return;
      }
      if (request.method === "POST" && pathname === "/v1/workspaces") {
        const input = (await requestBody(request)) as {
          name: string;
          permissionMode?: PermissionMode;
          profileId: string;
          rootPath: string;
          soul: string;
        };
        writeJson(response, 201, { workspace: await store.createWorkspace(input) });
        return;
      }
      if (request.method === "GET" && /^\/v1\/workspaces\/[^/]+\/sessions$/.test(pathname)) {
        const workspaceId = pathname.split("/")[3];
        writeJson(response, 200, { sessions: store.listSessions(workspaceId) });
        return;
      }
      if (request.method === "POST" && pathname === "/v1/sessions") {
        const input = (await requestBody(request)) as { title?: string; workspaceId: string };
        writeJson(response, 201, { session: store.createSession(input) });
        return;
      }
      if (request.method === "POST" && /^\/v1\/sessions\/[^/]+\/select$/.test(pathname)) {
        writeJson(response, 200, store.selectSession(pathname.split("/")[3]));
        return;
      }
      if (request.method === "GET" && /^\/v1\/sessions\/[^/]+\/messages$/.test(pathname)) {
        writeJson(response, 200, { messages: store.listMessages(pathname.split("/")[3]) });
        return;
      }
      if (request.method === "POST" && /^\/v1\/sessions\/[^/]+\/messages$/.test(pathname)) {
        const input = (await requestBody(request)) as {
          content: string;
          model?: string | null;
          providerId?: string | null;
          role: "assistant" | "system" | "user";
          status?: string;
        };
        writeJson(response, 201, {
          message: store.appendMessage({ ...input, sessionId: pathname.split("/")[3] }),
        });
        return;
      }
      if (request.method === "GET" && pathname === "/v1/providers") {
        writeJson(response, 200, { providers: await listProviders() });
        return;
      }
      if (request.method === "POST" && pathname === "/v1/providers") {
        const input = (await requestBody(request)) as ProviderInput;
        await validateProvider(input);
        writeJson(response, 201, { provider: await saveProvider(input) });
        return;
      }
      if (request.method === "POST" && pathname === "/v1/chat/completions") {
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

  server.once("close", () => database.close());

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
