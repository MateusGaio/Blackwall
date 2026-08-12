// MIT License — Copyright (c) 2026 Mateus Gaio
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import {
  type AttachmentInput,
  removeAttachment,
  saveAttachment,
  searchAttachments,
} from "./attachments.js";
import { type ChatMessage, sendChatMessage } from "./chat.js";
import { dataDirectory, openDatabase } from "./db/database.js";
import { type BootstrapInput, createStore, type PermissionMode } from "./db/store.js";
import { telemetryMode, withInstrumentation } from "./observability.js";
import {
  listProviderModels,
  listProviders,
  listStoredProviderModels,
  type ProviderInput,
  saveProvider,
  validateProvider,
} from "./providers.js";
import { isRetryableProviderError, streamChatMessage } from "./streaming.js";

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
  response.setHeader("access-control-allow-methods", "DELETE, GET, POST, OPTIONS");
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
      if (request.method === "POST" && pathname === "/v1/attachments") {
        const input = (await requestBody(request)) as AttachmentInput;
        writeJson(response, 201, { attachment: await saveAttachment(input, storageDirectory) });
        return;
      }
      if (request.method === "GET" && pathname === "/v1/attachments/search") {
        const url = new URL(request.url ?? "/", "http://blackwall.local");
        const workspaceId = url.searchParams.get("workspaceId");
        const query = url.searchParams.get("q");
        if (!workspaceId || !query)
          throw new Error("Informe workspace e busca para pesquisar anexos.");
        writeJson(response, 200, {
          results: await searchAttachments(workspaceId, query, storageDirectory),
        });
        return;
      }
      if (request.method === "DELETE" && /^\/v1\/attachments\/[^/]+$/.test(pathname)) {
        writeJson(response, 200, {
          attachment: await removeAttachment(pathname.split("/")[3], storageDirectory),
        });
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
      if (request.method === "POST" && pathname === "/v1/providers/models") {
        const input = (await requestBody(request)) as ProviderInput;
        writeJson(response, 200, { models: await listProviderModels(input) });
        return;
      }
      if (request.method === "GET" && /^\/v1\/providers\/[^/]+\/models$/.test(pathname)) {
        writeJson(response, 200, {
          models: await listStoredProviderModels(pathname.split("/")[3]),
        });
        return;
      }
      if (request.method === "POST" && /^\/v1\/sessions\/[^/]+\/model$/.test(pathname)) {
        const input = (await requestBody(request)) as { model: string; providerId?: string | null };
        writeJson(response, 200, {
          session: store.setSessionModel(pathname.split("/")[3], input.model, input.providerId),
        });
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
          model?: string;
          providerId: string;
        };
        writeJson(
          response,
          200,
          await sendChatMessage(input.providerId, input.messages, input.model),
        );
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
  const activeRequests = new Map<string, AbortController>();
  const queues = new Map<string, Promise<void>>();

  async function executeChat(
    socket: import("ws").WebSocket,
    input: {
      messages: ChatMessage[];
      model?: string;
      providerId: string;
      requestId: string;
    },
  ) {
    const controller = new AbortController();
    activeRequests.set(input.requestId, controller);
    const providers = await listProviders();
    const providerIds = [input.providerId, ...providers.map((provider) => provider.id)]
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .slice(0, 8);
    try {
      for (const providerId of providerIds) {
        if (controller.signal.aborted) return;
        socket.send(
          JSON.stringify({ providerId, requestId: input.requestId, type: "chat.started" }),
        );
        let content = "";
        try {
          const result = await streamChatMessage(
            providerId,
            input.messages,
            input.model,
            (delta) => {
              content += delta;
              socket.send(
                JSON.stringify({
                  delta,
                  requestId: input.requestId,
                  type: "chat.delta",
                }),
              );
            },
            controller.signal,
          );
          socket.send(
            JSON.stringify({
              content,
              provider: result.provider,
              requestId: input.requestId,
              type: "chat.completed",
            }),
          );
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (!isRetryableProviderError(error) || providerId === providerIds.at(-1)) {
            const message = error instanceof Error ? error.message : "Falha no provedor.";
            socket.send(
              JSON.stringify({ message, requestId: input.requestId, type: "chat.failed" }),
            );
            return;
          }
          socket.send(
            JSON.stringify({
              message: "Tentando o próximo provedor…",
              providerId,
              requestId: input.requestId,
              type: "chat.retrying",
            }),
          );
        }
      }
    } finally {
      activeRequests.delete(input.requestId);
    }
  }

  function enqueueChat(
    socket: import("ws").WebSocket,
    input: {
      messages: ChatMessage[];
      model?: string;
      providerId: string;
      requestId: string;
      workspaceId?: string;
    },
  ) {
    const workspaceId = input.workspaceId ?? "default";
    const previous = queues.get(workspaceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => executeChat(socket, input));
    queues.set(workspaceId, current);
    void current.finally(() => {
      if (queues.get(workspaceId) === current) queues.delete(workspaceId);
    });
    socket.send(JSON.stringify({ requestId: input.requestId, type: "queue.updated", workspaceId }));
  }

  socketServer.on("connection", (socket) => {
    socket.send(JSON.stringify({ topic: "system:ready", ...healthPayload() }));
    socket.on("message", (raw) => {
      let input: { requestId?: string; type?: string; [key: string]: unknown };
      try {
        input = JSON.parse(String(raw)) as typeof input;
      } catch {
        socket.send(
          JSON.stringify({ message: "Comando WebSocket inválido.", type: "chat.failed" }),
        );
        return;
      }
      if (input.type === "chat.stop" && input.requestId) {
        activeRequests.get(input.requestId)?.abort();
        socket.send(JSON.stringify({ requestId: input.requestId, type: "chat.stopped" }));
        return;
      }
      if (input.type === "chat.start" && input.requestId && typeof input.providerId === "string") {
        enqueueChat(socket, input as never);
      }
    });
    socket.on("close", () => {
      for (const controller of activeRequests.values()) controller.abort();
    });
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
