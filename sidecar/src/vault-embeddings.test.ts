// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import type { FetchLike } from "./embeddings.js";
import {
  chunkVaultObject,
  EMBEDDING_CHUNK_SIZE,
  VaultEmbeddingService,
  vaultEmbeddingTableName,
} from "./vault-embeddings.js";
import { rebuildVaultIndex, syncVaultIndexChanges } from "./vault-index.js";

const directories: string[] = [];
const services: VaultEmbeddingService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function embeddingRequest(): { calls: string[][]; request: FetchLike } {
  const calls: string[][] = [];
  const request = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    calls.push(body.input);
    return new Response(
      JSON.stringify({ embeddings: body.input.map((text) => [text.length, 1]) }),
      { status: 200 },
    );
  });
  return { calls, request };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-embeddings-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const database = openDatabase(directory);
  const store = createStore(database);
  const state = await store.bootstrap({
    locale: "pt-BR",
    profileName: "Embeddings",
    profileSoul: "Profile",
    workspaceName: "Workspace",
    workspaceRootPath: root,
    workspaceSoul: "Workspace",
  });
  return { database, root, workspaceId: state.activeWorkspaceId as string };
}

describe("runtime vetorial do Vault", () => {
  it("gera chunks estáveis limitados a 1.800 caracteres e prefixados pelo título", () => {
    const chunks = chunkVaultObject("Título", "x".repeat(4_000));
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.startsWith("Título\n\n"))).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= EMBEDDING_CHUNK_SIZE)).toBe(true);
    expect(chunks.join("").replaceAll("Título\n\n", "")).toBe("x".repeat(4_000));
    expect(chunkVaultObject("Título", "x".repeat(4_000))).toEqual(chunks);
  });

  it("reconstrói a tabela isolada, persiste os campos e não expõe a chave", async () => {
    const { database, root, workspaceId } = await fixture();
    await writeFile(join(root, "nota.md"), `# Nota\n\n${"conteúdo ".repeat(300)}`, "utf8");
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    const { calls, request } = embeddingRequest();
    const service = new VaultEmbeddingService(database.client, join(root, ".."), request);
    services.push(service);

    const configured = await service.updateConfig(workspaceId, {
      key: "embedding-secret",
      model: "embedding-test",
      provider: "ollama",
      url: "http://ollama.test:11434",
    });
    expect(configured).toMatchObject({ hasKey: true, state: "stale" });
    expect(JSON.stringify(configured)).not.toContain("embedding-secret");
    const reindexed = await service.reindex(workspaceId);
    expect(reindexed).toMatchObject({ state: "ready", totalObjects: 1 });
    expect(reindexed.vectorsWritten).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);

    const connection = await lancedb.connect(join(root, "..", "lancedb"));
    const table = await connection.openTable(vaultEmbeddingTableName(workspaceId));
    const rows = await table.query().toArray();
    expect(rows).toHaveLength(reindexed.vectorsWritten);
    expect(rows[0]).toMatchObject({
      model: "embedding-test",
      objectId: expect.any(String),
      path: "nota.md",
      text: expect.stringContaining("Nota"),
      vector: expect.anything(),
      workspaceId,
    });
    table.close();
    connection.close();

    const secretFile = await readFile(join(root, "..", "secrets.enc"), "utf8");
    expect(secretFile).not.toContain("embedding-secret");
    const removedKey = await service.updateConfig(workspaceId, {
      key: null,
      model: "embedding-test",
      provider: "ollama",
      url: "http://ollama.test:11434",
    });
    expect(removedKey.hasKey).toBe(false);
    expect((await service.getConfig(workspaceId)).hasKey).toBe(false);
    database.close();
  });

  it("atualiza e remove vetores incrementalmente sem chamar provedor na remoção", async () => {
    const { database, root, workspaceId } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nversão um", "utf8");
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    const { calls, request } = embeddingRequest();
    const service = new VaultEmbeddingService(database.client, join(root, ".."), request);
    services.push(service);
    await service.updateConfig(workspaceId, {
      model: "m",
      provider: "ollama",
      url: "http://ollama.test",
    });
    await service.reindex(workspaceId);
    expect(calls).toHaveLength(1);

    await writeFile(join(root, "nota.md"), "# Nota\n\nversão dois", "utf8");
    await syncVaultIndexChanges(database.client, {
      paths: ["nota.md"],
      rootPath: root,
      workspaceId,
    });
    await service.syncPaths(workspaceId, ["nota.md"]);
    expect(calls).toHaveLength(2);

    await rm(join(root, "nota.md"));
    await syncVaultIndexChanges(database.client, {
      paths: ["nota.md"],
      rootPath: root,
      workspaceId,
    });
    const removed = await service.syncPaths(workspaceId, ["nota.md"]);
    expect(removed.vectorsWritten).toBe(0);
    expect(calls).toHaveLength(2);
    const connection = await lancedb.connect(join(root, "..", "lancedb"));
    const table = await connection.openTable(vaultEmbeddingTableName(workspaceId));
    await expect(table.countRows()).resolves.toBe(0);
    table.close();
    connection.close();
    database.close();
  });

  it("marca stale e descarta a tabela quando modelo ou dimensão muda", async () => {
    const { database, root, workspaceId } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nconteúdo", "utf8");
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    const { request } = embeddingRequest();
    const service = new VaultEmbeddingService(database.client, join(root, ".."), request);
    services.push(service);
    await service.updateConfig(workspaceId, {
      model: "m1",
      provider: "ollama",
      url: "http://ollama.test",
    });
    await service.reindex(workspaceId);
    const changed = await service.updateConfig(workspaceId, {
      dimension: 3,
      model: "m2",
      provider: "ollama",
      url: "http://ollama.test",
    });
    expect(changed).toMatchObject({ dimension: 3, model: "m2", state: "stale" });
    const connection = await lancedb.connect(join(root, "..", "lancedb"));
    await expect(connection.tableNames()).resolves.not.toContain(
      vaultEmbeddingTableName(workspaceId),
    );
    connection.close();
    database.close();
  });

  it("reindexa Vault vazio sem fazer chamada externa", async () => {
    const { database, root, workspaceId } = await fixture();
    const request = vi.fn<typeof fetch>();
    const service = new VaultEmbeddingService(database.client, join(root, ".."), request);
    services.push(service);
    await service.updateConfig(workspaceId, {
      model: "m",
      provider: "ollama",
      url: "http://ollama.test",
    });
    await expect(service.reindex(workspaceId)).resolves.toMatchObject({
      state: "ready",
      totalObjects: 0,
      vectorsWritten: 0,
    });
    expect(request).not.toHaveBeenCalled();
    database.close();
  });
});
