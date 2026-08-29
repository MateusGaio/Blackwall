// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { createVaultNote, undoVaultRevision } from "./vault-capture.js";

const directories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-capture-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  const database = openDatabase(directory);
  databases.push(database);
  directories.push(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    permissionMode: "automatic",
    profileName: "Ada",
    profileSoul: "Local",
    workspaceName: "Projeto",
    workspaceRootPath: root,
    workspaceSoul: "Local",
  });
  return { database, root, workspaceId: state.activeWorkspaceId as string };
}

describe("captura explícita no Vault", () => {
  it("escreve Portent, é idempotente e registra uma revisão", async () => {
    const { database, root, workspaceId } = await fixture();
    const first = await createVaultNote({
      belongsTo: null,
      body: "Usar SQLite como fonte local.\n\n[link](javascript:alert(1))",
      client: database.client,
      relatedTo: [],
      title: "Fonte de verdade",
      type: "Note",
      workspaceId,
      workspaceRoot: root,
    });
    expect(first.created).toBe(true);
    expect(first.path).toMatch(/^Blackwall Vault\/Notes\/fonte-de-verdade--[a-f0-9]{8}\.md$/);
    const content = await readFile(join(root, first.path), "utf8");
    expect(content).toContain("source_kind: explicit");
    expect(content).toContain("#blocked");

    const second = await createVaultNote({
      belongsTo: null,
      body: "Usar SQLite como fonte local.\n\n[link](javascript:alert(1))",
      client: database.client,
      relatedTo: [],
      title: "Fonte de verdade",
      type: "Note",
      workspaceId,
      workspaceRoot: root,
    });
    expect(second).toMatchObject({ created: false, revisionId: first.revisionId });
    expect(await readdir(join(root, "Blackwall Vault", "Notes"))).toHaveLength(1);
    expect(
      database.client
        .prepare("SELECT state FROM vault_revisions WHERE revision_id = ?")
        .get(first.revisionId),
    ).toEqual({ state: "committed" });
  });

  it("resolve relações existentes e recusa referências quebradas", async () => {
    const { database, root, workspaceId } = await fixture();
    await writeFile(
      join(root, "projeto.md"),
      "---\nid: projeto-1\ntitle: Projeto\ntype: Project\nstatus: organized\ncreated_at: 2026-08-29T00:00:00.000Z\nupdated_at: 2026-08-29T00:00:00.000Z\nsource: blackwall\n---\n",
      "utf8",
    );
    const note = await createVaultNote({
      belongsTo: "projeto-1",
      body: "Decisão do projeto.",
      client: database.client,
      relatedTo: [],
      title: "Decisão",
      type: "Event",
      workspaceId,
      workspaceRoot: root,
    });
    expect(await readFile(join(root, note.path), "utf8")).toContain("belongs_to: id:projeto-1");
    await expect(
      createVaultNote({
        belongsTo: "não-existe",
        body: "x",
        client: database.client,
        relatedTo: [],
        title: "Falha",
        type: "Note",
        workspaceId,
        workspaceRoot: root,
      }),
    ).rejects.toMatchObject({ code: "vault_relation_not_found" });
  });

  it("faz undo somente se o hash não mudou", async () => {
    const { database, root, workspaceId } = await fixture();
    const note = await createVaultNote({
      belongsTo: null,
      body: "Pode desfazer.",
      client: database.client,
      relatedTo: [],
      title: "Undo",
      type: "Note",
      workspaceId,
      workspaceRoot: root,
    });
    await expect(
      undoVaultRevision(database.client, workspaceId, root, note.revisionId),
    ).resolves.toEqual({
      revisionId: note.revisionId,
      undone: true,
    });
    await expect(readFile(join(root, note.path), "utf8")).rejects.toThrow();
    await expect(
      undoVaultRevision(database.client, workspaceId, root, note.revisionId),
    ).resolves.toEqual({
      revisionId: note.revisionId,
      undone: false,
    });
  });

  it("recusa uma revisão cujo caminho tenha escapado do workspace", async () => {
    const { database, root, workspaceId } = await fixture();
    const note = await createVaultNote({
      belongsTo: null,
      body: "Caminho sintético.",
      client: database.client,
      relatedTo: [],
      title: "Caminho",
      type: "Note",
      workspaceId,
      workspaceRoot: root,
    });
    database.client
      .prepare("UPDATE vault_revisions SET path = ? WHERE revision_id = ?")
      .run("../fora-do-workspace.md", note.revisionId);
    await expect(
      undoVaultRevision(database.client, workspaceId, root, note.revisionId),
    ).rejects.toMatchObject({ code: "vault_path_outside_workspace", status: 403 });
  });
});
