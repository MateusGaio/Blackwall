// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import {
  parseVaultNoteCreateInput,
  parseVaultNotePatchInput,
  recoverVaultWriteOperations,
  VaultEditorError,
  VaultEditorService,
} from "./vault-editor.js";
import { rebuildVaultIndex } from "./vault-index.js";
import { contentHash } from "./vault-portent.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-editor-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    profileName: "Ada",
    profileSoul: "Profile",
    workspaceName: "Projeto",
    workspaceRootPath: root,
    workspaceSoul: "Workspace",
  });
  return { database, root, workspaceId: state.activeWorkspaceId as string };
}

function managedNote(id: string, title: string, extra = "") {
  return `---\nid: ${id}\ntitle: ${title}\ntype: Note\nstatus: organized\ncreated_at: 2026-08-31T12:00:00.000Z\nupdated_at: 2026-08-31T12:00:00.000Z\nsource: blackwall\nsource_kind: imported\ncustom_flag: preserved\n---\n\nConteúdo ${extra}`;
}

describe("editor seguro do Vault", () => {
  it("aplica a migration 21 de forma idempotente", async () => {
    const first = await fixture();
    expect(first.database.client.prepare("SELECT id FROM _migrations WHERE id = 21").get()).toEqual(
      { id: 21 },
    );
    first.database.close();
    const second = openDatabase(join(directories[0]));
    expect(
      second.client.prepare("SELECT COUNT(*) AS count FROM _migrations WHERE id = 21").get(),
    ).toEqual({ count: 1 });
    second.close();
  });

  it("cria nota gerenciada e indexa apenas depois do commit", async () => {
    const { database, root, workspaceId } = await fixture();
    const indexed: string[] = [];
    const service = new VaultEditorService(database.client, {
      onIndexed: (_workspaceId, path) => indexed.push(path),
    });
    const result = await service.create(
      workspaceId,
      parseVaultNoteCreateInput({
        body: "# Corpo seguro",
        title: "Minha nota",
        type: "Note",
      }),
    );
    expect(result.note.source).toBe("blackwall");
    expect(result.note.status).toBe("captured");
    expect(result.note.path).toMatch(/^Blackwall Vault\/Notes\/minha-nota--[a-f0-9]{8}\.md$/);
    expect(await readFile(join(root, result.note.path), "utf8")).toContain("# Corpo seguro");
    expect(indexed).toEqual([result.note.path]);
    expect(
      database.client
        .prepare("SELECT state, expected_hash AS expectedHash FROM vault_write_operations")
        .get(),
    ).toEqual({ expectedHash: null, state: "committed" });
    database.close();
  });

  it("preserva campos desconhecidos e bloqueia stale writes", async () => {
    const { database, root, workspaceId } = await fixture();
    await mkdir(join(root, "Blackwall Vault", "Notes"), { recursive: true });
    await writeFile(
      join(root, "Blackwall Vault", "Notes", "nota.md"),
      managedNote("note-1", "Nota"),
      "utf8",
    );
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    const service = new VaultEditorService(database.client);
    const before = await service.getNote(workspaceId, "note-1");
    const updated = await service.update(
      workspaceId,
      "note-1",
      parseVaultNotePatchInput({ body: "Atualizada", expectedHash: before.contentHash }),
    );
    const serialized = await readFile(join(root, updated.note.path), "utf8");
    expect(serialized).toContain("custom_flag: preserved");
    expect(serialized).toContain("source_kind: imported");
    expect(updated.note.revisionId).not.toBe(before.revisionId);
    await expect(
      service.update(
        workspaceId,
        "note-1",
        parseVaultNotePatchInput({ body: "Stale", expectedHash: before.contentHash }),
      ),
    ).rejects.toMatchObject({
      code: "vault_note_conflict",
      details: { currentHash: updated.note.contentHash },
    });
    expect(
      database.client.prepare("SELECT state FROM vault_write_operations ORDER BY created_at").all(),
    ).toEqual([{ state: "committed" }, { state: "conflict" }]);
    database.close();
  });

  it("resolve relações editáveis por IDs opacos e mantém o caminho fora da API", async () => {
    const { database, root, workspaceId } = await fixture();
    await mkdir(join(root, "Blackwall Vault", "Projects"), { recursive: true });
    await writeFile(
      join(root, "Blackwall Vault", "Projects", "projeto.md"),
      managedNote("project-1", "Projeto"),
      "utf8",
    );
    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    const service = new VaultEditorService(database.client);
    const created = await service.create(
      workspaceId,
      parseVaultNoteCreateInput({
        belongsTo: "project-1",
        body: "Ligada",
        relatedTo: [],
        title: "Ligação",
        type: "Note",
      }),
    );
    const content = await readFile(join(root, created.note.path), "utf8");
    expect(content).toContain('belongs_to: "[[Blackwall Vault/Projects/projeto|Projeto]]"');
    expect(created.note.belongsTo).toEqual({
      path: "Blackwall Vault/Projects/projeto.md",
      portentId: "project-1",
      title: "Projeto",
    });
    database.close();
  });

  it("recusa traversal, campos extras e symlink no alvo", async () => {
    expect(() => parseVaultNoteCreateInput({ body: "x", title: "x", unknown: true })).toThrow(
      VaultEditorError,
    );
    expect(() => parseVaultNotePatchInput({ body: "x", expectedHash: "../unsafe" })).toThrow(
      VaultEditorError,
    );
    const { database, root, workspaceId } = await fixture();
    await mkdir(join(root, "Blackwall Vault", "Notes"), { recursive: true });
    await writeFile(join(root, "outside.md"), managedNote("outside-1", "Fora"), "utf8");
    let created = true;
    try {
      await symlink(join(root, "outside.md"), join(root, "Blackwall Vault", "Notes", "link.md"));
    } catch {
      created = false;
    }
    if (created)
      await expect(
        new VaultEditorService(database.client).getNote(workspaceId, "outside-1"),
      ).resolves.toBeDefined();
    database.close();
  });

  it("recupera journal preparado somente por correspondência exata", async () => {
    const { database, root, workspaceId } = await fixture();
    const path = "Blackwall Vault/Notes/recovery.md";
    const content = managedNote("recovery-1", "Recovery");
    await mkdir(join(root, "Blackwall Vault", "Notes"), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
    const tempPath = "Blackwall Vault/Notes/.blackwall-vault-op-1.tmp";
    await writeFile(join(root, tempPath), "temporary", "utf8");
    database.client
      .prepare(
        `INSERT INTO vault_write_operations
         (operation_id, workspace_id, portent_id, path, operation, expected_hash, result_hash,
          temporary_path, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
      )
      .run(
        "op-1",
        workspaceId,
        "recovery-1",
        path,
        "update",
        null,
        contentHash(content),
        tempPath,
        Date.now(),
        Date.now(),
      );
    await expect(recoverVaultWriteOperations(database.client, workspaceId, root)).resolves.toEqual([
      path,
    ]);
    expect(
      database.client
        .prepare("SELECT state FROM vault_write_operations WHERE operation_id = ?")
        .get("op-1"),
    ).toEqual({ state: "committed" });
    await expect(readFile(join(root, tempPath), "utf8")).rejects.toThrow();
    database.close();
  });
});
