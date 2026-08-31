// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentEmbeddingService } from "./attachment-embeddings.js";
import { removeAttachment, saveAttachment } from "./attachments.js";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import type { FetchLike } from "./embeddings.js";
import { attachmentEmbeddingTableName, VaultEmbeddingService } from "./vault-embeddings.js";

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
  const directory = await mkdtemp(join(tmpdir(), "blackwall-attachment-embeddings-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    profileName: "Attachment embeddings",
    profileSoul: "Profile",
    workspaceName: "Workspace",
    workspaceRootPath: root,
    workspaceSoul: "Workspace",
  });
  database.close();
  const reopened = openDatabase(directory);
  databases.push(reopened);
  const { calls, request } = embeddingRequest();
  const runtime = new VaultEmbeddingService(reopened.client, directory, request);
  services.push(runtime);
  return {
    calls,
    directory,
    root,
    runtime,
    workspaceId: state.activeWorkspaceId as string,
  };
}

describe("índice vetorial de anexos", () => {
  it("reindexa, reabre e remove somente os vetores do anexo", async () => {
    const { calls, directory, runtime, workspaceId } = await fixture();

    const saved = await saveAttachment(
      {
        contentBase64: Buffer.from("Anexo local com busca semântica.").toString("base64"),
        filename: "contexto.txt",
        workspaceId,
      },
      directory,
    );
    const attachments = new AttachmentEmbeddingService(
      (databases[0] as ReturnType<typeof openDatabase>).client,
      runtime,
    );
    await runtime.updateConfig(workspaceId, {
      model: "embedding-test",
      provider: "ollama",
      url: "http://ollama.test",
    });
    const indexed = await attachments.reindex(workspaceId);
    expect(indexed).toMatchObject({ state: "ready", totalAttachments: 1, vectorsWritten: 1 });
    expect(calls).toHaveLength(1);

    const connection = await lancedb.connect(join(directory, "lancedb"));
    const table = await connection.openTable(attachmentEmbeddingTableName(workspaceId));
    await expect(table.query().toArray()).resolves.toEqual([
      expect.objectContaining({
        attachmentId: saved.id,
        filename: "contexto.txt",
        text: "Anexo local com busca semântica.",
        workspaceId,
      }),
    ]);
    table.close();
    connection.close();

    await removeAttachment(saved.id, directory, {
      onRemoved: ({ attachmentId, workspaceId: removedWorkspaceId }) =>
        attachments.syncAttachment(removedWorkspaceId, attachmentId).then(() => undefined),
    });
    expect(calls).toHaveLength(1);
    const reopenedConnection = await lancedb.connect(join(directory, "lancedb"));
    const reopenedTable = await reopenedConnection.openTable(
      attachmentEmbeddingTableName(workspaceId),
    );
    await expect(reopenedTable.countRows()).resolves.toBe(0);
    reopenedTable.close();
    reopenedConnection.close();
  });

  it("não chama o provider quando embeddings não estão configurados", async () => {
    const { calls, directory, runtime, workspaceId } = await fixture();
    const saved = await saveAttachment(
      {
        contentBase64: Buffer.from("Sem provider.").toString("base64"),
        filename: "sem-provider.txt",
        workspaceId,
      },
      directory,
    );
    const service = new AttachmentEmbeddingService(
      (databases[0] as ReturnType<typeof openDatabase>).client,
      runtime,
    );
    await expect(service.syncAttachment(workspaceId, saved.id)).resolves.toMatchObject({
      state: "unconfigured",
      vectorsWritten: 0,
    });
    expect(calls).toHaveLength(0);
  });
});
