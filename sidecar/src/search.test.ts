// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentEmbeddingService } from "./attachment-embeddings.js";
import { saveAttachment } from "./attachments.js";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import type { FetchLike } from "./embeddings.js";
import { fuseRankedSearchLists, searchWorkspace } from "./search.js";
import { chunkVaultObject, VaultEmbeddingService } from "./vault-embeddings.js";
import { rebuildVaultIndex, syncVaultIndexChanges } from "./vault-index.js";

const directories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];
const services: VaultEmbeddingService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function embeddingRequest() {
  const calls: string[][] = [];
  const request = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    calls.push(body.input);
    return new Response(
      JSON.stringify({ embeddings: body.input.map((text) => [text.length, 1]) }),
      { status: 200 },
    );
  });
  return { calls, request: request as FetchLike };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-search-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    profileName: "Search",
    profileSoul: "Profile",
    workspaceName: "Workspace",
    workspaceRootPath: root,
    workspaceSoul: "Workspace",
  });
  const { calls, request } = embeddingRequest();
  const runtime = new VaultEmbeddingService(database.client, directory, request);
  services.push(runtime);
  databases.push(database);
  return {
    calls,
    database,
    directory,
    root,
    runtime,
    workspaceId: state.activeWorkspaceId as string,
  };
}

describe("busca híbrida e citações", () => {
  it("usa somente FTS5 sem configuração e devolve citações dos chunks reais", async () => {
    const { calls, database, directory, root, runtime, workspaceId } = await fixture();
    await writeFile(join(root, "nota.md"), "# Nota\n\nSQLite local verificável.", "utf8");
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    await saveAttachment(
      {
        contentBase64: Buffer.from("LanceDB local verificável.").toString("base64"),
        filename: "anexo.txt",
        workspaceId,
      },
      directory,
    );

    const result = await searchWorkspace(database.client, runtime, workspaceId, "local", 10);
    expect(result.mode).toBe("lexical");
    expect(result.semanticUnavailable).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(result.results).toEqual(
      expect.arrayContaining([
        {
          citation: expect.objectContaining({
            contentHash: expect.any(String),
            excerpt: expect.stringContaining("SQLite"),
            path: "nota.md",
            source: "vault",
          }),
        },
        {
          citation: expect.objectContaining({
            contentHash: expect.any(String),
            excerpt: "LanceDB local verificável.",
            filename: "anexo.txt",
            source: "attachment",
          }),
        },
      ]),
    );
  });

  it("gera uma embedding de consulta, funde as quatro listas e descarta vetor obsoleto", async () => {
    const { calls, database, directory, root, runtime, workspaceId } = await fixture();
    const notePath = join(root, "nota.md");
    await writeFile(notePath, "# Nota\n\nconteúdo indexado antigo.", "utf8");
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    await saveAttachment(
      {
        contentBase64: Buffer.from("conteúdo do anexo.").toString("base64"),
        filename: "anexo.txt",
        workspaceId,
      },
      directory,
    );
    await runtime.updateConfig(workspaceId, {
      model: "embedding-test",
      provider: "ollama",
      url: "http://ollama.test",
    });
    await runtime.reindex(workspaceId);
    await new AttachmentEmbeddingService(database.client, runtime).reindex(workspaceId);
    calls.splice(0);

    const hybrid = await searchWorkspace(database.client, runtime, workspaceId, "conteúdo", 10);
    expect(hybrid.mode).toBe("hybrid");
    expect(calls).toHaveLength(1);
    expect(hybrid.results.length).toBeGreaterThan(0);

    await writeFile(notePath, "# Nota\n\nconteúdo indexado atualizado.", "utf8");
    await syncVaultIndexChanges(database.client, {
      paths: ["nota.md"],
      rootPath: root,
      workspaceId,
    });
    const current = database.client
      .prepare(
        "SELECT content_hash AS contentHash FROM vault_objects WHERE workspace_id = ? AND path = ?",
      )
      .get(workspaceId, "nota.md") as { contentHash: string };
    const refreshed = await searchWorkspace(
      database.client,
      runtime,
      workspaceId,
      "atualizado",
      10,
    );
    expect(refreshed.results).toEqual(
      expect.arrayContaining([
        {
          citation: expect.objectContaining({
            contentHash: current.contentHash,
            excerpt: expect.stringContaining("atualizado"),
            source: "vault",
          }),
        },
      ]),
    );
    expect(calls).toHaveLength(2);
  });

  it("aplica RRF sem score bruto e resolve empates por origem, id e chunk", () => {
    const vault = {
      chunkIndex: 0,
      contentHash: "v",
      excerpt: "vault",
      objectId: "b",
      path: "b.md",
      source: "vault" as const,
      title: "B",
    };
    const attachment = {
      attachmentId: "a",
      chunkIndex: 0,
      contentHash: "a",
      excerpt: "attachment",
      filename: "a.txt",
      source: "attachment" as const,
    };
    const results = fuseRankedSearchLists(
      [
        [{ citation: vault, key: ["vault", "b", "0"].join("\u0000"), rank: 1 }],
        [{ citation: vault, key: ["vault", "b", "0"].join("\u0000"), rank: 1 }],
        [{ citation: attachment, key: ["attachment", "a", "0"].join("\u0000"), rank: 1 }],
      ],
      10,
    );
    expect(results).toEqual([{ citation: vault }, { citation: attachment }]);
    expect(JSON.stringify(results)).not.toContain("score");
  });

  it("mantém o chunking do Vault determinístico em 1.800 caracteres", () => {
    expect(chunkVaultObject("Nota", "x".repeat(4_000))).toEqual(
      chunkVaultObject("Nota", "x".repeat(4_000)),
    );
  });
});
