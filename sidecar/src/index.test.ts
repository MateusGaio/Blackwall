// MIT License — Copyright (c) 2026 Mateus Gaio
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
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

  it("solicita autorização e libera a leitura do workspace pelo WebSocket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-tool-api-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    await writeFile(join(workspaceRoot, "README.md"), "# Local context\n", "utf8");
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
      activeSessionId: string;
      activeWorkspaceId: string;
    };
    const client = new WebSocket(`ws://${SIDECAR_HOST}:${port}`);
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
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0] as Record<string, unknown>);
      return new Promise<Record<string, unknown>>((resolve) => waiters.set(type, resolve));
    };
    await once(client, "open");
    await waitFor("system:ready");
    client.send(
      JSON.stringify({
        args: { path: "." },
        requestId: "workspace-access-request",
        sessionId: state.activeSessionId,
        tool: "list_directory",
        type: "tool.execute",
        workspaceId: state.activeWorkspaceId,
      }),
    );
    await expect(waitFor("approval.requested")).resolves.toMatchObject({
      args: { path: "." },
      requestId: "workspace-access-request",
      tool: "list_directory",
    });
    client.send(
      JSON.stringify({
        decision: "allow_once",
        requestId: "workspace-access-request",
        type: "approval.resolve",
      }),
    );
    await expect(waitFor("tool.completed")).resolves.toMatchObject({
      result: { entries: [{ name: "README.md", type: "file" }] },
      requestId: "workspace-access-request",
    });
    client.close();
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
});
