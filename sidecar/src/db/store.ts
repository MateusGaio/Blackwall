// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { ToolCall } from "../tool-contract.js";
import { type DatabaseHandle, dataDirectory } from "./database.js";
import {
  appSettings,
  attachments,
  messages,
  profiles,
  routerEntries,
  sessions,
  workspaces,
} from "./schema.js";

export type PermissionMode = "ask" | "automatic" | "read-only";
type Profile = typeof profiles.$inferSelect;
type Workspace = typeof workspaces.$inferSelect;
type Session = typeof sessions.$inferSelect;
type StoredMessageRow = typeof messages.$inferSelect;
export type StoredMessage = Omit<StoredMessageRow, "toolCalls"> & { toolCalls: ToolCall[] };
type SessionSummary = Session & { workspaceName: string | null };

export type BootstrapInput = {
  locale: string;
  profileName: string;
  profileSoul: string;
  workspaceName: string;
  workspaceRootPath: string;
  workspaceSoul: string;
  workspaceFiles?: WorkspaceFile[];
  workspaceMode?: "none" | "workspace";
  permissionMode?: PermissionMode;
};

export type WorkspaceFile = {
  content: string;
  relativePath: string;
};

const avatarDataPattern = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const maxAvatarDataLength = 3_000_000;

function normalizeAvatarData(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value.length > maxAvatarDataLength || !avatarDataPattern.test(value)) {
    throw new Error("Escolha uma imagem PNG, JPEG, WebP ou GIF de até 2 MB.");
  }
  return value;
}

type AppState = {
  activeProfileId: string | null;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  profiles: Profile[];
  recentSessions: SessionSummary[];
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
  const value = store.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
  return value || null;
}

function saveSetting(store: DatabaseHandle, key: string, value: string) {
  store.db
    .insert(appSettings)
    .values({ key, updatedAt: now(), value })
    .onConflictDoUpdate({ target: appSettings.key, set: { updatedAt: now(), value } })
    .run();
}

function deserializeMessage(row: StoredMessageRow): StoredMessage {
  let toolCalls: ToolCall[] = [];
  if (row.toolCalls) {
    try {
      const value = JSON.parse(row.toolCalls) as unknown;
      if (Array.isArray(value)) toolCalls = value as ToolCall[];
    } catch {
      toolCalls = [];
    }
  }
  return { ...row, toolCalls };
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

async function persistWorkspaceFiles(rootPath: string, files: WorkspaceFile[]) {
  const absoluteRoot = resolve(rootPath);
  const textExtensions =
    /\.(c|cpp|css|csv|go|h|html|java|js|json|jsx|md|markdown|py|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/i;
  const textNames =
    /(^|\/)(\.env\.example|cargo\.lock|dockerfile|license|makefile|package-lock\.json|pnpm-lock\.yaml|readme|yarn\.lock)$/i;
  const ignored =
    /(^|\/)(\.cache|\.git|\.next|\.pytest_cache|\.turbo|\.venv|build|coverage|dist|node_modules|out|target|vendor)(\/|$)/i;
  const selectedFiles = files
    .filter(
      (file) =>
        !ignored.test(file.relativePath) &&
        (textExtensions.test(file.relativePath) || textNames.test(file.relativePath)),
    )
    .slice(0, 500);
  for (const file of selectedFiles) {
    const target = resolve(absoluteRoot, file.relativePath);
    const relativeTarget = relative(absoluteRoot, target);
    if (relativeTarget.startsWith("..") || relativeTarget.includes(".." + "/")) continue;
    if (file.content.length > 2_000_000) continue;
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
    await writeFile(target, file.content, { encoding: "utf8", mode: 0o600 });
  }
}

export function createStore(database: DatabaseHandle, storageDirectory = dataDirectory()) {
  async function createProfile(input: { locale: string; name: string; soul: string }) {
    const name = input.name.trim();
    const soul = input.soul.trim();
    if (!name || !soul) throw new Error("Informe o nome e a Soul do perfil.");
    const timestamp = now();
    const profile: Profile = {
      avatarData: null,
      createdAt: timestamp,
      id: randomUUID(),
      locale: input.locale,
      name,
      soul,
      updatedAt: timestamp,
    };
    database.db.insert(profiles).values(profile).run();
    saveSetting(database, settingKeys.activeProfileId, profile.id);
    saveSetting(database, settingKeys.activeWorkspaceId, "");
    saveSetting(database, settingKeys.activeSessionId, "");
    return profile;
  }

  function updateProfile(
    profileId: string,
    input: { avatarData?: string | null; locale?: string; name?: string; soul?: string },
  ) {
    const profile = database.db.select().from(profiles).where(eq(profiles.id, profileId)).get();
    if (!profile) throw new Error("O perfil selecionado não existe.");
    const name = (input.name ?? profile.name).trim();
    const soul = (input.soul ?? profile.soul).trim();
    const locale = (input.locale ?? profile.locale).trim();
    if (!name || !soul || !locale) throw new Error("Informe o nome, idioma e a Soul do perfil.");
    const avatarData = normalizeAvatarData(input.avatarData);
    database.db
      .update(profiles)
      .set({
        ...(avatarData === undefined ? {} : { avatarData }),
        locale,
        name,
        soul,
        updatedAt: now(),
      })
      .where(eq(profiles.id, profileId))
      .run();
    return database.db.select().from(profiles).where(eq(profiles.id, profileId)).get();
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
    if (!name) throw new Error("Informe o nome do workspace.");
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

  async function createWebWorkspace(input: {
    files: WorkspaceFile[];
    name: string;
    permissionMode?: PermissionMode;
    profileId: string;
    soul: string;
  }) {
    const name = input.name.trim();
    const soul = input.soul.trim();
    if (!name) throw new Error("Informe o nome do workspace.");
    const profile = database.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, input.profileId))
      .get();
    if (!profile) throw new Error("O perfil selecionado não existe.");
    const id = randomUUID();
    const rootPath = join(storageDirectory, "web-workspaces", id);
    await mkdir(rootPath, { recursive: true, mode: 0o700 });
    await persistWorkspaceFiles(rootPath, input.files);
    const timestamp = now();
    const workspace: Workspace = {
      createdAt: timestamp,
      id,
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

  function createSession(input: {
    profileId?: string | null;
    title?: string;
    workspaceId?: string | null;
  }) {
    const workspace = input.workspaceId
      ? database.db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get()
      : null;
    if (input.workspaceId && !workspace) throw new Error("O workspace selecionado não existe.");
    const profileId =
      workspace?.profileId ?? input.profileId ?? setting(database, settingKeys.activeProfileId);
    if (!profileId) throw new Error("Selecione um perfil antes de criar uma sessão.");
    const timestamp = now();
    const session: Session = {
      createdAt: timestamp,
      id: randomUUID(),
      profileId,
      selectedModel: null,
      selectedProviderId: null,
      title: input.title?.trim() || "Nova conversa",
      updatedAt: timestamp,
      workspaceId: workspace?.id ?? null,
    };
    database.db.insert(sessions).values(session).run();
    saveSetting(database, settingKeys.activeSessionId, session.id);
    if (workspace) {
      database.db
        .update(workspaces)
        .set({ lastOpenedAt: timestamp, updatedAt: timestamp })
        .where(eq(workspaces.id, workspace.id))
        .run();
    }
    return session;
  }

  function listSessions(workspaceId: string | null, profileId?: string | null) {
    const conditions = [
      workspaceId ? eq(sessions.workspaceId, workspaceId) : isNull(sessions.workspaceId),
      ...(profileId ? [eq(sessions.profileId, profileId)] : []),
    ];
    return database.db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt))
      .all();
  }

  function listRecentSessions(profileId: string, limit = 30): SessionSummary[] {
    return database.db
      .select({
        createdAt: sessions.createdAt,
        id: sessions.id,
        profileId: sessions.profileId,
        selectedModel: sessions.selectedModel,
        selectedProviderId: sessions.selectedProviderId,
        title: sessions.title,
        updatedAt: sessions.updatedAt,
        workspaceId: sessions.workspaceId,
        workspaceName: workspaces.name,
      })
      .from(sessions)
      .leftJoin(workspaces, eq(sessions.workspaceId, workspaces.id))
      .where(eq(sessions.profileId, profileId))
      .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt))
      .limit(Math.max(1, Math.min(limit, 100)))
      .all();
  }

  function listMessages(sessionId: string) {
    return database.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.sequence))
      .all()
      .map(deserializeMessage);
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

  function setWorkspacePermissionMode(workspaceId: string, mode: PermissionMode) {
    const workspace = database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
    if (!workspace) throw new Error("O workspace selecionado não existe.");
    database.db
      .update(workspaces)
      .set({ permissionMode: permissionMode(mode), updatedAt: now() })
      .where(eq(workspaces.id, workspaceId))
      .run();
    return database.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  }

  function setWorkspaceSoul(workspaceId: string, soul: string) {
    const nextSoul = soul.trim();
    const workspace = database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
    if (!workspace) throw new Error("O workspace selecionado não existe.");
    database.db
      .update(workspaces)
      .set({ soul: nextSoul, updatedAt: now() })
      .where(eq(workspaces.id, workspaceId))
      .run();
    return database.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  }

  function renameSession(sessionId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error("Informe um título para a sessão.");
    const session = database.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) throw new Error("A sessão selecionada não existe.");
    database.db
      .update(sessions)
      .set({ title: nextTitle.slice(0, 120), updatedAt: now() })
      .where(eq(sessions.id, sessionId))
      .run();
    return database.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  }

  function deleteSession(sessionId: string) {
    const session = database.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) throw new Error("A sessão selecionada não existe.");
    database.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    if (setting(database, settingKeys.activeSessionId) === sessionId) {
      const replacement = listSessions(session.workspaceId, session.profileId)[0];
      if (replacement) saveSetting(database, settingKeys.activeSessionId, replacement.id);
      else saveSetting(database, settingKeys.activeSessionId, "");
    }
    return { id: sessionId };
  }

  function appendMessage(input: {
    content: string;
    isSummary?: boolean;
    model?: string | null;
    providerId?: string | null;
    role: "assistant" | "system" | "tool" | "user";
    sessionId: string;
    status?: string;
    toolCallId?: string | null;
    toolCalls?: ToolCall[] | null;
    toolName?: string | null;
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
    const messageRow: StoredMessageRow = {
      content: input.content,
      createdAt: timestamp,
      id: randomUUID(),
      isSummary: input.isSummary ?? false,
      model: input.model ?? null,
      providerId: input.providerId ?? null,
      role: input.role,
      sequence: (lastMessage?.sequence ?? 0) + 1,
      sessionId: input.sessionId,
      status: input.status ?? "complete",
      toolCalls: input.toolCalls?.length ? JSON.stringify(input.toolCalls) : null,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      updatedAt: timestamp,
    };
    database.db.insert(messages).values(messageRow).run();
    if (input.role === "user" && session.title === "Nova conversa") {
      const generatedTitle = input.content.trim().replace(/\s+/g, " ").slice(0, 56);
      if (generatedTitle) {
        database.db
          .update(sessions)
          .set({ title: generatedTitle, updatedAt: timestamp })
          .where(eq(sessions.id, session.id))
          .run();
      }
    }
    database.db
      .update(sessions)
      .set({ updatedAt: timestamp })
      .where(eq(sessions.id, session.id))
      .run();
    return deserializeMessage(messageRow);
  }

  function editUserMessage(sessionId: string, messageId: string, content: string) {
    const nextContent = content.trim();
    if (!nextContent) throw new Error("A mensagem editada não pode ficar vazia.");
    const message = database.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
      .get();
    if (message?.role !== "user") {
      throw new Error("A mensagem selecionada não pode ser editada.");
    }
    const transaction = database.client.transaction(() => {
      database.client
        .prepare("DELETE FROM messages WHERE session_id = ? AND sequence > ?")
        .run(sessionId, message.sequence);
      database.db
        .update(messages)
        .set({ content: nextContent, status: "complete", updatedAt: now() })
        .where(eq(messages.id, messageId))
        .run();
      database.db
        .update(sessions)
        .set({ title: nextContent.replace(/\s+/g, " ").slice(0, 56), updatedAt: now() })
        .where(eq(sessions.id, sessionId))
        .run();
    });
    transaction();
    return listMessages(sessionId);
  }

  function prepareRegeneration(sessionId: string) {
    const lastAssistant = database.db
      .select()
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "assistant")))
      .orderBy(desc(messages.sequence))
      .get();
    if (!lastAssistant) throw new Error("Não há resposta para regenerar.");
    database.client.prepare("DELETE FROM messages WHERE id = ?").run(lastAssistant.id);
    return listMessages(sessionId);
  }

  function getState(): AppState {
    const activeProfileId = setting(database, settingKeys.activeProfileId);
    const profileId = activeProfileId ?? "";
    const requestedWorkspaceId = activeProfileId
      ? setting(database, settingKeys.activeWorkspaceId)
      : null;
    const activeWorkspaceId = requestedWorkspaceId
      ? (database.db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(eq(workspaces.id, requestedWorkspaceId), eq(workspaces.profileId, profileId)))
          .get()?.id ?? null)
      : null;
    const profileRows = database.db.select().from(profiles).orderBy(desc(profiles.updatedAt)).all();
    const workspaceRows = activeProfileId ? listWorkspaces(activeProfileId) : [];
    const sessionRows = listSessions(activeWorkspaceId, profileId || null);
    const requestedSessionId = activeProfileId
      ? setting(database, settingKeys.activeSessionId)
      : null;
    const activeSessionId = sessionRows.some((session) => session.id === requestedSessionId)
      ? requestedSessionId
      : null;
    return {
      activeProfileId,
      activeSessionId,
      activeWorkspaceId,
      messages: activeSessionId ? listMessages(activeSessionId) : [],
      profiles: profileRows,
      recentSessions: activeProfileId ? listRecentSessions(activeProfileId) : [],
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
      input.workspaceMode === "none"
        ? null
        : (existingWorkspace ??
          (input.workspaceRootPath.trim()
            ? await createWorkspace({
                name: input.workspaceName,
                permissionMode: input.permissionMode,
                profileId: selectedProfile.id,
                rootPath: input.workspaceRootPath,
                soul: input.workspaceSoul,
              })
            : await createWebWorkspace({
                files: input.workspaceFiles ?? [],
                name: input.workspaceName,
                permissionMode: input.permissionMode,
                profileId: selectedProfile.id,
                soul: input.workspaceSoul,
              })));
    if (
      input.workspaceMode !== "none" &&
      !input.workspaceRootPath.trim() &&
      input.workspaceFiles?.length &&
      existingWorkspace
    ) {
      await persistWorkspaceFiles(existingWorkspace.rootPath, input.workspaceFiles);
    }
    saveSetting(database, settingKeys.activeProfileId, selectedProfile.id);
    saveSetting(database, settingKeys.activeWorkspaceId, workspace?.id ?? "");
    const currentSession =
      listSessions(workspace?.id ?? null, selectedProfile.id)[0] ??
      createSession({ workspaceId: workspace?.id ?? null });
    saveSetting(database, settingKeys.activeSessionId, currentSession.id);
    return getState();
  }

  function selectSession(id: string) {
    const session = database.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!session) throw new Error("A sessão selecionada não existe.");
    if (session.profileId) saveSetting(database, settingKeys.activeProfileId, session.profileId);
    saveSetting(database, settingKeys.activeWorkspaceId, session.workspaceId ?? "");
    saveSetting(database, settingKeys.activeSessionId, session.id);
    return getState();
  }

  function selectProfile(profileId: string) {
    const profile = database.db.select().from(profiles).where(eq(profiles.id, profileId)).get();
    if (!profile) throw new Error("O perfil selecionado não existe.");
    const session = database.db
      .select()
      .from(sessions)
      .where(eq(sessions.profileId, profileId))
      .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt))
      .get();
    const workspace = session
      ? session.workspaceId
        ? database.db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
        : null
      : listWorkspaces(profileId)[0];
    const activeSession =
      session ?? createSession({ profileId, workspaceId: workspace?.id ?? null });
    saveSetting(database, settingKeys.activeProfileId, profileId);
    saveSetting(database, settingKeys.activeWorkspaceId, workspace?.id ?? "");
    saveSetting(database, settingKeys.activeSessionId, activeSession.id);
    if (workspace) {
      database.db
        .update(workspaces)
        .set({ lastOpenedAt: now(), updatedAt: now() })
        .where(eq(workspaces.id, workspace.id))
        .run();
    }
    return getState();
  }

  function signOutProfile() {
    saveSetting(database, settingKeys.activeProfileId, "");
    saveSetting(database, settingKeys.activeWorkspaceId, "");
    saveSetting(database, settingKeys.activeSessionId, "");
    return getState();
  }

  async function deleteProfile(profileId: string) {
    const profile = database.db.select().from(profiles).where(eq(profiles.id, profileId)).get();
    if (!profile) throw new Error("O perfil selecionado não existe.");

    const profileWorkspaces = database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.profileId, profileId))
      .all();
    const workspaceIds = profileWorkspaces.map((workspace) => workspace.id);

    // FTS rows are not foreign-key cascades, so remove them explicitly before
    // deleting the profile-owned records. Attachment files are removed after
    // the transaction to keep the database consistent if the filesystem fails.
    const storedAttachmentPaths = workspaceIds.length
      ? (database.client
          .prepare(
            `SELECT stored_path AS storedPath FROM attachments WHERE workspace_id IN (${workspaceIds.map(() => "?").join(",")})`,
          )
          .all(...workspaceIds) as Array<{ storedPath: string }>)
      : [];
    database.client.transaction(() => {
      if (workspaceIds.length) {
        database.client
          .prepare(
            `DELETE FROM attachments_fts WHERE attachment_id IN (SELECT id FROM attachments WHERE workspace_id IN (${workspaceIds.map(() => "?").join(",")}))`,
          )
          .run(...workspaceIds);
        database.db.delete(attachments).where(eq(attachments.workspaceId, workspaceIds[0])).run();
        for (const workspaceId of workspaceIds.slice(1)) {
          database.db.delete(attachments).where(eq(attachments.workspaceId, workspaceId)).run();
        }
        database.db
          .delete(routerEntries)
          .where(eq(routerEntries.workspaceId, workspaceIds[0]))
          .run();
        for (const workspaceId of workspaceIds.slice(1)) {
          database.db.delete(routerEntries).where(eq(routerEntries.workspaceId, workspaceId)).run();
        }
        database.client
          .prepare(
            `DELETE FROM approvals WHERE workspace_id IN (${workspaceIds.map(() => "?").join(",")})`,
          )
          .run(...workspaceIds);
      }
      database.db.delete(profiles).where(eq(profiles.id, profileId)).run();
      if (setting(database, settingKeys.activeProfileId) === profileId) {
        saveSetting(database, settingKeys.activeProfileId, "");
        saveSetting(database, settingKeys.activeWorkspaceId, "");
        saveSetting(database, settingKeys.activeSessionId, "");
      }
    })();
    await Promise.all(
      storedAttachmentPaths.map((attachment) => rm(attachment.storedPath, { force: true })),
    );
    return getState();
  }

  function selectWorkspace(id: string) {
    const workspace = database.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
    if (!workspace) throw new Error("O workspace selecionado não existe.");
    const session =
      listSessions(id, workspace.profileId)[0] ??
      createSession({ profileId: workspace.profileId, workspaceId: id });
    saveSetting(database, settingKeys.activeProfileId, workspace.profileId);
    saveSetting(database, settingKeys.activeWorkspaceId, id);
    saveSetting(database, settingKeys.activeSessionId, session.id);
    database.db
      .update(workspaces)
      .set({ lastOpenedAt: now(), updatedAt: now() })
      .where(eq(workspaces.id, id))
      .run();
    return getState();
  }

  return {
    appendMessage,
    editUserMessage,
    bootstrap,
    createProfile,
    createSession,
    createWorkspace,
    createWebWorkspace,
    getState,
    listMessages,
    listRecentSessions,
    listSessions,
    listWorkspaces,
    prepareRegeneration,
    renameSession,
    deleteSession,
    deleteProfile,
    setSessionModel,
    setWorkspaceSoul,
    setWorkspacePermissionMode,
    selectSession,
    selectProfile,
    selectWorkspace,
    signOutProfile,
    updateProfile,
  };
}
