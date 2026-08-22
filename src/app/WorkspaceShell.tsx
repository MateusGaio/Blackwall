// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { ChatRuntimeProvider, useSidecarChat } from "../features/chat/adapter/use-sidecar-runtime";
import { ChatThread } from "../features/chat/ui/ChatThread";
import { ProviderManager } from "../features/config/components/ProviderManager";
import {
  type AppState,
  type Attachment,
  type ChatMessage,
  type ConnectedProvider,
  createSession,
  deleteSession,
  getAppState,
  getProviderUsage,
  listAttachments,
  listProviders,
  listStoredProviderModels,
  type ProviderModel,
  removeAttachment,
  renameSession,
  selectSession,
  selectWorkspace,
  setSessionModel,
  setWorkspacePermissionMode,
  uploadAttachment,
} from "../shared/api/sidecar";
import { ConfirmDialog } from "../shared/components/ConfirmDialog";
import { EnterExit } from "../shared/components/motion/EnterExit";
import { Skeleton } from "../shared/components/motion/Skeleton";
import { greetingForTime } from "./greetings";
import {
  readBooleanPreference,
  readNumberPreference,
  sidebarCollapsedPreference,
  vaultCollapsedPreference,
  vaultPanelWidthPreference,
  writeBooleanPreference,
  writeNumberPreference,
} from "./panel-preferences";
import { SessionUsageDialog } from "./SessionUsageDialog";
import { ChatHeader } from "./shell/ChatHeader";
import { Composer } from "./shell/Composer";
import { CommandPalette, RenameSessionDialog } from "./shell/Dialogs";
import { SessionsSidebar, type SidebarFocusTarget } from "./shell/SessionsSidebar";
import {
  maximumVaultWidth,
  minimumVaultWidth,
  VaultRail,
  VaultSlot,
  type VaultTab,
} from "./shell/VaultSlot";

const defaultVaultWidth = 360;

type WorkspaceShellProps = {
  appState: AppState | null;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  profileName: string;
  provider: ConnectedProvider | null;
};

export default function WorkspaceShell({
  appState,
  onDeleteProfile,
  onSignOut,
  profileName,
  provider,
}: WorkspaceShellProps) {
  const { t } = useTranslation();
  const [state, setState] = useState(appState);
  const [providers, setProviders] = useState<ConnectedProvider[]>(provider ? [provider] : []);
  const [activeProvider, setActiveProvider] = useState<ConnectedProvider | null>(provider);
  const [showSettings, setShowSettings] = useState(false);
  const [showVault, setShowVault] = useState(Boolean(appState?.activeWorkspaceId));
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readBooleanPreference(sidebarCollapsedPreference),
  );
  const [vaultCollapsed, setVaultCollapsed] = useState(() =>
    readBooleanPreference(vaultCollapsedPreference),
  );
  const [vaultTab, setVaultTab] = useState<VaultTab>("files");
  const [vaultRefreshKey, setVaultRefreshKey] = useState(0);
  const [vaultWidth, setVaultWidth] = useState(() =>
    Math.min(
      maximumVaultWidth,
      Math.max(
        minimumVaultWidth,
        readNumberPreference(vaultPanelWidthPreference, defaultVaultWidth),
      ),
    ),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [switchingSession, setSwitchingSession] = useState(false);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [resourceNotice, setResourceNotice] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [usageSummary, setUsageSummary] = useState<
    import("../shared/api/sidecar").UsageSummary | null
  >(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [showUsageDetails, setShowUsageDetails] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [sessionToRename, setSessionToRename] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachmentToRemove, setAttachmentToRemove] = useState<Attachment | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLOListElement | null>(null);
  const recentSessionsRef = useRef<HTMLElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspacePickerRef = useRef<HTMLSelectElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(appState?.activeSessionId ?? null);
  const lastAppStateRef = useRef(appState);

  const activeProfile = state?.profiles.find((profile) => profile.id === state.activeProfileId);
  const name = activeProfile?.name.trim() || profileName.trim() || t("chat.you");
  // The UI follows the profile locale, while the greeting intentionally
  // rotates through the 25-language catalogue by time period and day.
  const greeting = greetingForTime(new Date(), "mixed");
  const workspace = state?.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const activeSession = state?.sessions.find((item) => item.id === state.activeSessionId);
  const recentSessions = [...(state?.recentSessions ?? [])].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
  );
  const selectedModel =
    activeSession?.selectedModel ?? activeProvider?.model ?? models[0]?.id ?? "";
  const modelName =
    (models.find((model) => model.id === selectedModel)?.name ?? selectedModel) ||
    t("chat.selectModel");

  const {
    cancel: stopGeneration,
    editMessage,
    error: chatError,
    isRunning: isSending,
    messages,
    queuedCount,
    regenerate,
    resolveToolDecision,
    runtime,
    sendMessage,
    streamingId,
    streamingStatus,
    toolApproval,
  } = useSidecarChat({
    model: selectedModel,
    onAppStateRefreshed: (refreshed) => setState(refreshed),
    onProviderUsage: (providerId, filters) => {
      void getProviderUsage(providerId, {
        modelId: filters.modelId,
        profileId: filters.profileId ?? undefined,
        sessionId: filters.sessionId,
      })
        .then(setUsageSummary)
        .catch(() => undefined);
    },
    onVaultFileChanged: () => setVaultRefreshKey((key) => key + 1),
    profileId: state?.activeProfileId,
    providerId: activeProvider?.id ?? null,
    sessionId: state?.activeSessionId ?? null,
    storedMessages: state?.messages ?? [],
    workspaceId: workspace?.id,
  });

  function submitDraft() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    composerRef.current?.style.removeProperty("height");
    setResourceNotice("");
    sendMessage(content);
  }

  useEffect(() => {
    if (!activeProvider) {
      setUsageSummary(null);
      return;
    }
    let cancelled = false;
    void getProviderUsage(activeProvider.id, {
      modelId: selectedModel || undefined,
      profileId: state?.activeProfileId ?? undefined,
      sessionId: activeSession?.id,
    })
      .then((summary) => {
        if (!cancelled) setUsageSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setUsageSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProvider, activeSession?.id, selectedModel, state?.activeProfileId]);

  useEffect(() => {
    if (!appState || appState === lastAppStateRef.current) return;
    lastAppStateRef.current = appState;
    activeSessionIdRef.current = appState.activeSessionId;
    setState(appState);
  }, [appState]);

  useEffect(() => {
    writeBooleanPreference(sidebarCollapsedPreference, sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    writeBooleanPreference(vaultCollapsedPreference, vaultCollapsed);
  }, [vaultCollapsed]);

  useEffect(() => {
    writeNumberPreference(vaultPanelWidthPreference, vaultWidth);
  }, [vaultWidth]);

  useEffect(() => {
    void listProviders()
      .then((available) => {
        setProviders(available);
        setActiveProvider((current) =>
          current
            ? (available.find((item) => item.id === current.id) ?? available[0] ?? null)
            : (available[0] ?? null),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function closeFloatingMenus(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-session-menu]")) {
        setOpenSessionMenuId(null);
        setSessionMenuPosition(null);
      }
    }
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenSessionMenuId(null);
      setSessionMenuPosition(null);
      setShowSettings(false);
    }
    document.addEventListener("click", closeFloatingMenus);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("click", closeFloatingMenus);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  useEffect(() => {
    if (!workspace) {
      setShowVault(false);
      setAttachments([]);
    }
  }, [workspace]);

  useEffect(() => {
    if (!workspace || !activeSession) return;
    void listAttachments(workspace.id, activeSession.id)
      .then(setAttachments)
      .catch(() => undefined);
  }, [workspace, activeSession]);

  useEffect(() => {
    // React can reuse the textarea while switching sessions. Remove the
    // previous inline height so a long draft cannot enlarge a new composer.
    if (activeSession?.id) {
      setDraft("");
      composerRef.current?.style.removeProperty("height");
    }
  }, [activeSession?.id]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      messageListRef.current?.scrollTo({
        behavior: "smooth",
        top: messageListRef.current.scrollHeight,
      });
    });
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (!activeProvider) return;
    let cancelled = false;
    const selectedProviderModel = {
      capabilities: [],
      id: activeProvider.model,
      name: activeProvider.model,
    } satisfies ProviderModel;
    setModels([selectedProviderModel]);
    void listStoredProviderModels(activeProvider.id)
      .then((available) => {
        if (cancelled) return;
        const hasSelectedModel = available.some((model) => model.id === selectedProviderModel.id);
        setModels(
          available.length > 0
            ? hasSelectedModel
              ? available
              : [selectedProviderModel, ...available]
            : [selectedProviderModel],
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeProvider]);

  useEffect(() => {
    function onShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  async function changeModel(model: string) {
    if (!activeSession || !activeProvider) return;
    try {
      const session = await setSessionModel(activeSession.id, model, activeProvider.id);
      setState((current) =>
        current
          ? {
              ...current,
              recentSessions: current.recentSessions.map((item) =>
                item.id === session.id ? { ...item, ...session } : item,
              ),
              sessions: current.sessions.map((item) => (item.id === session.id ? session : item)),
            }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotChangeTheModel"));
    }
  }

  async function selectProvider(nextProvider: ConnectedProvider) {
    setActiveProvider(nextProvider);
    setModels([{ capabilities: [], id: nextProvider.model, name: nextProvider.model }]);
    if (!activeSession) return;
    try {
      const session = await setSessionModel(activeSession.id, nextProvider.model, nextProvider.id);
      setState((current) =>
        current
          ? {
              ...current,
              recentSessions: current.recentSessions.map((item) =>
                item.id === session.id ? { ...item, ...session } : item,
              ),
              sessions: current.sessions.map((item) => (item.id === session.id ? session : item)),
            }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotChangeTheProvider"));
    }
  }

  async function openSession(sessionId: string) {
    setError("");
    setOpenSessionMenuId(null);
    setSwitchingSession(true);
    try {
      const nextState = await selectSession(sessionId);
      activeSessionIdRef.current = sessionId;
      setState(nextState);
      const nextSession = nextState.sessions.find((item) => item.id === sessionId);
      setActiveProvider(
        nextSession?.selectedProviderId
          ? (providers.find((item) => item.id === nextSession.selectedProviderId) ??
              providers[0] ??
              null)
          : (providers[0] ?? null),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotOpenTheSession"));
    } finally {
      setSwitchingSession(false);
    }
  }

  async function openWorkspace(workspaceId: string) {
    if (workspaceId === workspace?.id) return;
    const wasWithoutWorkspace = !workspace;
    setError("");
    setSwitchingSession(true);
    try {
      const nextState = await selectWorkspace(workspaceId);
      activeSessionIdRef.current = nextState.activeSessionId;
      setState(nextState);
      const nextSession = nextState.sessions.find((item) => item.id === nextState.activeSessionId);
      setActiveProvider(
        nextSession?.selectedProviderId
          ? (providers.find((item) => item.id === nextSession.selectedProviderId) ??
              providers[0] ??
              null)
          : (providers[0] ?? null),
      );
      if (wasWithoutWorkspace) setShowVault(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotOpenTheWorkspace"));
    } finally {
      setSwitchingSession(false);
    }
  }

  async function newSession() {
    if (!state?.activeProfileId || isCreatingSession) return;
    setIsCreatingSession(true);
    setError("");
    try {
      const session = await createSession(workspace?.id ?? null, undefined, state.activeProfileId);
      await openSession(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotCreateTheSession"));
    } finally {
      setIsCreatingSession(false);
    }
  }

  function newWorkspace() {
    setResourceNotice("");
    setShowSettings(true);
  }

  function expandSidebar(target?: SidebarFocusTarget) {
    setSidebarCollapsed(false);
    if (!target) return;
    requestAnimationFrame(() => {
      if (target === "workspace") workspacePickerRef.current?.focus();
      if (target === "recent") recentSessionsRef.current?.focus();
      if (target === "settings") settingsButtonRef.current?.focus();
    });
  }

  function boundedVaultWidth(width: number) {
    const viewportMaximum = Math.max(
      minimumVaultWidth,
      Math.min(maximumVaultWidth, window.innerWidth - (sidebarCollapsed ? 420 : 580)),
    );
    return Math.min(viewportMaximum, Math.max(minimumVaultWidth, width));
  }

  function handleSplitLayout(layout: { [panelId: string]: number }) {
    const width = layout["bw-vault"];
    if (typeof width !== "number") return;
    setVaultWidth((current) => {
      const next = boundedVaultWidth(width);
      return Math.abs(next - current) < 0.5 ? current : next;
    });
  }

  async function activateWorkspace(created: NonNullable<typeof workspace>) {
    if (state?.workspaces.some((item) => item.id === created.id)) {
      await openWorkspace(created.id);
      return;
    }
    const session = await createSession(created.id);
    const nextState = await selectSession(session.id);
    const nextStateWithWorkspace: AppState = {
      ...nextState,
      activeSessionId: session.id,
      activeWorkspaceId: created.id,
      recentSessions: nextState.recentSessions.some((item) => item.id === session.id)
        ? nextState.recentSessions
        : [{ ...session, workspaceName: created.name }, ...nextState.recentSessions],
      sessions: nextState.sessions.some((item) => item.id === session.id)
        ? nextState.sessions
        : [session, ...nextState.sessions],
      workspaces: nextState.workspaces.some((item) => item.id === created.id)
        ? nextState.workspaces
        : [created, ...nextState.workspaces],
    };
    activeSessionIdRef.current = session.id;
    setState(nextStateWithWorkspace);
    setActiveProvider(
      session.selectedProviderId
        ? (providers.find((item) => item.id === session.selectedProviderId) ?? providers[0] ?? null)
        : (providers[0] ?? null),
    );
    setShowVault(true);
    setVaultCollapsed(false);
    setResourceNotice("");
  }

  async function rename(sessionId: string, currentTitle: string) {
    const title = renameDraft.trim();
    if (!title || title === currentTitle) {
      setSessionToRename(null);
      return;
    }
    try {
      const updated = await renameSession(sessionId, title);
      setState((current) =>
        current
          ? {
              ...current,
              recentSessions: current.recentSessions.map((item) =>
                item.id === updated.id ? { ...item, ...updated } : item,
              ),
              sessions: current.sessions.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      setSessionToRename(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível renomear a sessão.");
    }
  }

  async function remove(sessionId: string) {
    try {
      await deleteSession(sessionId);
      const refreshed = await getAppState();
      setState(refreshed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotDeleteTheSession"));
    }
  }

  async function changePermissionMode(mode: NonNullable<typeof workspace>["permissionMode"]) {
    if (!workspace) return;
    setPermissionError("");
    try {
      const updated = await setWorkspacePermissionMode(workspace.id, mode);
      setState((current) =>
        current
          ? {
              ...current,
              workspaces: current.workspaces.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Não foi possível salvar as permissões.";
      setPermissionError(message);
      setError(message);
    }
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.unableToCopyTheMessage"));
    }
  }

  async function attachFile(file: File) {
    if (!workspace || !activeSession) return;
    setAttachmentStatus(`Indexando ${file.name}…`);
    setError("");
    try {
      const attachment = await uploadAttachment(file, workspace.id, activeSession.id);
      setAttachments((current) => [...current, attachment]);
      setAttachmentStatus(`${attachment.filename} indexado localmente.`);
    } catch (reason) {
      setAttachmentStatus("");
      setError(reason instanceof Error ? reason.message : "Não foi possível indexar o anexo.");
    }
  }

  async function detachFile(attachment: Attachment) {
    try {
      await removeAttachment(attachment.id);
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setAttachmentStatus(`${attachment.filename} removido.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover o anexo.");
    }
  }

  const visibleMessages = messages.filter(
    (message) =>
      message.role !== "tool" &&
      !(message.role === "assistant" && !message.content.trim() && message.toolCalls?.length),
  );

  const chatArea = (
    <section className="workspace-main">
      <ChatHeader
        activeProvider={activeProvider}
        onOpenUsageDetails={() => {
          setUsageOpen(false);
          setShowUsageDetails(true);
        }}
        onSelectProvider={(next) => void selectProvider(next)}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onVaultClick={() => {
          if (!workspace) {
            setResourceNotice(t("chat.selectAFolderToConfigure"));
            return;
          }
          setResourceNotice("");
          setShowVault((current) => {
            if (!current) setVaultCollapsed(false);
            return !current;
          });
        }}
        providers={providers}
        sessionTitle={activeSession?.title}
        setUsageOpen={setUsageOpen}
        sidebarCollapsed={sidebarCollapsed}
        usageOpen={usageOpen}
        usageSummary={usageSummary}
        vaultActive={Boolean(workspace && showVault)}
        workspace={workspace}
      />
      <section
        className={`chat-shell ${visibleMessages.length === 0 ? "is-empty" : ""}`}
        aria-label={t("chat.conversation")}
      >
        {switchingSession && (
          <EnterExit className="px-1 pt-2" offsetPx={4} show>
            <div aria-busy="true" role="status">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-4 h-16" />
              <Skeleton className="mt-4 h-10 w-2/3" />
            </div>
          </EnterExit>
        )}
        {!switchingSession && visibleMessages.length === 0 ? (
          <div className="empty-state">
            <h1>
              {greeting}, {name}
            </h1>
            <p>{workspace ? t("chat.whatWillWeBuildToday") : t("chat.chatFreelyAddAFolder")}</p>
          </div>
        ) : (
          <ChatThread
            copiedMessageId={copiedMessageId}
            copyMessage={(message) => void copyMessage(message)}
            editingMessageDraft={editingMessageDraft}
            editingMessageId={editingMessageId}
            listRef={messageListRef}
            onEditCancel={() => setEditingMessageId(null)}
            onEditChange={setEditingMessageDraft}
            onEditSubmit={(messageId, editDraft) => {
              setEditingMessageId(null);
              void editMessage(messageId, editDraft);
            }}
            onEditingStart={(message) => {
              setEditingMessageDraft(message.content);
              setEditingMessageId(message.id);
            }}
            regenerate={() => void regenerate()}
            streamingId={streamingId}
            streamingStatus={streamingStatus}
            visibleMessages={visibleMessages}
          />
        )}
        {attachments.length > 0 && (
          <ul className="attachment-list" aria-label={t("chat.indexedAttachments")}>
            {attachments.map((attachment) => (
              <li className="attachment-chip" key={attachment.id}>
                <span>{attachment.filename}</span>
                <button
                  aria-label={`${t("chat.remove")} ${attachment.filename}`}
                  onClick={() => setAttachmentToRemove(attachment)}
                  type="button"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <EnterExit className="justify-self-start" offsetPx={4} show={queuedCount > 0}>
          <p
            className="rounded-full border border-border bg-muted px-3 py-1 font-mono text-xs text-muted-foreground"
            role="status"
          >
            {t("chat.inQueue", { count: queuedCount })}
          </p>
        </EnterExit>
        {toolApproval && (
          <section aria-live="assertive" className="tool-approval-card" role="alertdialog">
            <p className="eyebrow">{t("chat.permissionRequested")}</p>
            <strong>{toolApproval.tool}</strong>
            <pre>{JSON.stringify(toolApproval.args, null, 2)}</pre>
            <div className="workspace-access-actions">
              <button
                className="button button-primary"
                onClick={() => resolveToolDecision("allow_once")}
                type="button"
              >
                {t("chat.allowOnce")}
              </button>
              {!["apply_patch", "create_or_update_file", "execute_command"].includes(
                toolApproval.tool,
              ) && (
                <button
                  className="button button-secondary"
                  onClick={() => resolveToolDecision("allow_session")}
                  type="button"
                >
                  {t("chat.allowThisSession")}
                </button>
              )}
              <button
                className="text-button"
                onClick={() => resolveToolDecision("deny")}
                type="button"
              >
                {t("chat.deny")}
              </button>
            </div>
          </section>
        )}
        <Composer
          activeProvider={activeProvider}
          activeSessionId={activeSession?.id}
          changeModel={(model) => void changeModel(model)}
          changePermissionMode={(mode) => void changePermissionMode(mode)}
          composerRef={composerRef}
          draft={draft}
          isSending={isSending}
          modelName={modelName}
          models={models}
          onAttachFile={(file) => void attachFile(file)}
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
          permissionError={permissionError}
          selectedModel={selectedModel}
          setDraft={setDraft}
          stopGeneration={stopGeneration}
          workspace={workspace}
        />
        {attachmentStatus && <p className="attachment-status">{attachmentStatus}</p>}
        {resourceNotice && (
          <div className="resource-gate" role="alert">
            <span>{resourceNotice}</span>
            <button className="text-button" onClick={newWorkspace} type="button">
              {t("chat.addAWorkspaceInSettings")}
            </button>
          </div>
        )}
        {(error || chatError) && (
          <p className="form-error chat-error" role="alert">
            {error || chatError}
          </p>
        )}
      </section>
    </section>
  );

  return (
    <ChatRuntimeProvider runtime={runtime}>
      <main
        className={`workspace-shell ${showVault && workspace ? "has-vault" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${vaultCollapsed ? "vault-collapsed" : ""}`}
      >
        <SessionsSidebar
          activeProfile={activeProfile}
          activeSessionId={activeSession?.id}
          collapsed={sidebarCollapsed}
          expandSidebar={expandSidebar}
          hasActiveProfile={Boolean(state?.activeProfileId)}
          isCreatingSession={isCreatingSession}
          name={name}
          newSession={() => void newSession()}
          newWorkspace={() => void newWorkspace()}
          onDeleteRequest={(session) =>
            setSessionToDelete({ id: session.id, title: session.title })
          }
          onRenameRequest={(session) => {
            setRenameDraft(session.title);
            setSessionToRename({ id: session.id, title: session.title });
          }}
          onRequestCloseMenu={() => {
            setOpenSessionMenuId(null);
            setSessionMenuPosition(null);
          }}
          onToggleSessionMenu={(sessionId, position) => {
            setOpenSessionMenuId(sessionId);
            setSessionMenuPosition(position);
          }}
          openSession={(sessionId) => void openSession(sessionId)}
          openSessionMenuId={openSessionMenuId}
          openWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
          recentSessions={recentSessions}
          recentSessionsRef={recentSessionsRef}
          sessionMenuPosition={sessionMenuPosition}
          settingsButtonRef={settingsButtonRef}
          setShowSettings={setShowSettings}
          workspace={workspace}
          workspacePickerRef={workspacePickerRef}
          workspaces={state?.workspaces ?? []}
        />

        {(() => {
          const vaultOpen = Boolean(showVault && workspace && !vaultCollapsed);
          if (!workspace) {
            return chatArea;
          }
          if (vaultOpen) {
            return (
              <ResizablePanelGroup
                className="workspace-body"
                orientation="horizontal"
                onLayoutChanged={handleSplitLayout}
              >
                <ResizablePanel className="min-w-0" id="bw-main" minSize={360}>
                  {chatArea}
                </ResizablePanel>
                <ResizableHandle aria-label={t("vault.resizeVaultPanel")} />
                <ResizablePanel
                  defaultSize={vaultWidth}
                  id="bw-vault"
                  maxSize={maximumVaultWidth}
                  minSize={minimumVaultWidth}
                >
                  <VaultSlot
                    onCollapse={() => setVaultCollapsed(true)}
                    onTabChange={setVaultTab}
                    refreshKey={vaultRefreshKey}
                    tab={vaultTab}
                    workspaceId={workspace.id}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            );
          }
          return (
            <>
              {chatArea}
              {showVault && workspace && vaultCollapsed && (
                <VaultRail
                  onOpenFiles={() => {
                    setVaultTab("files");
                    setVaultCollapsed(false);
                  }}
                  onOpenGraph={() => {
                    setVaultTab("graph");
                    setVaultCollapsed(false);
                  }}
                />
              )}
            </>
          );
        })()}
        {showSettings && (
          <ProviderManager
            activeSessionId={state?.activeSessionId ?? null}
            activeWorkspaceId={state?.activeWorkspaceId ?? null}
            activeProviderId={activeProvider?.id ?? null}
            onClose={() => setShowSettings(false)}
            onDeleteProfile={onDeleteProfile}
            onProvidersChange={(next) => {
              setProviders(next);
              setActiveProvider((current) =>
                current
                  ? (next.find((item) => item.id === current.id) ?? next[0] ?? null)
                  : (next[0] ?? null),
              );
            }}
            onProfileChange={(updated) => {
              setState((current) =>
                current
                  ? {
                      ...current,
                      profiles: current.profiles.map((profile) =>
                        profile.id === updated.id ? updated : profile,
                      ),
                    }
                  : current,
              );
            }}
            onSignOut={onSignOut}
            onSelect={(next) => void selectProvider(next)}
            onWorkspaceChange={(updated) => {
              setState((current) =>
                current
                  ? {
                      ...current,
                      workspaces: current.workspaces.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    }
                  : current,
              );
            }}
            onWorkspaceSelected={activateWorkspace}
            profile={activeProfile ?? null}
            profileId={state?.activeProfileId ?? null}
            providers={providers}
            workspaces={state?.workspaces ?? []}
          />
        )}
        {showUsageDetails && (
          <SessionUsageDialog
            messages={[...messages]}
            modelName={selectedModel || t("chat.notSelected")}
            onClose={() => setShowUsageDetails(false)}
            providerName={activeProvider?.name ?? "—"}
            sessionTitle={activeSession?.title ?? t("chat.newSession")}
            summary={usageSummary}
          />
        )}
        {sessionToDelete && (
          <ConfirmDialog
            confirmLabel={t("chat.deleteSession")}
            description={t("chat.theMessagesInThisConversation")}
            onCancel={() => setSessionToDelete(null)}
            onConfirm={() => {
              const session = sessionToDelete;
              setSessionToDelete(null);
              void remove(session.id);
            }}
            headingLabel={t("chat.confirmation")}
            title={`${t("chat.delete")} ${sessionToDelete.title}?`}
          />
        )}
        {attachmentToRemove && (
          <ConfirmDialog
            confirmLabel={t("chat.removeAttachment")}
            description={t("chat.theFileAndItsLocal")}
            onCancel={() => setAttachmentToRemove(null)}
            onConfirm={() => {
              const attachment = attachmentToRemove;
              setAttachmentToRemove(null);
              void detachFile(attachment);
            }}
            headingLabel={t("chat.confirmation")}
            title={`${t("chat.remove")} ${attachmentToRemove.filename}?`}
          />
        )}
        <RenameSessionDialog
          onCancel={() => setSessionToRename(null)}
          onRenameDraftChange={setRenameDraft}
          onSubmit={(sessionId) => void rename(sessionId, sessionToRename?.title ?? "")}
          renameDraft={renameDraft}
          sessionToRename={sessionToRename}
        />
        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onOpenSession={(sessionId) => void openSession(sessionId)}
            onOpenSettings={() => setShowSettings(true)}
            paletteQuery={paletteQuery}
            recentSessions={recentSessions}
            setPaletteQuery={setPaletteQuery}
          />
        )}
      </main>
    </ChatRuntimeProvider>
  );
}
