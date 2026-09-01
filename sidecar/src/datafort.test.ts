// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { DatafortError, DatafortService } from "./datafort.js";
import { openDatabase } from "./db/database.js";
import { applyMigrations, assertVaultSchema } from "./db/migrations.js";
import { createStore } from "./db/store.js";
import { contentHash } from "./vault-portent.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-datafort-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    profileName: "Datafort",
    profileSoul: "Profile",
    workspaceName: "Workspace",
    workspaceRootPath: root,
    workspaceSoul: "Workspace",
  });
  return {
    database,
    root,
    service: new DatafortService(database.client),
    workspaceId: state.activeWorkspaceId as string,
  };
}

describe("fundação do Datafort", () => {
  it("repara um banco legado em que a migração 15 foi marcada sem source_content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-datafort-legacy-"));
    directories.push(directory);
    const database = new Database(join(directory, "legacy.db"));
    database.exec(`
      CREATE TABLE _migrations (id INTEGER PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL);
      CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE vault_objects (row_id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, content_hash TEXT NOT NULL, source_mtime INTEGER NOT NULL, managed INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL DEFAULT '');
    `);
    database.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(1, Date.now());
    for (let id = 2; id <= 22; id += 1)
      database
        .prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
        .run(id, Date.now());
    applyMigrations(database);
    assertVaultSchema(database);
    expect(database.prepare("PRAGMA table_info(vault_objects)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "source_content" })]),
    );
    expect(database.prepare("SELECT id FROM _migrations WHERE id = 23").get()).toEqual({ id: 23 });
    database.close();
  });

  it("preserva a identidade ao mover, atualiza wikilinks e mantém o item restaurável", async () => {
    const { database, root, service, workspaceId } = await fixture();
    await writeFile(
      join(root, "linker.md"),
      "# Links\n\n[[Alpha]]\n\n```md\n[[Alpha]]\n```\n\n%% [[Alpha]] %%\n",
      "utf8",
    );
    const created = await service.createDocument(workspaceId, { title: "Alpha" });
    const before = await service.documents(workspaceId, created.path);
    const moved = await service.moveEntry(workspaceId, {
      expectedHash: created.contentHash,
      sourcePath: created.path,
      targetPath: "Blackwall Vault/Notes/Renamed.md",
    });
    expect(moved.filesUpdated).toBe(1);
    expect(moved.linksUpdated).toBe(1);
    const after = (await service.documents(workspaceId, moved.targetPath)).documents[0];
    expect(after?.fileId).toBe(before.documents[0]?.fileId);
    expect(await readFile(join(root, "linker.md"), "utf8")).toContain("[[Renamed]]");
    expect(await readFile(join(root, "linker.md"), "utf8")).toContain("[[Alpha]]\n```");

    const trashed = await service.deleteEntry(workspaceId, {
      expectedHash: after?.contentHash,
      path: moved.targetPath,
    });
    expect((await service.listTrash(workspaceId)).entries[0]).toMatchObject({
      entryId: trashed.entryId,
      fileId: after?.fileId,
    });
    await service.restoreTrash(workspaceId, trashed.entryId);
    const restored = (await service.documents(workspaceId, moved.targetPath)).documents[0];
    expect(restored?.fileId).toBe(after?.fileId);
    database.close();
  });

  it("separa modo somente leitura externo, drafts e conflitos por hash", async () => {
    const { database, root, service, workspaceId } = await fixture();
    const path = "external.md";
    await writeFile(join(root, path), "# Externa\n", "utf8");
    const document = (await service.documents(workspaceId, path)).documents[0];
    expect(document?.managed).toBe(false);
    await expect(
      service.updateDocument(workspaceId, {
        content: "# Bloqueada\n",
        expectedHash: document?.contentHash,
        fileId: document?.fileId,
        path,
      }),
    ).rejects.toMatchObject({ code: "datafort_not_writable" });
    await service.patchSettings(workspaceId, { externalMarkdownWriteEnabled: true });
    await service.saveDraft(workspaceId, {
      content: "# Rascunho\n",
      fileId: document?.fileId,
      path,
    });
    expect(await service.getDraft(workspaceId, document?.fileId ?? "")).toMatchObject({
      content: "# Rascunho\n",
    });
    await expect(
      service.updateDocument(workspaceId, {
        content: "# Conflito\n",
        expectedHash: contentHash("versão antiga"),
        fileId: document?.fileId,
        path,
      }),
    ).rejects.toBeInstanceOf(DatafortError);
    await service.updateDocument(workspaceId, {
      content: "# Editada\n",
      expectedHash: document?.contentHash,
      fileId: document?.fileId,
      path,
    });
    database.close();
  });

  it("copia anexos com nome seguro, resolve colisões e limita o preview à pasta configurada", async () => {
    const { database, service, workspaceId } = await fixture();
    const contentBase64 = Buffer.from("anexo de teste", "utf8").toString("base64");
    const first = await service.attachFile(workspaceId, {
      contentBase64,
      filename: "referencia.txt",
    });
    const second = await service.attachFile(workspaceId, {
      contentBase64,
      filename: "referencia.txt",
    });
    expect(first.attachment.path).toBe("Blackwall Vault/Attachments/referencia.txt");
    expect(second.attachment.path).toBe("Blackwall Vault/Attachments/referencia (1).txt");
    await expect(
      service.attachFile(workspaceId, { contentBase64, filename: "../fora.txt" }),
    ).rejects.toMatchObject({ code: "datafort_attachment_invalid" });
    const preview = await service.readAttachment(workspaceId, first.attachment.path);
    expect(preview.contentType).toBe("text/plain");
    expect(preview.bytes.toString("utf8")).toBe("anexo de teste");
    await expect(service.readAttachment(workspaceId, "other.txt")).rejects.toMatchObject({
      code: "datafort_path_unsafe",
    });
    database.close();
  });
});
