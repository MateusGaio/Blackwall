// MIT License — Copyright (c) 2026 Mateus Gaio
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createSidecar, healthPayload, SIDECAR_HOST, startFromEnvironment } from "./index.js";

const servers: import("node:http").Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
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
});
