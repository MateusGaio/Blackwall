// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { rebuildVaultIndex, searchVault, syncVaultIndexChanges } from "./vault-index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("índice persistente do Vault", () => {
  it("reconstrói a projeção Markdown e a busca FTS de forma determinística", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-index-"));
    const root = join(directory, "workspace");
    await mkdir(root);
    await writeFile(
      join(root, "nota.md"),
      "---\ntitle: Decisão\ntype: Note\nstatus: organized\n---\nConteúdo local-first",
      "utf8",
    );
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
    const workspaceId = state.activeWorkspaceId as string;

    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    const first = database.client
      .prepare("SELECT path, title, content_hash FROM vault_objects")
      .all();
    const firstRelations = database.client
      .prepare("SELECT kind, target_ref, resolution FROM vault_relations")
      .all();
    expect(first).toHaveLength(1);
    expect(firstRelations).toEqual([]);
    expect(searchVault(database.client, workspaceId, "local-first")[0]?.title).toBe("Decisão");
    expect(searchVault(database.client, workspaceId, "Decisão")[0]?.title).toBe("Decisão");
    expect(searchVault(database.client, workspaceId, "nota.md")[0]?.title).toBe("Decisão");
    expect(searchVault(database.client, workspaceId, "organized")[0]?.title).toBe("Decisão");

    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    expect(
      database.client.prepare("SELECT path, title, content_hash FROM vault_objects").all(),
    ).toEqual(first);
    database.close();
  });

  it("sincroniza edição, criação, remoção e relações a partir do conteúdo persistido", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-incremental-"));
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
    const workspaceId = state.activeWorkspaceId as string;

    await writeFile(join(root, "source.md"), "# Fonte\n\n[[target]]\n\nSQLite antigo", "utf8");
    await writeFile(join(root, "target.md"), "# Alvo", "utf8");
    await syncVaultIndexChanges(database.client, {
      paths: ["source.md", "target.md"],
      rootPath: root,
      workspaceId,
    });
    expect(
      database.client
        .prepare("SELECT body, source_content AS sourceContent FROM vault_objects WHERE path = ?")
        .get("source.md"),
    ).toEqual({
      body: "# Fonte\n\n[[target]]\n\nSQLite antigo",
      sourceContent: "# Fonte\n\n[[target]]\n\nSQLite antigo",
    });
    expect(database.client.prepare("SELECT resolution FROM vault_relations").all()).toEqual([
      { resolution: "resolved" },
    ]);

    const edited = "---\ntitle: Fonte editada\n---\nSQLite novo";
    await writeFile(join(root, "source.md"), edited, "utf8");
    await syncVaultIndexChanges(database.client, {
      paths: [join(root, "source.md")],
      rootPath: root,
      workspaceId,
    });
    expect(
      database.client
        .prepare(
          "SELECT title, content_hash AS contentHash, source_content AS sourceContent FROM vault_objects WHERE path = ?",
        )
        .get("source.md"),
    ).toEqual({
      contentHash: expect.any(String),
      sourceContent: edited,
      title: "Fonte editada",
    });
    expect(searchVault(database.client, workspaceId, "SQLite novo")[0]?.title).toBe(
      "Fonte editada",
    );
    expect(searchVault(database.client, workspaceId, "SQLite antigo")).toEqual([]);

    await rm(join(root, "target.md"));
    await syncVaultIndexChanges(database.client, {
      paths: ["target.md"],
      rootPath: root,
      workspaceId,
    });
    expect(
      database.client.prepare("SELECT * FROM vault_objects WHERE path = ?").get("target.md"),
    ).toBe(undefined);
    expect(database.client.prepare("SELECT resolution FROM vault_relations").all()).toEqual([]);

    await writeFile(join(root, "source.md"), "# Fonte\n\n[[renamed]]", "utf8");
    await writeFile(join(root, "renamed.md"), "# Renomeado", "utf8");
    await syncVaultIndexChanges(database.client, {
      paths: ["source.md", "renamed.md"],
      rootPath: root,
      workspaceId,
    });
    expect(database.client.prepare("SELECT resolution FROM vault_relations").all()).toEqual([
      { resolution: "resolved" },
    ]);

    await writeFile(join(root, "a.md"), "# A", "utf8");
    await writeFile(join(root, "b.md"), "# B", "utf8");
    await writeFile(join(root, "source.md"), "# Fonte\n\n[[a]]\n\n[[b]]", "utf8");
    await syncVaultIndexChanges(database.client, {
      paths: ["a.md", "b.md", "source.md"],
      rootPath: root,
      workspaceId,
    });
    expect(
      database.client
        .prepare(
          "SELECT target_ref AS targetRef, resolution FROM vault_relations ORDER BY target_ref",
        )
        .all(),
    ).toEqual([
      { resolution: "resolved", targetRef: "a" },
      { resolution: "resolved", targetRef: "b" },
    ]);
    database.close();
  });

  it("ignora paths fora do root, não-Markdown, grandes e links simbólicos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-index-safety-"));
    const root = join(directory, "workspace");
    const outside = join(directory, "outside.md");
    await mkdir(root);
    await writeFile(outside, "# Fora", "utf8");
    await writeFile(join(root, "large.md"), "x".repeat(2_000_001), "utf8");
    await writeFile(join(root, "plain.txt"), "# Texto", "utf8");
    await writeFile(join(root, "valid.md"), "# Válida", "utf8");
    let symlinkCreated = true;
    try {
      await symlink(join(root, "valid.md"), join(root, "link.md"));
    } catch {
      symlinkCreated = false;
    }
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
    const workspaceId = state.activeWorkspaceId as string;
    const result = await syncVaultIndexChanges(database.client, {
      paths: [outside, "large.md", "plain.txt", "valid.md", ...(symlinkCreated ? ["link.md"] : [])],
      rootPath: root,
      workspaceId,
    });
    expect(result.failures).toEqual([]);
    expect(database.client.prepare("SELECT path FROM vault_objects").all()).toEqual([
      { path: "valid.md" },
    ]);
    if (symlinkCreated)
      await expect(readlink(join(root, "link.md"))).resolves.toBe(join(root, "valid.md"));
    database.close();
  });
});
