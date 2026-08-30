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
  it("ignora buscas vazias sem abrir o índice", async () => {
    await expect(searchAttachments("workspace", "", "/tmp/blackwall-no-index")).resolves.toEqual(
      [],
    );
  });

  it("recusa anexos cujo binário ultrapassa 10 MiB", async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    await expect(
      saveAttachment({ contentBase64: oversized, filename: "large.txt", workspaceId: "workspace" }),
    ).rejects.toThrow("O anexo excede o limite local de 10 MB.");
  });

  it("salva, pesquisa após reabrir o banco e remove um anexo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-attachments-"));
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    directories.push(directory);

    const database = openDatabase(directory);
    const store = createStore(database);
    const state = await store.bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Project",
      workspaceRootPath: workspaceRoot,
      workspaceSoul: "Workspace",
    });
    const otherRoot = join(directory, "other-workspace");
    await mkdir(otherRoot);
    const otherWorkspace = await store.createWorkspace({
      name: "Other project",
      profileId: state.activeProfileId as string,
      rootPath: otherRoot,
      soul: "Other workspace",
    });
    const otherSession = store.createSession({ workspaceId: otherWorkspace.id });
    database.close();

    const input = Buffer.from("Blackwall indexa contexto local com SQLite FTS5.").toString(
      "base64",
    );
    await expect(
      saveAttachment(
        {
          contentBase64: input,
          filename: "cross-scope.md",
          sessionId: otherSession.id,
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).rejects.toThrow("A sessão do anexo não pertence ao workspace informado.");
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
