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
      count: 4,
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

  it("atualiza perfil, avatar e Soul do workspace de forma persistente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-profile-settings-"));
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database);
    const state = await store.bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Soul inicial",
      workspaceName: "Projeto",
      workspaceRootPath: workspaceRoot,
      workspaceSoul: "Soul inicial do workspace",
    });
    const profile = store.updateProfile(state.activeProfileId as string, {
      avatarData: "data:image/png;base64,AAAA",
      name: "Ada Lovelace",
      soul: "Construa com clareza.",
    });
    expect(() =>
      store.updateProfile(state.activeProfileId as string, {
        avatarData: "data:text/plain;base64,AAAA",
      }),
    ).toThrow("imagem PNG");
    const unchangedAvatar = store.updateProfile(state.activeProfileId as string, {
      name: "Ada Byron Lovelace",
    });
    expect(unchangedAvatar?.avatarData).toBe("data:image/png;base64,AAAA");
    const clearedAvatar = store.updateProfile(state.activeProfileId as string, {
      avatarData: null,
    });
    expect(clearedAvatar?.avatarData).toBeNull();
    const workspace = store.setWorkspaceSoul(
      state.activeWorkspaceId as string,
      "Respeite as convenções do projeto.",
    );
    expect(profile?.avatarData).toBe("data:image/png;base64,AAAA");
    expect(profile?.name).toBe("Ada Lovelace");
    expect(() => store.setWorkspaceSoul(state.activeWorkspaceId as string, "  ")).toThrow(
      "Soul do workspace",
    );
    expect(workspace?.soul).toBe("Respeite as convenções do projeto.");
    database.close();

    const restored = openDatabase(directory);
    const restoredState = createStore(restored).getState();
    expect(restoredState.profiles[0]?.avatarData).toBeNull();
    expect(restoredState.workspaces[0]?.soul).toBe("Respeite as convenções do projeto.");
    restored.close();
  });

  it("permite trocar de perfil e sair sem apagar os perfis salvos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-profile-switch-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database);
    const first = await store.createProfile({ locale: "pt-BR", name: "Ada", soul: "Primeira" });
    const firstSession = store.createSession({ profileId: first.id });
    const second = await store.createProfile({ locale: "en", name: "Grace", soul: "Second" });
    store.createSession({ profileId: second.id });
    const selected = store.selectProfile(first.id);
    expect(selected.activeProfileId).toBe(first.id);
    expect(selected.activeSessionId).toBe(firstSession.id);
    expect(selected.profiles).toHaveLength(2);
    const signedOut = store.signOutProfile();
    expect(signedOut.activeProfileId).toBeNull();
    expect(signedOut.activeWorkspaceId).toBeNull();
    expect(signedOut.activeSessionId).toBeNull();
    expect(signedOut.profiles.map((profile) => profile.name)).toEqual(
      expect.arrayContaining(["Grace", "Ada"]),
    );
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

  it("permite iniciar sem workspace e mantém a sessão persistente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-no-workspace-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database, directory);
    const state = await store.bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "",
      workspaceRootPath: "",
      workspaceSoul: "",
      workspaceMode: "none",
    });
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.activeSessionId).toBeTruthy();
    expect(state.sessions[0]?.workspaceId).toBeNull();
    store.appendMessage({
      content: "conversa sem pasta",
      role: "user",
      sessionId: state.activeSessionId as string,
    });
    database.close();

    const restored = openDatabase(directory);
    const restoredState = createStore(restored).getState();
    expect(restoredState.activeWorkspaceId).toBeNull();
    expect(restoredState.messages[0]?.content).toBe("conversa sem pasta");
    restored.close();
  });

  it("lista no máximo 30 sessões recentes do perfil com o workspace correto", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-recent-sessions-"));
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database);
    const state = await store.bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Projeto",
      workspaceRootPath: workspaceRoot,
      workspaceSoul: "Workspace",
    });
    const profileId = state.activeProfileId as string;
    for (let index = 0; index < 32; index += 1) {
      store.createSession({ profileId, title: `Sessão ${index}`, workspaceId: null });
    }
    const recent = store.listRecentSessions(profileId);
    expect(recent).toHaveLength(30);
    expect(recent.every((session) => session.profileId === profileId)).toBe(true);
    expect(recent.every((session) => session.workspaceName === null)).toBe(true);
    expect(recent[0]?.updatedAt).toBeGreaterThanOrEqual(recent.at(-1)?.updatedAt ?? 0);
    database.close();
  });
});
