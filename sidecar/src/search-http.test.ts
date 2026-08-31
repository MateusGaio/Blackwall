// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSidecar, SIDECAR_HOST } from "./index.js";

const nativeFetch = globalThis.fetch;
const servers: import("node:http").Server[] = [];
const directories: string[] = [];

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
  const directory = await mkdtemp(join(tmpdir(), "blackwall-search-http-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const token = "search-token";
  const { port, server } = await createSidecar(0, directory, { token });
  servers.push(server);
  const baseUrl = `http://${SIDECAR_HOST}:${port}`;
  const bootstrap = await nativeFetch(`${baseUrl}/v1/bootstrap`, {
    body: JSON.stringify({
      locale: "pt-BR",
      profileName: "Search HTTP",
      profileSoul: "Profile",
      workspaceName: "Workspace",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
  const state = (await bootstrap.json()) as { activeWorkspaceId: string };
  return { baseUrl, root, state, token };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("endpoint de busca híbrida", () => {
  it("exige bearer, valida entrada e valida a existência do workspace", async () => {
    const { baseUrl, state, token } = await fixture();
    const path = `/v1/workspaces/${state.activeWorkspaceId}/search`;
    await expect(nativeFetch(`${baseUrl}${path}`, { method: "POST" })).resolves.toMatchObject({
      status: 401,
    });
    const empty = await nativeFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ query: "  " }),
      headers: auth(token),
      method: "POST",
    });
    expect(empty.status).toBe(400);
    const invalidLimit = await nativeFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ limit: 21, query: "local" }),
      headers: auth(token),
      method: "POST",
    });
    expect(invalidLimit.status).toBe(400);
    const missing = await nativeFetch(`${baseUrl}/v1/workspaces/missing/search`, {
      body: JSON.stringify({ query: "local" }),
      headers: auth(token),
      method: "POST",
    });
    expect(missing.status).toBe(404);
  });

  it("retorna FTS lexical sem provider e não faz chamada externa", async () => {
    const calls = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", calls);
    const { baseUrl, root, state, token } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nBusca local verificável.", "utf8");
    await nativeFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/reindex`, {
      headers: auth(token),
      method: "POST",
    });
    const result = await nativeFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/search`, {
      body: JSON.stringify({ query: "verificável", limit: 5 }),
      headers: auth(token),
      method: "POST",
    });
    const body = (await result.json()) as {
      mode: string;
      results: Array<{ citation: { excerpt: string; path?: string; source: string } }>;
    };
    expect(result.status).toBe(200);
    expect(body.mode).toBe("lexical");
    expect(body.results[0]?.citation).toMatchObject({
      excerpt: expect.stringContaining("verificável"),
      path: "nota.md",
      source: "vault",
    });
    expect(JSON.stringify(body)).not.toContain(root);
    expect(calls).not.toHaveBeenCalled();
  });

  it("exclui captured/archived do contexto padrão e permite inclusão manual", async () => {
    const { baseUrl, root, state, token } = await fixture();
    const managed = (id: string, status: string) =>
      `---\nid: ${id}\ntitle: ${status}\ntype: Note\nstatus: ${status}\ncreated_at: 2026-08-31T12:00:00.000Z\nupdated_at: 2026-08-31T12:00:00.000Z\nsource: blackwall\n---\nconteudo lifecycle`;
    await writeFile(join(root, "organized.md"), managed("organized-1", "organized"), "utf8");
    await writeFile(join(root, "captured.md"), managed("captured-1", "captured"), "utf8");
    await writeFile(join(root, "archived.md"), managed("archived-1", "archived"), "utf8");
    await writeFile(join(root, "external.md"), "# Externa\n\nconteudo lifecycle", "utf8");
    await nativeFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/reindex`, {
      headers: auth(token),
      method: "POST",
    });
    const path = `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/search`;
    const standard = await nativeFetch(path, {
      body: JSON.stringify({ query: "lifecycle", limit: 20 }),
      headers: auth(token),
      method: "POST",
    });
    const standardBody = (await standard.json()) as {
      results: Array<{ citation: { path?: string } }>;
    };
    expect(standardBody.results.map((item) => item.citation.path).sort()).toEqual([
      "external.md",
      "organized.md",
    ]);
    const manual = await nativeFetch(path, {
      body: JSON.stringify({ includeLifecycle: true, query: "lifecycle", limit: 20 }),
      headers: auth(token),
      method: "POST",
    });
    const manualBody = (await manual.json()) as { results: Array<{ citation: { path?: string } }> };
    expect(manualBody.results.map((item) => item.citation.path).sort()).toEqual([
      "archived.md",
      "captured.md",
      "external.md",
      "organized.md",
    ]);
  });

  it("usa uma embedding de consulta no modo híbrido e degrada com código seguro", async () => {
    const calls = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", calls);
    const { baseUrl, root, state, token } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nBusca semântica local.", "utf8");
    const configPath = `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`;
    await nativeFetch(configPath, {
      body: JSON.stringify({ model: "test", provider: "ollama", url: "http://ollama.test" }),
      headers: auth(token),
      method: "PUT",
    });
    await nativeFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/reindex`,
      {
        headers: auth(token),
        method: "POST",
      },
    );
    calls.mockClear();
    const hybrid = await nativeFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/search`, {
      body: JSON.stringify({ query: "semântica" }),
      headers: auth(token),
      method: "POST",
    });
    await expect(hybrid.json()).resolves.toMatchObject({ mode: "hybrid" });
    expect(calls).toHaveBeenCalledTimes(1);

    calls.mockRejectedValue(new Error("provider-secret@remote connection refused"));
    const degraded = await nativeFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/search`,
      {
        body: JSON.stringify({ query: "semântica" }),
        headers: auth(token),
        method: "POST",
      },
    );
    const degradedBody = JSON.stringify(await degraded.json());
    expect(degraded.status).toBe(200);
    expect(degradedBody).toContain('"mode":"lexical"');
    expect(degradedBody).toContain("embedding_connection_failed");
    expect(degradedBody).not.toContain("provider-secret");
    expect(degradedBody).not.toContain("remote");
  });

  it("reindexa embeddings de anexos por endpoint e retorna somente contagens seguras", async () => {
    const calls = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", calls);
    const { baseUrl, state, token } = await fixture();
    const uploaded = await nativeFetch(`${baseUrl}/v1/attachments`, {
      body: JSON.stringify({
        contentBase64: Buffer.from("Anexo indexável.").toString("base64"),
        filename: "anexo.txt",
        workspaceId: state.activeWorkspaceId,
      }),
      headers: auth(token),
      method: "POST",
    });
    expect(uploaded.status).toBe(201);
    await nativeFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/embeddings/config`,
      {
        body: JSON.stringify({ model: "test", provider: "ollama", url: "http://ollama.test" }),
        headers: auth(token),
        method: "PUT",
      },
    );
    const reindex = await nativeFetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/attachments/embeddings/reindex`,
      { headers: auth(token), method: "POST" },
    );
    await expect(reindex.json()).resolves.toMatchObject({
      state: "ready",
      totalAttachments: 1,
      vectorsWritten: 1,
    });
  });
});
