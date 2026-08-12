// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DatabaseHandle } from "./database.js";
import { appSettings, messages, profiles, sessions, workspaces } from "./schema.js";

export type PermissionMode = "ask" | "automatic" | "read-only";
type Profile = typeof profiles.$inferSelect;
type Workspace = typeof workspaces.$inferSelect;
type Session = typeof sessions.$inferSelect;
type StoredMessage = typeof messages.$inferSelect;

export type BootstrapInput = {
  locale: string;
  profileName: string;
  profileSoul: string;
  workspaceName: string;
  workspaceRootPath: string;
  workspaceSoul: string;
  permissionMode?: PermissionMode;
};

type AppState = {
  activeProfileId: string | null;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  profiles: Profile[];
  workspaces: Workspace[];
  sessions: Session[];
  messages: StoredMessage[];
};

const settingKeys = {
  activeProfileId: "active_profile_id",
  activeWorkspaceId: "active_workspace_id",
  activeSessionId: "active_session_id",
} as const;

function now() {
  return Date.now();
}

function setting(store: DatabaseHandle, key: string): string | null {
  return store.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

function saveSetting(store: DatabaseHandle, key: string, value: string) {
  store.db
    .insert(appSettings)
    .values({ key, updatedAt: now(), value })
    .onConflictDoUpdate({ target: appSettings.key, set: { updatedAt: now(), value } })
    .run();
}

async function workspaceRoot(rootPath: string): Promise<string> {
  if (!rootPath.trim()) throw new Error("Selecione uma pasta para criar o workspace.");
  const absolutePath = resolve(rootPath);
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error("A pasta do workspace não existe ou não é um diretório.");
  }
  return absolutePath;
}

function permissionMode(value: string | undefined): PermissionMode {
  if (value === "automatic" || value === "read-only") return value;
  return "ask";
}

export function createStore(database: DatabaseHandle) {
  async function createProfile(input: { locale: string; name: string; soul: string }) {
    const name = input.name.trim();
    const soul = input.soul.trim();
    if (!name || !soul) throw new Error("Informe o nome e a Soul do perfil.");
    const timestamp = now();
    const profile: Profile = {
      createdAt: timestamp,
      id: randomUUID(),
      locale: input.locale,
      name,
      soul,
      updatedAt: timestamp,
    };
    database.db.insert(profiles).values(profile).run();
    saveSetting(database, settingKeys.activeProfileId, profile.id);
    return profile;
  }

  async function createWorkspace(input: {
    name: string;
    profileId: string;
    rootPath: string;
    soul: string;
    permissionMode?: PermissionMode;
  }) {
    const name = input.name.trim();
    const soul = input.soul.trim();
    if (!name || !soul) throw new Error("Informe o nome e a Soul do workspace.");
    const profile = database.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, input.profileId))
      .get();
    if (!profile) throw new Error("O perfil selecionado não existe.");
    const rootPath = await workspaceRoot(input.rootPath);
    const timestamp = now();
    const workspace: Workspace = {
      createdAt: timestamp,
      id: randomUUID(),
      lastOpenedAt: timestamp,
      name,
      permissionMode: permissionMode(input.permissionMode),
      profileId: input.profileId,
      rootPath,
      soul,
      updatedAt: timestamp,
    };
    database.db.insert(workspaces).values(workspace).run();
    saveSetting(database, settingKeys.activeWorkspaceId, workspace.id);
    return workspace;
  }

  function listWorkspaces(profileId: string) {
    return database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.profileId, profileId))
      .orderBy(desc(workspaces.lastOpenedAt))
      .all();
  }

  function createSession(input: { title?: string; workspaceId: string }) {
    const workspace = database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .get();
    if (!workspace) throw new Error("O workspace selecionado não existe.");
    const timestamp = now();
    const session: Session = {
      createdAt: timestamp,
      id: randomUUID(),
      selectedModel: null,
      selectedProviderId: null,
      title: input.title?.trim() || "Nova conversa",
      updatedAt: timestamp,
      workspaceId: workspace.id,
    };
    database.db.insert(sessions).values(session).run();
    saveSetting(database, settingKeys.activeSessionId, session.id);
    database.db
      .update(workspaces)
      .set({ lastOpenedAt: timestamp, updatedAt: timestamp })
      .where(eq(workspaces.id, workspace.id))
      .run();
    return session;
  }

  function listSessions(workspaceId: string) {
    return database.db
      .select()
      .from(sessions)
      .where(eq(sessions.workspaceId, workspaceId))
      .orderBy(desc(sessions.updatedAt))
      .all();
  }

  function listMessages(sessionId: string) {
    return database.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.sequence))
      .all();
  }

  function setSessionModel(sessionId: string, model: string, providerId?: string | null) {
    const session = database.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) throw new Error("A sessão selecionada não existe.");
    database.db
      .update(sessions)
      .set({
        selectedModel: model.trim() || null,
        selectedProviderId: providerId ?? null,
        updatedAt: now(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
    return database.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  }

  function appendMessage(input: {
    content: string;
    model?: string | null;
    providerId?: string | null;
    role: "assistant" | "system" | "user";
    sessionId: string;
    status?: string;
  }) {
    const session = database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .get();
    if (!session) throw new Error("A sessão selecionada não existe.");
    const lastMessage = database.db
      .select({ sequence: messages.sequence })
      .from(messages)
      .where(eq(messages.sessionId, input.sessionId))
      .orderBy(desc(messages.sequence))
      .get();
    const timestamp = now();
    const message: StoredMessage = {
      content: input.content,
      createdAt: timestamp,
      id: randomUUID(),
      model: input.model ?? null,
      providerId: input.providerId ?? null,
      role: input.role,
      sequence: (lastMessage?.sequence ?? 0) + 1,
      sessionId: input.sessionId,
      status: input.status ?? "complete",
      updatedAt: timestamp,
    };
    database.db.insert(messages).values(message).run();
    database.db
      .update(sessions)
      .set({ updatedAt: timestamp })
      .where(eq(sessions.id, session.id))
      .run();
    return message;
  }

  function getState(): AppState {
    const activeProfileId = setting(database, settingKeys.activeProfileId);
    const activeWorkspaceId = setting(database, settingKeys.activeWorkspaceId);
    const activeSessionId = setting(database, settingKeys.activeSessionId);
    const profileRows = database.db.select().from(profiles).orderBy(desc(profiles.updatedAt)).all();
    const workspaceRows = activeProfileId
      ? listWorkspaces(activeProfileId)
      : database.db.select().from(workspaces).orderBy(desc(workspaces.lastOpenedAt)).all();
    const sessionRows = activeWorkspaceId ? listSessions(activeWorkspaceId) : [];
    return {
      activeProfileId,
      activeSessionId,
      activeWorkspaceId,
      messages: activeSessionId ? listMessages(activeSessionId) : [],
      profiles: profileRows,
      sessions: sessionRows,
      workspaces: workspaceRows,
    };
  }

  async function bootstrap(input: BootstrapInput) {
    const existingProfileId = setting(database, settingKeys.activeProfileId);
    const profile = existingProfileId
      ? database.db.select().from(profiles).where(eq(profiles.id, existingProfileId)).get()
      : null;
    const selectedProfile =
      profile ??
      (await createProfile({
        locale: input.locale,
        name: input.profileName,
        soul: input.profileSoul,
      }));
    const existingWorkspace = database.db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.profileId, selectedProfile.id),
          eq(workspaces.name, input.workspaceName.trim()),
        ),
      )
      .get();
    const workspace =
      existingWorkspace ??
      (await createWorkspace({
        name: input.workspaceName,
        permissionMode: input.permissionMode,
        profileId: selectedProfile.id,
        rootPath: input.workspaceRootPath,
        soul: input.workspaceSoul,
      }));
    saveSetting(database, settingKeys.activeProfileId, selectedProfile.id);
    saveSetting(database, settingKeys.activeWorkspaceId, workspace.id);
    const currentSession =
      listSessions(workspace.id)[0] ?? createSession({ workspaceId: workspace.id });
    saveSetting(database, settingKeys.activeSessionId, currentSession.id);
    return getState();
  }

  function selectSession(id: string) {
    const session = database.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!session) throw new Error("A sessão selecionada não existe.");
    saveSetting(database, settingKeys.activeWorkspaceId, session.workspaceId);
    saveSetting(database, settingKeys.activeSessionId, session.id);
    return getState();
  }

  return {
    appendMessage,
    bootstrap,
    createProfile,
    createSession,
    createWorkspace,
    getState,
    listMessages,
    listSessions,
    listWorkspaces,
    setSessionModel,
    selectSession,
  };
}
