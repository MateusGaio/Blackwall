// MIT License — Copyright (c) 2026 Mateus Gaio
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { SIDECAR_WS_PROTOCOL } from "./auth.js";
import { openDatabase } from "./db/database.js";
import { createSidecar, healthPayload, SIDECAR_HOST, startFromEnvironment } from "./index.js";
import { saveProvider } from "./providers.js";

const servers: import("node:http").Server[] = [];
const directories: string[] = [];

function responseWithLines(lines: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(new TextEncoder().encode(`${line}\n`));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function toolCallResponse(id: string, name: string, args: Record<string, unknown>) {
  return responseWithLines([
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: { arguments: JSON.stringify(args), name },
                id,
                index: 0,
                type: "function",
              },
            ],
          },
        },
      ],
    })}`,
    "data: [DONE]",
  ]);
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("sidecar health", () => {
  it("informa que telemetria permanece desativada", () => {
    expect(healthPayload()).toEqual({
      service: "blackwall-sidecar",
      status: "ready",
      telemetry: "disabled",
    });
  });

  it("expõe health check e avisa clientes WebSocket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-health-"));
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const response = await fetch(`http://${SIDECAR_HOST}:${port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(healthPayload());

    const missing = await fetch(`http://${SIDECAR_HOST}:${port}/missing`);
    expect(missing.status).toBe(404);

    const client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
    const [message] = await once(client, "message");
    expect(JSON.parse(String(message))).toMatchObject({
      topic: "system:ready",
      telemetry: "disabled",
    });
    client.close();
  });

  it("mapeia erros de descoberta de modelos para códigos HTTP honestos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-models-http-"));
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bodyOf = async (response: Response) => {
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["error"]);
      expect(typeof body.error).toBe("string");
      return body;
    };

    const invalid = await fetch(`${baseUrl}/v1/providers/models`, {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    await bodyOf(invalid);

    const missing = await fetch(`${baseUrl}/v1/providers/missing/models`);
    expect(missing.status).toBe(404);
    await bodyOf(missing);

    const unavailableProvider = await saveProvider(
      {
        apiKey: "test-key",
        baseUrl: `http://${SIDECAR_HOST}:1/v1`,
        model: "model",
        name: "Unavailable",
      },
      directory,
    );
    const unavailable = await fetch(`${baseUrl}/v1/providers/${unavailableProvider.id}/models`);
    expect(unavailable.status).toBe(503);
    await bodyOf(unavailable);

    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{invalid-json");
    });
    await new Promise<void>((resolve) => upstream.listen(0, SIDECAR_HOST, resolve));
    servers.push(upstream);
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("porta indisponível");
    const unexpectedProvider = await saveProvider(
      {
        apiKey: "test-key",
        baseUrl: `http://${SIDECAR_HOST}:${address.port}/v1`,
        model: "model",
        name: "Unexpected",
      },
      directory,
    );
    const unexpected = await fetch(`${baseUrl}/v1/providers/${unexpectedProvider.id}/models`);
    expect(unexpected.status).toBe(500);
    await bodyOf(unexpected);
  });

  it("aceita na rota de anexos um payload válido maior que o limite HTTP geral", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-attachment-http-limit-"));
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        profileName: "Attachment limit",
        profileSoul: "Profile",
        workspaceName: "Workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as { activeWorkspaceId: string };
    // 760 kB binários viram pouco mais de 1 MB em base64, reproduzindo a
    // regressão sem fazer a suíte indexar um anexo próximo do teto de 10 MiB.
    const contentBase64 = Buffer.alloc(760_000, 0x61).toString("base64");
    const response = await fetch(`${baseUrl}/v1/attachments`, {
      body: JSON.stringify({
        contentBase64,
        filename: "large.txt",
        mimeType: "text/plain",
        workspaceId: state.activeWorkspaceId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
  });

  it("inicia usando a porta do ambiente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-env-"));
    directories.push(directory);
    vi.stubEnv("BLACKWALL_DATA_DIR", directory);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { server } = await startFromEnvironment();
    servers.push(server);
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
    vi.unstubAllEnvs();
  });

  it("persiste o estado do onboarding pelas rotas locais", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-api-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;

    const bootstrap = await fetch(`http://${SIDECAR_HOST}:${port}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        profileName: "Ada",
        profileSoul: "Profile",
        workspaceName: "Project",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(bootstrap.status).toBe(200);
    const state = (await bootstrap.json()) as {
      activeSessionId: string;
      activeProfileId: string;
      profiles: Array<{ name: string }>;
      workspaces: Array<{ rootPath: string }>;
    };
    expect(state.activeSessionId).toBeTruthy();
    expect(state.profiles[0]?.name).toBe("Ada");
    expect(state.workspaces[0]?.rootPath).toBe(workspaceRoot);

    const restored = await fetch(`http://${SIDECAR_HOST}:${port}/v1/state`);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      activeSessionId: state.activeSessionId,
    });
    const recent = await fetch(
      `http://${SIDECAR_HOST}:${port}/v1/profiles/${state.activeProfileId}/sessions/recent`,
    );
    expect(recent.status).toBe(200);
    await expect(recent.json()).resolves.toMatchObject({
      sessions: [{ id: state.activeSessionId, workspaceName: "Project" }],
    });
    const signedOut = await fetch(`${baseUrl}/v1/profile/sign-out`, {
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(signedOut.status).toBe(200);
    await expect(signedOut.json()).resolves.toMatchObject({
      activeProfileId: null,
      profiles: [{ name: "Ada" }],
    });
    const selected = await fetch(`${baseUrl}/v1/profile/select`, {
      body: JSON.stringify({ profileId: state.activeProfileId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(selected.status).toBe(200);
    await expect(selected.json()).resolves.toMatchObject({
      activeProfileId: state.activeProfileId,
    });
  });

  it("atualiza perfil e Soul do workspace pelas rotas locais", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-profile-api-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        profileName: "Ada",
        profileSoul: "Profile",
        workspaceName: "Project",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeWorkspaceId: string;
    };
    const profileResponse = await fetch(`${baseUrl}/v1/profiles/${state.activeProfileId}`, {
      body: JSON.stringify({
        avatarData: "data:image/png;base64,AAAA",
        name: "Ada Lovelace",
        soul: "Updated profile",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(profileResponse.status).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({
      profile: { avatarData: "data:image/png;base64,AAAA", name: "Ada Lovelace" },
    });
    const soulResponse = await fetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/soul`, {
      body: JSON.stringify({ soul: "Updated workspace" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(soulResponse.status).toBe(200);
    await expect(soulResponse.json()).resolves.toMatchObject({
      workspace: { soul: "Updated workspace" },
    });
  });

  it("poda o transcript intra-turno no pipeline WebSocket após três turnos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-context-integration-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    for (let index = 0; index < 30; index += 1) {
      await writeFile(
        join(workspaceRoot, `note-${index}.md`),
        `# Note ${index}\n${"x".repeat(1_780)}\n`,
        "utf8",
      );
    }
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "automatic",
        profileName: "Context test",
        profileSoul: "Use ferramentas com segurança.",
        workspaceName: "Context workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Explore o código do workspace.",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "integration-key",
        baseUrl: "https://integration.example/v1",
        model: "integration-model",
        name: "Integration provider",
      },
      directory,
    );
    type CapturedMessage = { content?: string; role?: string; [key: string]: unknown };
    type CapturedRequest = { messages: CapturedMessage[]; turn: number };
    const requests: CapturedRequest[] = [];
    const localFetch = fetch;
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: CapturedMessage[] };
      const messages = body.messages ?? [];
      const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user");
      const lastUser = messages[lastUserIndex]?.content ?? "";
      const turnMatch = String(lastUser).match(/turno (\d+)/);
      const turn = turnMatch ? Number(turnMatch[1]) : 0;
      const toolCount = messages
        .slice(lastUserIndex + 1)
        .filter((message) => message.role === "tool").length;
      requests.push({ messages, turn });
      if (toolCount < 30) {
        const payload = {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({ path: `note-${toolCount}.md` }),
                      name: "read_file",
                    },
                    id: `integration-${turn}-${toolCount}`,
                    index: 0,
                  },
                ],
              },
            },
          ],
        };
        return Promise.resolve(
          responseWithLines([`data: ${JSON.stringify(payload)}`, "data: [DONE]"]),
        );
      }
      const payload = { choices: [{ delta: { content: `turno ${turn} concluído` } }] };
      return Promise.resolve(
        responseWithLines([`data: ${JSON.stringify(payload)}`, "data: [DONE]"]),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const queued: Record<string, unknown>[] = [];
      const waiters = new Map<string, (message: Record<string, unknown>) => void>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const messageType = String(message.type ?? message.topic);
        const resolveMessage = waiters.get(messageType);
        if (resolveMessage) {
          waiters.delete(messageType);
          resolveMessage(message);
        } else {
          queued.push(message);
        }
      });
      const waitFor = (type: string) => {
        const index = queued.findIndex((message) => String(message.type ?? message.topic) === type);
        if (index >= 0)
          return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
      };
      await once(client, "open");
      await waitFor("system:ready");

      for (let turn = 1; turn <= 3; turn += 1) {
        const content = `Continue explorando o workspace no turno ${turn}`;
        await localFetch(`${baseUrl}/v1/sessions/${state.activeSessionId}/messages`, {
          body: JSON.stringify({ content, role: "user", status: "complete" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const requestId = `context-integration-${turn}`;
        client.send(
          JSON.stringify({
            messages: [{ content, role: "user" }],
            model: provider.model,
            profileId: state.activeProfileId,
            providerId: provider.id,
            requestId,
            sessionId: state.activeSessionId,
            toolBudget: 40,
            type: "chat.start",
            workspaceId: state.activeWorkspaceId,
          }),
        );
        await expect(waitFor("chat.completed")).resolves.toMatchObject({
          content: `turno ${turn} concluído`,
          requestId,
        });
      }

      const estimateTokens = (messages: CapturedMessage[]) =>
        messages.reduce(
          (total, message) =>
            total + Math.ceil(Buffer.byteLength(String(message.content ?? "")) / 4),
          0,
        );
      const firstRequest = requests.find((request) => request.turn === 1);
      expect(firstRequest).toBeDefined();
      expect(JSON.stringify(firstRequest?.messages)).not.toContain('"pruned":true');
      const thirdTurnRequests = requests.filter((request) => request.turn === 3);
      expect(thirdTurnRequests).toHaveLength(31);
      const lateRequests = thirdTurnRequests.slice(-3);
      expect(lateRequests.every((request) => estimateTokens(request.messages) <= 28_000)).toBe(
        true,
      );
      expect(
        lateRequests.some((request) =>
          request.messages.some(
            (message) => message.role === "tool" && message.content?.includes('"pruned":true'),
          ),
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  });

  it("compacta uma vez, persiste o resumo e falha sem loop quando o resumo ainda estoura", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-compaction-integration-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "automatic",
        profileName: "Compaction test",
        profileSoul: "Profile",
        workspaceName: "Compaction workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "compaction-key",
        baseUrl: "https://compaction.example/v1",
        model: "compaction-model",
        name: "Compaction provider",
      },
      directory,
    );
    let database = openDatabase(directory);
    database.client
      .prepare(
        "INSERT INTO models (id, provider_id, model_id, display_name, capabilities, available, protocol_preference, resolved_protocol, tool_support, tool_support_source, tool_checked_at, tool_probe_error_code, tool_mode, parallel_tool_calls, context_limit, output_reserve, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'auto', NULL, 'native', 'test', NULL, NULL, 'auto', 'disabled', ?, NULL, ?)",
      )
      .run(
        `${provider.id}:${provider.model}`,
        provider.id,
        provider.model,
        provider.model,
        "[]",
        4_000,
        Date.now(),
      );
    database.close();

    const localFetch = fetch;
    const append = async (content: string, role: "assistant" | "user") => {
      await localFetch(`${baseUrl}/v1/sessions/${state.activeSessionId}/messages`, {
        body: JSON.stringify({ content, role, status: "complete" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    };
    await append(`histórico antigo 1 ${"a".repeat(8_000)}`, "user");
    await append(`resposta antiga 1 ${"b".repeat(8_000)}`, "assistant");
    await append(`histórico antigo 2 ${"c".repeat(8_000)}`, "user");
    await append(`resposta antiga 2 ${"d".repeat(8_000)}`, "assistant");
    await append("cauda protegida", "user");
    await append("resposta protegida", "assistant");
    await append("turno atual", "user");

    type CapturedMessage = { content?: string; role?: string; [key: string]: unknown };
    type CapturedBody = { messages?: CapturedMessage[]; stream?: boolean };
    const summaryRequests: CapturedMessage[][] = [];
    const mainRequests: CapturedMessage[][] = [];
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as CapturedBody;
      const messages = body.messages ?? [];
      if (body.stream === false) {
        summaryRequests.push(messages);
        const content =
          summaryRequests.length === 1
            ? "## Objetivo\n\nResumo determinístico.\n\n## Próximos passos\n\nContinuar."
            : "resumo grande ".padEnd(40_000, "x");
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        );
      }
      mainRequests.push(messages);
      return Promise.resolve(
        responseWithLines([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "resposta compactada" } }] })}`,
          "data: [DONE]",
        ]),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const queued: Record<string, unknown>[] = [];
      const waiters = new Map<string, (message: Record<string, unknown>) => void>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const messageType = String(message.type ?? message.topic);
        const resolveMessage = waiters.get(messageType);
        if (resolveMessage) {
          waiters.delete(messageType);
          resolveMessage(message);
        } else queued.push(message);
      });
      const waitFor = (type: string) => {
        const index = queued.findIndex((message) => String(message.type ?? message.topic) === type);
        if (index >= 0)
          return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [{ content: "turno atual", role: "user" }],
          model: provider.model,
          profileId: state.activeProfileId,
          providerId: provider.id,
          requestId: "compaction-success",
          sessionId: state.activeSessionId,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );
      await expect(waitFor("chat.compacting")).resolves.toMatchObject({
        requestId: "compaction-success",
      });
      await expect(waitFor("chat.completed")).resolves.toMatchObject({
        content: "resposta compactada",
        requestId: "compaction-success",
      });

      const estimateTokens = (messages: CapturedMessage[]) =>
        messages.reduce(
          (total, message) =>
            total + Math.ceil(Buffer.byteLength(String(message.content ?? "")) / 4),
          0,
        );
      expect(summaryRequests).toHaveLength(1);
      expect(mainRequests).toHaveLength(1);
      const checkpoint = {
        afterCompaction: estimateTokens(mainRequests[0] ?? []),
        beforeCompaction: estimateTokens(summaryRequests[0] ?? []),
      };
      expect(checkpoint.beforeCompaction).toBeGreaterThan(3_400);
      expect(checkpoint.afterCompaction).toBeLessThanOrEqual(3_400);
      expect(
        mainRequests[0]?.some((message) => message.content?.includes("Resumo determinístico")),
      ).toBe(true);
      expect(mainRequests[0]?.some((message) => message.content?.includes("cauda protegida"))).toBe(
        true,
      );
      expect(
        mainRequests[0]?.some((message) => message.content?.includes("histórico antigo 1")),
      ).toBe(false);
      const persisted = (
        await localFetch(`${baseUrl}/v1/sessions/${state.activeSessionId}/messages`)
      ).json() as Promise<{ messages: Array<{ isSummary?: boolean }> }>;
      await expect(persisted).resolves.toMatchObject({
        messages: expect.arrayContaining([expect.objectContaining({ isSummary: true })]),
      });

      database = openDatabase(directory);
      database.client
        .prepare("UPDATE models SET context_limit = ?, output_reserve = NULL")
        .run(1_000);
      database.close();
      const finalOverflow = `forçar overflow final ${"z".repeat(10_000)}`;
      await append(finalOverflow, "user");
      client.send(
        JSON.stringify({
          messages: [{ content: finalOverflow, role: "user" }],
          model: provider.model,
          profileId: state.activeProfileId,
          providerId: provider.id,
          requestId: "compaction-failure",
          sessionId: state.activeSessionId,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );
      await expect(waitFor("chat.failed")).resolves.toMatchObject({
        message:
          "Esta conversa ficou grande demais para este modelo; comece uma nova sessão ou troque para um modelo com janela maior.",
        requestId: "compaction-failure",
      });
      expect(summaryRequests).toHaveLength(2);
      expect(mainRequests).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  });
});

describe("sidecar robustez", () => {
  it("executa /nota com uma única chamada, sem expor resposta intermediária", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-nota-protocol-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "ask",
        profileName: "Nota protocol",
        profileSoul: "Profile",
        workspaceName: "Workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "nota-key",
        baseUrl: "https://nota.example/v1",
        model: "nota-model",
        name: "Nota provider",
      },
      directory,
    );
    let calls = 0;
    const requestBodies: Array<{ tools?: unknown[] }> = [];
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      calls += 1;
      if (init?.body !== undefined)
        requestBodies.push(JSON.parse(String(init.body)) as { tools?: unknown[] });
      if (calls === 1)
        return Promise.resolve(
          responseWithLines([
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        function: {
                          arguments: JSON.stringify({
                            belongsTo: null,
                            body: "Usar SQLite como fonte local.",
                            relatedTo: [],
                            title: "Fonte local",
                            type: "Note",
                          }),
                          name: "create_vault_note",
                        },
                        id: "nota-call-1",
                        index: 0,
                      },
                    ],
                  },
                },
              ],
            })}`,
            "data: [DONE]",
          ]),
        );
      return Promise.resolve(
        responseWithLines([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "texto intermediário" } }] })}`,
          "data: [DONE]",
        ]),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const messages: Record<string, unknown>[] = [];
      const waiters = new Map<string, (message: Record<string, unknown>) => void>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const type = String(message.type ?? message.topic);
        const waiter = waiters.get(type);
        if (waiter) {
          waiters.delete(type);
          waiter(message);
        } else messages.push(message);
      });
      const waitFor = (type: string) => {
        const queued = messages.findIndex(
          (message) => String(message.type ?? message.topic) === type,
        );
        if (queued >= 0)
          return Promise.resolve(messages.splice(queued, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [
            { content: "A decisão é usar SQLite como fonte local.", role: "user" },
            { content: "Entendido.", role: "assistant" },
            { content: "/nota", role: "user" },
          ],
          model: provider.model,
          profileId: state.activeProfileId,
          providerId: provider.id,
          requestId: "nota-protocol",
          sessionId: state.activeSessionId,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );
      const completed = await waitFor("chat.completed");
      expect(completed).toMatchObject({ requestId: "nota-protocol" });
      expect(completed.content).toMatch(
        /^Salvo no Vault: Fonte local \(Blackwall Vault\/Notes\/fonte-local--[a-f0-9]{8}\.md\)\.$/,
      );
      expect(calls).toBe(2);
      expect(requestBodies.length).toBeGreaterThan(0);
      expect(requestBodies).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({ name: "search_workspace" }),
          }),
        ]),
      );
      expect(messages.some((message) => message.type === "chat.delta")).toBe(false);
      expect(messages.some((message) => message.type === "approval.requested")).toBe(false);
      expect(
        (await fetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault`)).status,
      ).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  });

  it("inicia o watcher, sincroniza alterações externas e protege o reindex", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-lifecycle-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory, { token: "lifecycle-token" });
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        profileName: "Vault lifecycle",
        profileSoul: "Profile",
        workspaceName: "Workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: {
        authorization: "Bearer lifecycle-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    const state = (await bootstrap.json()) as { activeWorkspaceId: string };
    const workspaceId = state.activeWorkspaceId;
    const unauthorized = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/vault/reindex`, {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`, [
      SIDECAR_WS_PROTOCOL,
      "lifecycle-token",
    ]);
    const messages: Record<string, unknown>[] = [];
    const waiters = new Map<string, (message: Record<string, unknown>) => void>();
    client.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      const type = String(message.type ?? message.topic);
      const waiter = waiters.get(type);
      if (waiter) {
        waiters.delete(type);
        waiter(message);
      } else messages.push(message);
    });
    const waitFor = (type: string) => {
      const queued = messages.findIndex(
        (message) => String(message.type ?? message.topic) === type,
      );
      if (queued >= 0)
        return Promise.resolve(messages.splice(queued, 1)[0] as Record<string, unknown>);
      return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
    };
    try {
      await once(client, "open");
      await waitFor("system:ready");
      await writeFile(join(workspaceRoot, "outside-edit.md"), "# Fora do app\n\nWatcher", "utf8");
      await expect(waitFor("vault.graph.updated")).resolves.toMatchObject({ workspaceId });

      const database = openDatabase(directory);
      expect(
        database.client
          .prepare("SELECT source_content AS sourceContent FROM vault_objects WHERE path = ?")
          .get("outside-edit.md"),
      ).toEqual({ sourceContent: "# Fora do app\n\nWatcher" });
      database.close();

      const reindex = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/vault/reindex`, {
        headers: { authorization: "Bearer lifecycle-token" },
        method: "POST",
      });
      expect(reindex.status).toBe(200);
      await expect(reindex.json()).resolves.toMatchObject({ indexedFiles: 1 });
    } finally {
      client.close();
    }
  });

  it("bloqueia /nota antes do provedor em workspace somente leitura", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-nota-readonly-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "read-only",
        profileName: "Nota read-only",
        profileSoul: "Profile",
        workspaceName: "Workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "readonly-key",
        baseUrl: "https://readonly.example/v1",
        model: "readonly-model",
        name: "Read-only provider",
      },
      directory,
    );
    const fetchMock = vi.fn(() =>
      Promise.reject(new Error("não deveria chamar o provedor")),
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const messages: Record<string, unknown>[] = [];
      const waiters = new Map<string, (message: Record<string, unknown>) => void>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const type = String(message.type ?? message.topic);
        const waiter = waiters.get(type);
        if (waiter) {
          waiters.delete(type);
          waiter(message);
        } else messages.push(message);
      });
      const waitFor = (type: string) => {
        const queued = messages.findIndex(
          (message) => String(message.type ?? message.topic) === type,
        );
        if (queued >= 0)
          return Promise.resolve(messages.splice(queued, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [{ content: "/nota salvar a decisão", role: "user" }],
          model: provider.model,
          profileId: state.activeProfileId,
          providerId: provider.id,
          requestId: "nota-readonly",
          sessionId: state.activeSessionId,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );
      await expect(waitFor("chat.completed")).resolves.toMatchObject({
        content: "O workspace está em modo somente leitura; a nota não foi salva.",
        requestId: "nota-readonly",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  });

  it("recusa chat com sessão e workspace de escopos diferentes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-chat-scope-"));
    const firstRoot = join(directory, "first");
    const secondRoot = join(directory, "second");
    await mkdir(firstRoot);
    await mkdir(secondRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        profileName: "Scope profile",
        profileSoul: "Profile",
        workspaceName: "First",
        workspaceRootPath: firstRoot,
        workspaceSoul: "First workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeWorkspaceId: string;
    };
    const workspaceResponse = await fetch(`${baseUrl}/v1/workspaces`, {
      body: JSON.stringify({
        name: "Second",
        profileId: state.activeProfileId,
        rootPath: secondRoot,
        soul: "Second workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const secondWorkspace = (await workspaceResponse.json()) as { workspace: { id: string } };
    const sessionResponse = await fetch(`${baseUrl}/v1/sessions`, {
      body: JSON.stringify({ workspaceId: secondWorkspace.workspace.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const secondSession = (await sessionResponse.json()) as { session: { id: string } };
    const client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
    try {
      const ready = once(client, "message");
      await once(client, "open");
      await ready;
      client.send(
        JSON.stringify({
          messages: [{ content: "teste", role: "user" }],
          profileId: state.activeProfileId,
          providerId: "provider-not-needed",
          requestId: "cross-scope-chat",
          sessionId: secondSession.session.id,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );
      const [raw] = await once(client, "message");
      expect(JSON.parse(String(raw))).toMatchObject({
        message: "A sessão não pertence ao workspace informado.",
        requestId: "cross-scope-chat",
        type: "chat.failed",
      });
    } finally {
      client.close();
    }
  });

  it("protege HTTP e WebSocket quando o processo recebe um token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-auth-"));
    directories.push(directory);
    const token = "a".repeat(64);
    const { port, server } = await createSidecar(0, directory, { token });
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;

    expect((await fetch(`${baseUrl}/v1/state`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/v1/state`, {
          headers: { authorization: "Bearer errado" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/v1/state`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);

    const rejected = new WebSocket(`ws://${SIDECAR_HOST}:${port}`, [SIDECAR_WS_PROTOCOL, "errado"]);
    const rejectedOutcome = await new Promise<number | undefined>((resolve) => {
      rejected.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      rejected.on("error", () => undefined);
    });
    expect(rejectedOutcome).toBe(401);
    rejected.terminate();

    const allowed = new WebSocket(`ws://${SIDECAR_HOST}:${port}`, [SIDECAR_WS_PROTOCOL, token]);
    await once(allowed, "open");
    allowed.close();
  });

  it("recusa upgrade WebSocket com Origin fora da allowlist e aceita origem permitida", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-origin-"));
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);

    const blocked = new WebSocket(`ws://${SIDECAR_HOST}:${port}`, {
      origin: "https://evil.example",
    });
    const outcome = await new Promise<{ code?: number; rejected: boolean }>((resolve) => {
      blocked.on("unexpected-response", (_request, response) =>
        resolve({ code: response.statusCode, rejected: true }),
      );
      blocked.on("open", () => resolve({ rejected: false }));
      blocked.on("error", () => undefined);
    });
    expect(outcome.rejected).toBe(true);
    expect(outcome.code).toBe(403);
    blocked.terminate();

    const allowed = new WebSocket(`ws://${SIDECAR_HOST}:${port}`, {
      origin: "http://localhost:1420",
    });
    // Espera abertura e mensagem em paralelo: system:ready chega junto com o
    // open e seria perdido se o listener fosse registrado depois.
    const opened = once(allowed, "open");
    const ready = once(allowed, "message");
    await opened;
    const [message] = await ready;
    expect(JSON.parse(String(message))).toMatchObject({ topic: "system:ready" });
    allowed.close();
  });

  it("chat.stop cancela um request ainda enfileirado na fila do workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stop-enqueued-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "automatic",
        profileName: "Stop enqueued test",
        profileSoul: "Profile",
        workspaceName: "Workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "stop-key",
        baseUrl: "https://stop.example/v1",
        model: "stop-model",
        name: "Stop provider",
      },
      directory,
    );
    const database = openDatabase(directory);
    database.client
      .prepare(
        "INSERT INTO models (id, provider_id, model_id, display_name, capabilities, available, protocol_preference, resolved_protocol, tool_support, tool_support_source, tool_checked_at, tool_probe_error_code, tool_mode, parallel_tool_calls, context_limit, output_reserve, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'auto', NULL, 'native', 'test', NULL, NULL, 'auto', 'disabled', ?, NULL, ?)",
      )
      .run(
        `${provider.id}:${provider.model}`,
        provider.id,
        provider.model,
        provider.model,
        "[]",
        1_000_000,
        Date.now(),
      );
    database.close();

    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let mainCalls = 0;
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      if (body.stream === false)
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "resumo" } }] }), {
            status: 200,
          }),
        );
      mainCalls += 1;
      if (mainCalls === 1) {
        // Segura o primeiro turno aberto até o teste liberar — garante que o
        // segundo request está enfileirado quando o chat.stop chega.
        return firstGate.then(() =>
          responseWithLines([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "primeira" } }] })}`,
            "data: [DONE]",
          ]),
        );
      }
      return Promise.resolve(
        responseWithLines([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "segunda" } }] })}`,
          "data: [DONE]",
        ]),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const waiters = new Map<string, (message: Record<string, unknown>) => void>();
      const received: Array<{ key: string; message: Record<string, unknown> }> = [];
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const key = `${String(message.type ?? message.topic)}:${String(message.requestId ?? "")}`;
        const waiter = waiters.get(key);
        if (waiter) {
          waiters.delete(key);
          waiter(message);
          return;
        }
        received.push({ key, message });
      });
      const waitFor = (type: string, requestId: string) => {
        const key = `${type}:${requestId}`;
        const index = received.findIndex((item) => item.key === key);
        if (index >= 0) return Promise.resolve(received.splice(index, 1)[0].message);
        return new Promise<Record<string, unknown>>((resolve) => waiters.set(key, resolve));
      };

      await once(client, "open");

      const startTurn = (requestId: string) => {
        client?.send(
          JSON.stringify({
            messages: [{ content: `turno ${requestId}`, role: "user" }],
            model: provider.model,
            profileId: state.activeProfileId,
            providerId: provider.id,
            requestId,
            sessionId: state.activeSessionId,
            type: "chat.start",
            workspaceId: state.activeWorkspaceId,
          }),
        );
      };
      void waitFor("queue.updated", "turno-a");
      startTurn("turno-a");
      await waitFor("chat.started", "turno-a");

      startTurn("turno-b");
      client.send(JSON.stringify({ requestId: "turno-b", type: "chat.stop" }));
      releaseFirst();

      await expect(waitFor("chat.completed", "turno-a")).resolves.toMatchObject({
        content: "primeira",
      });
      await expect(waitFor("chat.stopped", "turno-b")).resolves.toMatchObject({
        requestId: "turno-b",
      });
      // O turno parado nunca chegou ao provedor.
      expect(mainCalls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  });
});
describe("harness resiliente (#210): cache coerente e exit codes", () => {
  it("mutação invalida leitura em cache e exit code ≠ 0 vira tool.failed estruturado", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-cache-exit-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    await writeFile(join(workspaceRoot, "cache.txt"), "v1", "utf8");
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    void baseUrl;
    const bootstrap = await fetch(`http://${SIDECAR_HOST}:${port}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "ask",
        profileName: "Cache Exit",
        profileSoul: "Profile",
        workspaceName: "Cache ws",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "k",
        baseUrl: "https://cache-exit.example/v1",
        model: "m1",
        name: "CacheExit provider",
        type: "openai-compatible",
      },
      directory,
    );

    // Roteiro: r1 read (popula cache) → r2 patch v1→v2 → r3 MESMA leitura
    // (deve reler FS e ver v2; cache devolveria v1) → r4 comando com exit 7
    // (falha estruturada) → r5 resposta final.
    let round = 0;
    const toolCallPayload = (id: string, name: string, args: Record<string, unknown>) =>
      responseWithLines([
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: { arguments: JSON.stringify(args), name },
                    id,
                    index: 0,
                    type: "function",
                  },
                ],
              },
            },
          ],
        })}`,
        "data: [DONE]",
      ]);
    const fetchMock = (() => {
      round += 1;
      if (round === 1)
        return Promise.resolve(toolCallPayload("call-read-1", "read_file", { path: "cache.txt" }));
      if (round === 2)
        return Promise.resolve(
          toolCallPayload("call-patch-1", "apply_patch", {
            newText: "v2",
            oldText: "v1",
            path: "cache.txt",
          }),
        );
      if (round === 3)
        return Promise.resolve(toolCallPayload("call-read-2", "read_file", { path: "cache.txt" }));
      if (round === 4)
        return Promise.resolve(
          toolCallPayload("call-cmd-1", "execute_command", {
            args: ["-e", "process.exit(7)"],
            command: process.execPath,
            cwd: ".",
          }),
        );
      return Promise.resolve(
        responseWithLines([
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "turno encerrado com explicacao" } }],
          })}`,
          "data: [DONE]",
        ]),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const queued: Record<string, unknown>[] = [];
      const waiters = new Map<string, (message: Record<string, unknown>) => void>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const key = String(message.type ?? message.topic);
        // Modo ask: todo tool call pede aprovação — aprova na hora.
        if (key === "approval.requested" && client) {
          client.send(
            JSON.stringify({
              decision: "allow_once",
              requestId: message.requestId,
              type: "approval.resolve",
            }),
          );
        }
        const resolver = waiters.get(key);
        if (resolver) {
          waiters.delete(key);
          resolver(message);
        } else {
          queued.push(message);
        }
      });
      const waitFor = (type: string) => {
        const index = queued.findIndex((message) => String(message.type ?? message.topic) === type);
        if (index >= 0)
          return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [{ content: "teste cache/exit", role: "user" }],
          model: provider.model,
          providerId: provider.id,
          requestId: "req-cache-exit",
          sessionId: state.activeSessionId,
          toolBudget: 12,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );
      await waitFor("chat.started");

      const failed = await waitFor("tool.failed");
      expect((failed.result as { error?: { code?: string } }).error?.code).toBe(
        "COMMAND_EXIT_CODE",
      );

      const completed = await waitFor("chat.completed");
      expect(completed.content).toBe("turno encerrado com explicacao");

      // A segunda leitura (mesmos args da primeira) trouxe o conteúdo
      // PÓS-mutação — a mutação invalidou o cache de leitura.
      const completedResults = queued.filter(
        (message) => message.type === "tool.completed",
      ) as Array<{ result?: { content?: string; path?: string } }>;
      const reads = completedResults.filter(
        (entry) => entry.result?.path === "cache.txt" && typeof entry.result.content === "string",
      );
      expect(reads.length).toBe(2);
      expect(reads[1]?.result?.content).toBe("v2");
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  });
});

describe("harness resiliente (#210): side effect possível e fingerprints", () => {
  it("comando que falha após escrever invalida cache; erros distintos não geram hard stop", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-sideeffect-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    await writeFile(join(workspaceRoot, "alvo.txt"), "v1", "utf8");
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const bootstrap = await fetch(`http://${SIDECAR_HOST}:${port}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "automatic",
        profileName: "SideEffect",
        profileSoul: "P",
        workspaceName: "SE ws",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "W",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    // Automático nega comando; usar ask com auto-aprovação.
    await fetch(
      `http://${SIDECAR_HOST}:${port}/v1/workspaces/${state.activeWorkspaceId}/permission-mode`,
      {
        body: JSON.stringify({ mode: "ask" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const provider = await saveProvider(
      {
        apiKey: "k",
        baseUrl: "https://sideeffect.example/v1",
        model: "m-se",
        name: "SE provider",
        type: "openai-compatible",
      },
      directory,
    );

    let round = 0;
    const call = (id: string, name: string, args: Record<string, unknown>) =>
      responseWithLines([
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: { arguments: JSON.stringify(args), name },
                    id,
                    index: 0,
                    type: "function",
                  },
                ],
              },
            },
          ],
        })}`,
        "data: [DONE]",
      ]);
    const fetchMock = (() => {
      round += 1;
      if (round === 1) return Promise.resolve(call("r1", "read_file", { path: "alvo.txt" }));
      if (round === 2)
        return Promise.resolve(
          call("r2", "execute_command", {
            args: ["-e", `require('fs').writeFileSync('alvo.txt','v2'); process.exit(7)`],
            command: process.execPath,
            cwd: ".",
          }),
        );
      if (round === 3) return Promise.resolve(call("r3", "read_file", { path: "alvo.txt" }));
      if (round === 4) return Promise.resolve(call("r4", "read_file", { path: "faltando-a.md" }));
      if (round === 5) return Promise.resolve(call("r5", "read_file", { path: "faltando-b.md" }));
      return Promise.resolve(
        responseWithLines([
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "final util apos erros recuperaveis" } }],
          })}`,
          "data: [DONE]",
        ]),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const queued: Record<string, unknown>[] = [];
      const waiters = new Map<string, Array<(m: Record<string, unknown>) => void>>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const key = String(message.type ?? message.topic);
        if (key === "approval.requested") {
          client?.send(
            JSON.stringify({
              decision: "allow_once",
              requestId: message.requestId,
              type: "approval.resolve",
            }),
          );
        }
        const queue = waiters.get(key);
        if (queue && queue.length > 0) queue.shift()?.(message);
        else queued.push(message);
      });
      const waitFor = (type: string) => {
        const index = queued.findIndex((message) => String(message.type ?? message.topic) === type);
        if (index >= 0)
          return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => {
          const list = waiters.get(type) ?? [];
          list.push(resolve);
          waiters.set(type, list);
        });
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [{ content: "se", role: "user" }],
          model: provider.model,
          providerId: provider.id,
          requestId: "req-sideeffect",
          sessionId: state.activeSessionId,
          toolBudget: 16,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );

      const completed = (await waitFor("chat.completed")) as { content?: string };
      expect(completed.content).toBe("final util apos erros recuperaveis");

      // r3 devolveu o conteúdo PÓS-comando (cache invalidado pelo side effect).
      const reads = queued.filter((m) => m.type === "tool.completed") as Array<{
        result?: { content?: string };
      }>;
      const contents = reads.map((entry) => entry.result?.content).filter(Boolean);
      expect(contents).toContain("v1");
      expect(contents).toContain("v2");

      // Dois erros DIFERENTES não dispararam chat.failed de repetição.
      expect(
        queued.some(
          (message) =>
            message.type === "chat.failed" && String(message.message ?? "").includes("repetiu"),
        ),
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  }, 20_000);
});

describe("RAG sob demanda e citações no chat (#243)", () => {
  it("executa a busca híbrida/lexical real e persiste somente citações seguras", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-rag-tool-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    await writeFile(join(workspaceRoot, "nota.md"), "# Nota\n\nSQLite local verificável.", "utf8");
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "automatic",
        profileName: "RAG tool",
        profileSoul: "Profile",
        workspaceName: "RAG workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeProfileId: string;
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "rag-key",
        baseUrl: "https://rag.example/v1",
        model: "rag-model",
        name: "RAG provider",
      },
      directory,
    );
    const requestBodies: Array<{ messages?: unknown[]; tools?: unknown[] }> = [];
    let providerCalls = 0;
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body)) as {
        messages?: unknown[];
        tools?: unknown[];
      };
      requestBodies.push(body);
      if (providerCalls === 1)
        return Promise.resolve(
          toolCallResponse("rag-call-1", "search_workspace", { query: "local" }),
        );
      return Promise.resolve(
        responseWithLines([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Resposta com fonte local." } }] })}`,
          "data: [DONE]",
        ]),
      );
    }) as unknown as typeof fetch;
    const localFetch = fetch;
    vi.stubGlobal("fetch", fetchMock);

    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const queued: Record<string, unknown>[] = [];
      const waiters = new Map<string, Array<(message: Record<string, unknown>) => void>>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const type = String(message.type ?? message.topic);
        const pending = waiters.get(type);
        if (pending?.length) pending.shift()?.(message);
        else queued.push(message);
      });
      const waitFor = (type: string) => {
        const index = queued.findIndex((message) => String(message.type ?? message.topic) === type);
        if (index >= 0)
          return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => {
          const pending = waiters.get(type) ?? [];
          pending.push(resolve);
          waiters.set(type, pending);
        });
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [{ content: "Qual é o fato local?", role: "user" }],
          model: provider.model,
          profileId: state.activeProfileId,
          providerId: provider.id,
          requestId: "rag-tool-real",
          sessionId: state.activeSessionId,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );

      const completedTool = await waitFor("tool.completed");
      const result = completedTool.result as {
        mode?: string;
        results?: Array<{ citation?: Record<string, unknown> }>;
      };
      expect(result.mode).toBe("lexical");
      expect(result.results).toEqual([
        {
          citation: expect.objectContaining({
            excerpt: expect.stringContaining("SQLite local verificável"),
            path: "nota.md",
            source: "vault",
          }),
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(workspaceRoot);
      expect(JSON.stringify(result)).not.toContain("score");
      await expect(waitFor("chat.completed")).resolves.toMatchObject({
        content: "Resposta com fonte local.",
        requestId: "rag-tool-real",
      });
      expect(requestBodies[0]?.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({ name: "search_workspace" }),
          }),
        ]),
      );
      expect(providerCalls).toBe(2);

      const persistedResponse = await localFetch(
        `${baseUrl}/v1/sessions/${state.activeSessionId}/messages`,
      );
      const persisted = (await persistedResponse.json()) as {
        messages: Array<{ content: string; role: string; toolName?: string }>;
      };
      const searchMessages = persisted.messages.filter(
        (message) => message.role === "tool" && message.toolName === "search_workspace",
      );
      expect(searchMessages).toHaveLength(1);
      expect(searchMessages[0]?.content).toContain('"path":"nota.md"');
      expect(searchMessages[0]?.content).not.toContain(workspaceRoot);
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  }, 20_000);

  it("encerra a quarta busca nova com erro estruturado e sem quinto request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-rag-budget-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);
    const baseUrl = `http://${SIDECAR_HOST}:${port}`;
    const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
      body: JSON.stringify({
        locale: "pt-BR",
        permissionMode: "automatic",
        profileName: "RAG budget",
        profileSoul: "Profile",
        workspaceName: "RAG budget workspace",
        workspaceRootPath: workspaceRoot,
        workspaceSoul: "Workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const state = (await bootstrap.json()) as {
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const provider = await saveProvider(
      {
        apiKey: "rag-budget-key",
        baseUrl: "https://rag-budget.example/v1",
        model: "rag-budget-model",
        name: "RAG budget provider",
      },
      directory,
    );
    let providerCalls = 0;
    const fetchMock = vi.fn(() => {
      providerCalls += 1;
      if (providerCalls > 4) throw new Error("não deveria consultar o provedor novamente");
      return Promise.resolve(
        toolCallResponse(`rag-budget-${providerCalls}`, "search_workspace", {
          query: `consulta-${providerCalls}`,
        }),
      );
    }) as unknown as typeof fetch;
    const localFetch = fetch;
    vi.stubGlobal("fetch", fetchMock);

    let client: WebSocket | undefined;
    try {
      client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
      const queued: Record<string, unknown>[] = [];
      const waiters = new Map<string, Array<(message: Record<string, unknown>) => void>>();
      client.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        const type = String(message.type ?? message.topic);
        const pending = waiters.get(type);
        if (pending?.length) pending.shift()?.(message);
        else queued.push(message);
      });
      const waitFor = (type: string) => {
        const index = queued.findIndex((message) => String(message.type ?? message.topic) === type);
        if (index >= 0)
          return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
        return new Promise<Record<string, unknown>>((resolve) => {
          const pending = waiters.get(type) ?? [];
          pending.push(resolve);
          waiters.set(type, pending);
        });
      };
      await once(client, "open");
      await waitFor("system:ready");
      client.send(
        JSON.stringify({
          messages: [{ content: "consulte quatro vezes", role: "user" }],
          model: provider.model,
          providerId: provider.id,
          requestId: "rag-budget",
          sessionId: state.activeSessionId,
          type: "chat.start",
          workspaceId: state.activeWorkspaceId,
        }),
      );

      const failedTool = await waitFor("tool.failed");
      expect(failedTool.result).toEqual({
        error: {
          code: "search_workspace_turn_limit",
          message: "O limite de três consultas novas ao workspace por turno foi atingido.",
          retryable: false,
        },
      });
      await expect(waitFor("chat.failed")).resolves.toMatchObject({
        requestId: "rag-budget",
        message: "O limite de três consultas novas ao workspace por turno foi atingido.",
      });
      expect(providerCalls).toBe(4);

      const persistedResponse = await localFetch(
        `${baseUrl}/v1/sessions/${state.activeSessionId}/messages`,
      );
      const persisted = (await persistedResponse.json()) as {
        messages: Array<{ content: string; role: string; toolName?: string }>;
      };
      const failedSearch = persisted.messages.filter(
        (message) => message.role === "tool" && message.toolName === "search_workspace",
      );
      expect(failedSearch).toHaveLength(4);
      expect(failedSearch.at(-1)?.content).toContain('"code":"search_workspace_turn_limit"');
    } finally {
      vi.unstubAllGlobals();
      client?.close();
    }
  }, 20_000);
});
