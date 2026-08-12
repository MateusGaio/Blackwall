// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeAttachment, saveAttachment, searchAttachments } from "./attachments.js";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("indexador local de anexos", () => {
  it("salva, pesquisa após reabrir o banco e remove um anexo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-attachments-"));
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    directories.push(directory);

    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Project",
      workspaceRootPath: workspaceRoot,
      workspaceSoul: "Workspace",
    });
    database.close();

    const input = Buffer.from("Blackwall indexa contexto local com SQLite FTS5.").toString(
      "base64",
    );
    const saved = await saveAttachment(
      {
        contentBase64: input,
        filename: "notas.md",
        mimeType: "text/markdown",
        sessionId: state.activeSessionId,
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
    );
    const storedPath = join(
      directory,
      "attachments",
      state.activeWorkspaceId as string,
      saved.id,
      "notas.md",
    );
    await expect(readFile(storedPath, "utf8")).resolves.toContain("SQLite FTS5");

    const matches = await searchAttachments(state.activeWorkspaceId as string, "SQLite", directory);
    expect(matches).toEqual([
      expect.objectContaining({
        attachmentId: saved.id,
        filename: "notas.md",
      }),
    ]);

    await removeAttachment(saved.id, directory);
    await expect(readFile(storedPath)).rejects.toThrow();
    await expect(
      searchAttachments(state.activeWorkspaceId as string, "SQLite", directory),
    ).resolves.toEqual([]);
  });
});
