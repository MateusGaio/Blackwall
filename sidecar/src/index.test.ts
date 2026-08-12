// MIT License — Copyright (c) 2026 Mateus Gaio
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createSidecar, healthPayload, SIDECAR_HOST, startFromEnvironment } from "./index.js";

const servers: import("node:http").Server[] = [];
const directories: string[] = [];

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
    const { port, server } = await createSidecar();
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
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { server } = await startFromEnvironment();
    servers.push(server);
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it("persiste o estado do onboarding pelas rotas locais", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-api-"));
    const workspaceRoot = join(directory, "project");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const { port, server } = await createSidecar(0, directory);
    servers.push(server);

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
  });
});
