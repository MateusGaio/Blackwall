// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { rebuildVaultIndex, searchVault } from "./vault-index.js";

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

    await rebuildVaultIndex(database.client, { rootPath: root, workspaceId });
    expect(
      database.client.prepare("SELECT path, title, content_hash FROM vault_objects").all(),
    ).toEqual(first);
    database.close();
  });
});
