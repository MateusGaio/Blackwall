// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { scanVault } from "./vault.js";
import { VaultTemplateService } from "./vault-templates.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("templates Markdown do Vault", () => {
  it("cria, lista, aplica placeholders e mantém template fora do índice comum", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-templates-"));
    const root = join(directory, "workspace");
    await mkdir(root);
    directories.push(directory);
    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Project",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    });
    const workspaceId = state.activeWorkspaceId as string;
    const service = new VaultTemplateService(database.client);

    const created = await service.create(workspaceId, {
      body: "# {{title}}\n\nCriado em {{date}} às {{time}}.",
      name: "Reunião",
      type: "Note",
    });
    expect(created.path).toMatch(/^Blackwall Vault\/Templates\/reuniao--[a-f0-9]{8}\.md$/);
    expect(await service.list(workspaceId)).toEqual([created]);
    await expect(readFile(join(root, created.path), "utf8")).resolves.toMatch(
      /^---\n(?:[\s\S]*\n)?template: blackwall\/v1\n(?:[\s\S]*\n)?---\n/,
    );

    const applied = await service.apply(workspaceId, created.id, { title: "Ata semanal" });
    expect(applied.note).toMatchObject({ title: "Ata semanal", type: "Note" });
    expect(applied.content).toMatch(
      /^---\n[\s\S]*\n---\n\n# Ata semanal\n\nCriado em \d{4}-\d{2}-\d{2} às \d{2}:\d{2}\.\n$/,
    );
    expect(applied.content.match(/^---\n/gm)).toHaveLength(2);

    const graph = await scanVault(root);
    expect(graph.files.map((file) => file.path)).toEqual([applied.note.path]);
    database.close();
  });

  it("rejeita frontmatter no body do editor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-templates-input-"));
    const root = join(directory, "workspace");
    await mkdir(root);
    directories.push(directory);
    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Project",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    });
    await expect(
      new VaultTemplateService(database.client).create(state.activeWorkspaceId as string, {
        body: "---\nsecret: no\n---\n\n# Body",
        name: "Inválido",
        type: "Note",
      }),
    ).rejects.toThrow("sem frontmatter adicional");
    database.close();
  });
});
