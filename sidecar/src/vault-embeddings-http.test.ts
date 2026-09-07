// MIT License — Copyright (c) 2026 Mateus Gaio

import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { SIDECAR_WS_PROTOCOL } from "./auth.js";
import { createSidecar, SIDECAR_HOST } from "./index.js";

const servers: import("node:http").Server[] = [];
const directories: string[] = [];
const nativeFetch = globalThis.fetch;

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-embeddings-http-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const token = "e".repeat(64);
  const { port, server } = await createSidecar(0, directory, { token });
  servers.push(server);
  const baseUrl = `http://${SIDECAR_HOST}:${port}`;
  const bootstrapResponse = await nativeFetch(`${baseUrl}/v1/bootstrap`, {
    body: JSON.stringify({
      locale: "pt-BR",
      profileName: "Embeddings HTTP",
      profileSoul: "Profile",
      workspaceName: "Workspace",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
  const state = (await bootstrapResponse.json()) as {
    activeProfileId: string;
    activeWorkspaceId: string;
  };
  return { baseUrl, directory, realFetch: nativeFetch, root, state, token };
}

describe("endpoints HTTP de embeddings do Vault", () => {
  it("exige bearer, isola o workspace e não devolve chave", async () => {
    const { baseUrl, realFetch, state, token } = await fixture();
    const path = `/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`;
    await expect(realFetch(`${baseUrl}${path}`)).resolves.toMatchObject({ status: 401 });

    const empty = await realFetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      config: { state: "unconfigured", workspaceId: state.activeWorkspaceId },
    });

    const configured = await realFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({
        key: "do-not-return",
        model: "embedding-test",
        provider: "ollama",
        url: "http://ollama.test",
      }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "PUT",
    });
    const configuredBody = JSON.stringify(await configured.json());
    expect(configured.status).toBe(200);
    expect(configuredBody).not.toContain("do-not-return");
    expect(configuredBody).toContain('"state":"stale"');

    await expect(
      realFetch(`${baseUrl}/v1/workspaces/does-not-exist/vault/embeddings/config`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("reindexa Vault vazio sem chamar o provedor", async () => {
    const calls = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", calls);
    const { baseUrl, realFetch, state, token } = await fixture();
    const configPath = `/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`;
    await realFetch(`${baseUrl}${configPath}`, {
      body: JSON.stringify({
        model: "embedding-test",
        provider: "ollama",
        url: "http://ollama.test",
      }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "PUT",
    });
    const result = await realFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/reindex`,
      { headers: { authorization: `Bearer ${token}` }, method: "POST" },
    );
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      state: "ready",
      totalObjects: 0,
      vectorsWritten: 0,
    });
    expect(calls).not.toHaveBeenCalled();
  });

  it("publica evento de atualização sem texto ou path", async () => {
    const calls = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", calls);
    const { baseUrl, realFetch, state, token } = await fixture();
    const socket = new WebSocket(`ws://${SIDECAR_HOST}:${new URL(baseUrl).port}`, [
      SIDECAR_WS_PROTOCOL,
      token,
    ]);
    try {
      const readyPromise = once(socket, "message");
      await once(socket, "open");
      await readyPromise;
      const configPath = `/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`;
      await realFetch(`${baseUrl}${configPath}`, {
        body: JSON.stringify({
          model: "embedding-test",
          provider: "ollama",
          url: "http://ollama.test",
        }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "PUT",
      });
      const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
        socket.once("message", (raw) =>
          resolve(JSON.parse(String(raw)) as Record<string, unknown>),
        );
      });
      const result = await realFetch(
        `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/reindex`,
        { headers: { authorization: `Bearer ${token}` }, method: "POST" },
      );
      expect(result.status).toBe(200);
      const event = await eventPromise;
      expect(event).toMatchObject({
        state: "ready",
        type: "vault.embeddings.updated",
        workspaceId: state.activeWorkspaceId,
      });
      expect(event).not.toHaveProperty("text");
      expect(event).not.toHaveProperty("path");
    } finally {
      socket.close();
    }
  });

  it("sanitiza falha local do provedor sem expor a mensagem de conexão", async () => {
    const calls = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ollama.local:11434 connection refused"));
    vi.stubGlobal("fetch", calls);
    const { baseUrl, realFetch, root, state, token } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nConteúdo", "utf8");
    await realFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/reindex`, {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    await realFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`, {
      body: JSON.stringify({
        model: "embedding-test",
        provider: "ollama",
        url: "http://ollama.local:11434",
      }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "PUT",
    });
    const result = await realFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/reindex`,
      { headers: { authorization: `Bearer ${token}` }, method: "POST" },
    );
    const body = JSON.stringify(await result.json());
    expect(result.status).toBe(503);
    expect(body).toContain("embedding_connection_failed");
    expect(body).not.toContain("connection refused");
    expect(body).not.toContain("ollama.local");
  });

  it("sanitiza falha remota no reindex e registra apenas código", async () => {
    const calls = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ providerSecret: "do-not-leak" }), { status: 502 }),
      );
    vi.stubGlobal("fetch", calls);
    const { baseUrl, realFetch, root, state, token } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nConteúdo", "utf8");
    await realFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/reindex`, {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    await realFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`, {
      body: JSON.stringify({
        key: "remote-key",
        model: "embedding-test",
        provider: "openai-compatible",
        url: "https://remote.test/v1",
      }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "PUT",
    });
    const result = await realFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/reindex`,
      { headers: { authorization: `Bearer ${token}` }, method: "POST" },
    );
    const body = JSON.stringify(await result.json());
    expect(result.status).toBe(502);
    expect(body).toContain("embedding_provider_http_502");
    expect(body).not.toContain("do-not-leak");
    expect(body).not.toContain("remote.test");
  });
});
