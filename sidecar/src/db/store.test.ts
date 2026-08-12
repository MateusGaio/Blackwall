// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { createStore } from "./store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("persistência local", () => {
  it("aplica WAL e restaura perfil, workspace, sessão e mensagens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-db-"));
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    directories.push(directory);

    const first = openDatabase(directory);
    const store = createStore(first);
    const state = await store.bootstrap({
      locale: "pt-BR",
      permissionMode: "ask",
      profileName: "Ada",
      profileSoul: "Soul do perfil",
      workspaceName: "Projeto",
      workspaceRootPath: workspaceRoot,
      workspaceSoul: "Soul do workspace",
    });
    const message = store.appendMessage({
      content: "mensagem persistente",
      role: "user",
      sessionId: state.activeSessionId as string,
    });
    expect(first.client.pragma("journal_mode")[0]).toEqual({ journal_mode: "wal" });
    first.close();

    const second = openDatabase(directory);
    const restored = createStore(second).getState();
    expect(restored.profiles[0]?.name).toBe("Ada");
    expect(restored.workspaces[0]?.rootPath).toBe(workspaceRoot);
    expect(restored.sessions[0]?.id).toBe(message.sessionId);
    expect(restored.messages[0]?.content).toBe("mensagem persistente");
    second.close();
  });

  it("não duplica a estrutura ao reexecutar migrações", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-migrations-"));
    directories.push(directory);
    const first = openDatabase(directory);
    first.close();
    const second = openDatabase(directory);
    expect(second.client.prepare("SELECT COUNT(*) AS count FROM _migrations").get()).toEqual({
      count: 1,
    });
    second.close();
  });

  it("exige uma pasta real para o workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-root-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database);
    const profile = await store.createProfile({ locale: "en", name: "Grace", soul: "Builder" });
    await expect(
      store.createWorkspace({
        name: "Missing",
        profileId: profile.id,
        rootPath: join(directory, "does-not-exist"),
        soul: "Workspace",
      }),
    ).rejects.toThrow("não existe");
    database.close();
  });

  it("cria um workspace web privado a partir dos Markdown selecionados", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-web-workspace-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database, directory);
    const state = await store.bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Notas",
      workspaceRootPath: "",
      workspaceSoul: "Workspace",
      workspaceFiles: [
        { content: "# Início\n\n[[Segundo]]", relativePath: "Início.md" },
        { content: "# Segundo", relativePath: "Segundo.md" },
      ],
    });
    const rootPath = state.workspaces[0]?.rootPath;
    expect(rootPath).toContain("web-workspaces");
    await expect(readFile(join(rootPath as string, "Início.md"), "utf8")).resolves.toContain(
      "[[Segundo]]",
    );
    database.close();
  });
});
