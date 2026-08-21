// MIT License — Copyright (c) 2026 Mateus Gaio
import {
  type CSSProperties,
  lazy,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { CompactIcon } from "./shell/CompactIcon";
import { Composer } from "./shell/Composer";
import { MessageList } from "./shell/MessageList";
import { SessionsSidebar, type SidebarFocusTarget } from "./shell/SessionsSidebar";
import { useStreamingChat } from "./shell/useStreamingChat";

const VaultPanel = lazy(async () => {
  const module = await import("../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type VaultTab = "files" | "graph";

const minimumVaultWidth = 300;
const maximumVaultWidth = 680;
const defaultVaultWidth = 360;

/**
 * Headline figure is the context the conversation currently occupies (the most
 * recent request), never the cumulative sum — the same measure other harnesses
 * report, and the only one that answers "how full is this conversation?".
 */
function usageBadgeLabel(
  summary: import("../shared/api/sidecar").UsageSummary | null,
  isEnglish: boolean,
) {
  const last = summary?.lastRequest;
  if (last && last.totalTokens > 0) {
    const tokens = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(last.totalTokens);
    return last.contextLimit && last.contextLimit > 0
      ? `${tokens} · ${Math.round((last.totalTokens / last.contextLimit) * 100)}%`
      : `${tokens} ${isEnglish ? "in context" : "no contexto"}`;
  }
  const restrictive = summary?.windows
    .filter((window) => window.remainingPercent !== undefined)
    .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101))[0];
  if (restrictive?.remainingPercent !== undefined)
    return `${Math.round(restrictive.remainingPercent)}% ${isEnglish ? "remaining" : "restante"}`;
  return isEnglish ? "Usage unavailable" : "Uso indisponível";
}

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
  const [isResizingVault, setIsResizingVault] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => appState?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLOListElement | null>(null);
  const recentSessionsRef = useRef<HTMLElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspacePickerRef = useRef<HTMLSelectElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(appState?.activeSessionId ?? null);
  const lastAppStateRef = useRef(appState);
  const vaultResizeRef = useRef<{ startWidth: number; startX: number } | null>(null);

  const activeProfile = state?.profiles.find((profile) => profile.id === state.activeProfileId);
  const profileLocale = state?.profiles.find(
    (profile) => profile.id === state.activeProfileId,
  )?.locale;
  const isEnglish = profileLocale === "en";
  const name = activeProfile?.name.trim() || profileName.trim() || (isEnglish ? "you" : "você");
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
    (isEnglish ? "Select model" : "Selecionar modelo");

  const {
    editMessage,
    isSending,
    regenerate,
    resolveToolDecision,
    stopGeneration,
    streamingContent,
    streamingStatus,
    submit,
    toolApproval,
  } = useStreamingChat({
    activeProvider,
    activeSessionIdRef,
    composerRef,
    draft,
    isEnglish,
    messages,
    selectedModel,
    setActiveSessionId: (sessionId) => {
      activeSessionIdRef.current = sessionId;
    },
    setDraft,
    setError,
    setMessages,
    setResourceNotice,
    setState,
    setUsageSummary,
    setVaultRefreshKey,
    state,
    workspaceId: workspace?.id,
  });

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
    setMessages(appState.messages);
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
      if (!target.closest("[data-permission-control]")) setPermissionOpen(false);
      if (!target.closest("[data-model-control]")) setModelOpen(false);
    }
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenSessionMenuId(null);
      setSessionMenuPosition(null);
      setPermissionOpen(false);
      setModelOpen(false);
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
      setPermissionOpen(false);
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
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not change the model."
            : "Não foi possível trocar o modelo.",
      );
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
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not change the provider."
            : "Não foi possível trocar o provedor.",
      );
    }
  }

  async function openSession(sessionId: string) {
    setError("");
    setOpenSessionMenuId(null);
    try {
      const nextState = await selectSession(sessionId);
      activeSessionIdRef.current = sessionId;
      setState(nextState);
      setMessages(nextState.messages);
      const nextSession = nextState.sessions.find((item) => item.id === sessionId);
      setActiveProvider(
        nextSession?.selectedProviderId
          ? (providers.find((item) => item.id === nextSession.selectedProviderId) ??
              providers[0] ??
              null)
          : (providers[0] ?? null),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not open the session."
            : "Não foi possível abrir a sessão.",
      );
    }
  }

  async function openWorkspace(workspaceId: string) {
    if (workspaceId === workspace?.id) return;
    const wasWithoutWorkspace = !workspace;
    setError("");
    try {
      const nextState = await selectWorkspace(workspaceId);
      activeSessionIdRef.current = nextState.activeSessionId;
      setState(nextState);
      setMessages(nextState.messages);
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
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not open the workspace."
            : "Não foi possível abrir o workspace.",
      );
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
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not create the session."
            : "Não foi possível criar a sessão.",
      );
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

  function startVaultResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (vaultCollapsed) return;
    event.preventDefault();
    vaultResizeRef.current = { startWidth: vaultWidth, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingVault(true);
  }

  function resizeVault(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = vaultResizeRef.current;
    if (!resize) return;
    setVaultWidth(boundedVaultWidth(resize.startWidth + resize.startX - event.clientX));
  }

  function finishVaultResize() {
    vaultResizeRef.current = null;
    setIsResizingVault(false);
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
    setMessages(nextStateWithWorkspace.messages);
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
      setMessages(refreshed.messages);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not delete the session."
            : "Não foi possível excluir a sessão.",
      );
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
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Unable to copy the message."
            : "Não foi possível copiar a mensagem.",
      );
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

  return (
    <main
      className={`workspace-shell ${showVault && workspace ? "has-vault" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${vaultCollapsed ? "vault-collapsed" : ""}`}
      style={{ "--vault-width": `${vaultWidth}px` } as CSSProperties}
    >
      <SessionsSidebar
        activeProfile={activeProfile}
        activeSessionId={activeSession?.id}
        collapsed={sidebarCollapsed}
        expandSidebar={expandSidebar}
        hasActiveProfile={Boolean(state?.activeProfileId)}
        isCreatingSession={isCreatingSession}
        isEnglish={isEnglish}
        name={name}
        newSession={() => void newSession()}
        newWorkspace={() => void newWorkspace()}
        onDeleteRequest={(session) => setSessionToDelete({ id: session.id, title: session.title })}
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

      <section className="workspace-main">
        <header className="workspace-header">
          <div className="workspace-header-primary">
            <button
              aria-expanded={!sidebarCollapsed}
              aria-label={
                sidebarCollapsed
                  ? isEnglish
                    ? "Show sidebar"
                    : "Mostrar sidebar"
                  : isEnglish
                    ? "Hide sidebar"
                    : "Esconder sidebar"
              }
              className="workspace-header-trigger"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={
                sidebarCollapsed
                  ? isEnglish
                    ? "Show sidebar"
                    : "Mostrar sidebar"
                  : isEnglish
                    ? "Hide sidebar"
                    : "Esconder sidebar"
              }
              type="button"
            >
              <CompactIcon kind="panel" />
            </button>
            <nav
              aria-label={isEnglish ? "Breadcrumb" : "Trilha de navegação"}
              className="breadcrumb"
            >
              <ol className="breadcrumb-list">
                <li className="breadcrumb-item">
                  <span className="breadcrumb-link">
                    {workspace?.name ?? (isEnglish ? "No workspace" : "Sem workspace")}
                  </span>
                </li>
                {workspace?.rootPath && (
                  <>
                    <li aria-hidden="true" className="breadcrumb-separator">
                      /
                    </li>
                    <li className="breadcrumb-item">
                      <span className="breadcrumb-page breadcrumb-path" title={workspace.rootPath}>
                        {workspace.rootPath}
                      </span>
                    </li>
                  </>
                )}
              </ol>
            </nav>
            <h1 className="thread-title">
              {activeSession?.title ?? (isEnglish ? "New conversation" : "Nova conversa")}
            </h1>
          </div>
          <div className="chat-controls">
            {providers.length > 0 ? (
              <label className="provider-selector">
                <span className="sr-only">{isEnglish ? "Provider" : "Provedor"}</span>
                <select
                  aria-label={isEnglish ? "Select provider" : "Selecionar provedor"}
                  onChange={(event) => {
                    const nextProvider = providers.find((item) => item.id === event.target.value);
                    if (nextProvider) void selectProvider(nextProvider);
                  }}
                  title={isEnglish ? "Select provider" : "Selecionar provedor"}
                  value={activeProvider?.id ?? ""}
                >
                  {providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="eyebrow">{isEnglish ? "no provider" : "sem provedor"}</p>
            )}
            {activeProvider && (
              <div className="usage-indicator-wrap">
                <button
                  aria-expanded={usageOpen}
                  className="usage-indicator"
                  onClick={() => setUsageOpen((current) => !current)}
                  title={isEnglish ? "Provider usage" : "Uso do provedor"}
                  type="button"
                >
                  {usageBadgeLabel(usageSummary, isEnglish)}
                </button>
                {usageOpen && (
                  <div className="usage-popover" role="dialog">
                    <strong>{isEnglish ? "Current context" : "Contexto atual"}</strong>
                    <span>
                      {isEnglish ? "Tokens" : "Tokens"}:{" "}
                      {(usageSummary?.lastRequest?.totalTokens ?? 0).toLocaleString()}
                      {usageSummary?.lastRequest?.contextLimit
                        ? ` / ${usageSummary.lastRequest.contextLimit.toLocaleString()}`
                        : ""}
                    </span>
                    <span>
                      {isEnglish ? "Cached" : "Em cache"}:{" "}
                      {(usageSummary?.lastRequest?.cachedInputTokens ?? 0).toLocaleString()}
                    </span>
                    <span>
                      {isEnglish ? "Requests (cumulative)" : "Requisições (acumulado)"}:{" "}
                      {usageSummary?.totals.requests ?? 0}
                    </span>
                    {usageSummary?.windows.map((window) => (
                      <span key={`${window.metric}-${window.label}`}>
                        {window.label}:{" "}
                        {window.remainingPercent === undefined
                          ? isEnglish
                            ? "limit unavailable"
                            : "limite indisponível"
                          : `${Math.round(window.remainingPercent)}% ${isEnglish ? "remaining" : "restante"}`}
                      </span>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => {
                        setUsageOpen(false);
                        setShowUsageDetails(true);
                      }}
                      type="button"
                    >
                      {isEnglish ? "View full usage" : "Ver uso completo"}
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              aria-pressed={Boolean(workspace && showVault)}
              className={`header-toggle ${showVault && workspace ? "is-active" : ""}`}
              onClick={() => {
                if (!workspace) {
                  setResourceNotice(
                    isEnglish
                      ? "Select a folder to configure your workspace and use the Vault and graph."
                      : "Para usar o Vault e o grafo, selecione uma pasta para configurar seu workspace.",
                  );
                  return;
                }
                setResourceNotice("");
                setShowVault((current) => {
                  if (!current) setVaultCollapsed(false);
                  return !current;
                });
              }}
              type="button"
            >
              Vault
            </button>
          </div>
        </header>
        <section
          className={`chat-shell ${visibleMessages.length === 0 ? "is-empty" : ""}`}
          aria-label={isEnglish ? "Conversation" : "Conversa"}
        >
          {visibleMessages.length === 0 ? (
            <div className="empty-state">
              <h1>
                {greeting}, {name}
              </h1>
              <p>
                {workspace
                  ? isEnglish
                    ? "What will we build today?"
                    : "O que vamos construir hoje?"
                  : isEnglish
                    ? "Chat freely. Add a folder whenever you want to use files and the Vault."
                    : "Converse livremente. Adicione uma pasta quando quiser usar arquivos e o Vault."}
              </p>
            </div>
          ) : (
            <MessageList
              copiedMessageId={copiedMessageId}
              copyMessage={(message) => void copyMessage(message)}
              editingMessageDraft={editingMessageDraft}
              editingMessageId={editingMessageId}
              isEnglish={isEnglish}
              isSending={isSending}
              listRef={messageListRef}
              onEditCancel={() => setEditingMessageId(null)}
              onEditChange={setEditingMessageDraft}
              onEditSubmit={(messageId, draft) => {
                setEditingMessageId(null);
                void editMessage(messageId, draft);
              }}
              onEditingStart={(message) => {
                setEditingMessageDraft(message.content);
                setEditingMessageId(message.id);
              }}
              regenerate={() => void regenerate()}
              streamingContent={streamingContent}
              streamingStatus={streamingStatus}
              visibleMessages={visibleMessages}
            />
          )}
          {attachments.length > 0 && (
            <ul
              className="attachment-list"
              aria-label={isEnglish ? "Indexed attachments" : "Anexos indexados"}
            >
              {attachments.map((attachment) => (
                <li className="attachment-chip" key={attachment.id}>
                  <span>{attachment.filename}</span>
                  <button
                    aria-label={`${isEnglish ? "Remove" : "Remover"} ${attachment.filename}`}
                    onClick={() => setAttachmentToRemove(attachment)}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {toolApproval && (
            <section aria-live="assertive" className="tool-approval-card" role="alertdialog">
              <p className="eyebrow">
                {isEnglish ? "Permission requested" : "Autorização solicitada"}
              </p>
              <strong>{toolApproval.tool}</strong>
              <pre>{JSON.stringify(toolApproval.args, null, 2)}</pre>
              <div className="workspace-access-actions">
                <button
                  className="button button-primary"
                  onClick={() => resolveToolDecision("allow_once")}
                  type="button"
                >
                  {isEnglish ? "Allow once" : "Permitir uma vez"}
                </button>
                {!["apply_patch", "create_or_update_file", "execute_command"].includes(
                  toolApproval.tool,
                ) && (
                  <button
                    className="button button-secondary"
                    onClick={() => resolveToolDecision("allow_session")}
                    type="button"
                  >
                    {isEnglish ? "Allow this session" : "Permitir nesta sessão"}
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => resolveToolDecision("deny")}
                  type="button"
                >
                  {isEnglish ? "Deny" : "Negar"}
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
            isEnglish={isEnglish}
            isSending={isSending}
            modelName={modelName}
            models={models}
            modelOpen={modelOpen}
            onAttachFile={(file) => void attachFile(file)}
            onSubmit={(event) => void submit(event)}
            permissionError={permissionError}
            permissionOpen={permissionOpen}
            selectedModel={selectedModel}
            setDraft={setDraft}
            setModelOpen={setModelOpen}
            setPermissionOpen={setPermissionOpen}
            stopGeneration={stopGeneration}
            workspace={workspace}
          />
          {attachmentStatus && <p className="attachment-status">{attachmentStatus}</p>}
          {resourceNotice && (
            <div className="resource-gate" role="alert">
              <span>{resourceNotice}</span>
              <button className="text-button" onClick={newWorkspace} type="button">
                {isEnglish
                  ? "Add a workspace in settings"
                  : "Adicionar workspace nas configurações"}
              </button>
            </div>
          )}
          {error && (
            <p className="form-error chat-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </section>
      {showVault && workspace && (
        <div className={`vault-slot ${isResizingVault ? "is-resizing" : ""}`}>
          {!vaultCollapsed && (
            <hr
              aria-label={isEnglish ? "Resize Vault panel" : "Redimensionar painel do Vault"}
              aria-orientation="vertical"
              aria-valuemax={maximumVaultWidth}
              aria-valuemin={minimumVaultWidth}
              aria-valuenow={vaultWidth}
              className="vault-resize-handle"
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setVaultWidth((current) => boundedVaultWidth(current + 24));
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setVaultWidth((current) => boundedVaultWidth(current - 24));
                }
              }}
              onPointerCancel={finishVaultResize}
              onPointerDown={startVaultResize}
              onPointerMove={resizeVault}
              onPointerUp={finishVaultResize}
              tabIndex={0}
            />
          )}
          {vaultCollapsed ? (
            <aside
              aria-label={isEnglish ? "Collapsed Vault" : "Vault recolhido"}
              className="vault-rail"
            >
              <button
                aria-label={isEnglish ? "Open Vault files" : "Abrir arquivos do Vault"}
                onClick={() => {
                  setVaultTab("files");
                  setVaultCollapsed(false);
                }}
                title={isEnglish ? "Files" : "Arquivos"}
                type="button"
              >
                <CompactIcon kind="files" />
              </button>
              <button
                aria-label={isEnglish ? "Open Vault graph" : "Abrir grafo do Vault"}
                onClick={() => {
                  setVaultTab("graph");
                  setVaultCollapsed(false);
                }}
                title={isEnglish ? "Graph" : "Grafo"}
                type="button"
              >
                <CompactIcon kind="graph" />
              </button>
            </aside>
          ) : (
            <Suspense
              fallback={<aside className="vault-panel vault-loading-panel" aria-busy="true" />}
            >
              <VaultPanel
                locale={isEnglish ? "en" : "pt-BR"}
                onCollapse={() => setVaultCollapsed(true)}
                onTabChange={setVaultTab}
                refreshKey={vaultRefreshKey}
                tab={vaultTab}
                workspaceId={workspace.id}
              />
            </Suspense>
          )}
        </div>
      )}
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
          isEnglish={isEnglish}
          messages={messages}
          modelName={selectedModel || (isEnglish ? "not selected" : "não selecionado")}
          onClose={() => setShowUsageDetails(false)}
          providerName={activeProvider?.name ?? "—"}
          sessionTitle={activeSession?.title ?? (isEnglish ? "New session" : "Nova sessão")}
          summary={usageSummary}
        />
      )}
      {sessionToDelete && (
        <ConfirmDialog
          confirmLabel={isEnglish ? "Delete session" : "Excluir sessão"}
          description={
            isEnglish
              ? "The messages in this conversation will be removed from this device."
              : "As mensagens desta conversa serão removidas deste dispositivo."
          }
          onCancel={() => setSessionToDelete(null)}
          onConfirm={() => {
            const session = sessionToDelete;
            setSessionToDelete(null);
            void remove(session.id);
          }}
          headingLabel={isEnglish ? "Confirmation" : "Confirmação"}
          title={`${isEnglish ? "Delete" : "Excluir"} ${sessionToDelete.title}?`}
        />
      )}
      {attachmentToRemove && (
        <ConfirmDialog
          confirmLabel={isEnglish ? "Remove attachment" : "Remover anexo"}
          description={
            isEnglish
              ? "The file and its local index will be removed from this device."
              : "O arquivo e seu índice local serão removidos deste dispositivo."
          }
          onCancel={() => setAttachmentToRemove(null)}
          onConfirm={() => {
            const attachment = attachmentToRemove;
            setAttachmentToRemove(null);
            void detachFile(attachment);
          }}
          headingLabel={isEnglish ? "Confirmation" : "Confirmação"}
          title={`${isEnglish ? "Remove" : "Remover"} ${attachmentToRemove.filename}?`}
        />
      )}
      {sessionToRename && (
        <div className="confirm-backdrop" role="presentation">
          <section
            aria-labelledby="rename-session-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <p className="eyebrow">{isEnglish ? "Session" : "Sessão"}</p>
            <h2 id="rename-session-title">
              {isEnglish ? "Rename conversation" : "Renomear conversa"}
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void rename(sessionToRename.id, sessionToRename.title);
              }}
            >
              <label className="settings-field">
                <span>{isEnglish ? "New name" : "Novo nome"}</span>
                <input
                  onChange={(event) => setRenameDraft(event.target.value)}
                  value={renameDraft}
                />
              </label>
              <footer className="confirm-dialog-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setSessionToRename(null)}
                  type="button"
                >
                  {isEnglish ? "Cancel" : "Cancelar"}
                </button>
                <button
                  className="button button-primary"
                  disabled={!renameDraft.trim()}
                  type="submit"
                >
                  {isEnglish ? "Save" : "Salvar"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {paletteOpen && (
        <div className="command-backdrop" role="presentation">
          <section
            aria-label={isEnglish ? "Command palette" : "Paleta de comandos"}
            className="command-palette"
          >
            <input
              aria-label={isEnglish ? "Search commands" : "Pesquisar comandos"}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder={
                isEnglish ? "Search sessions and actions…" : "Pesquisar sessões e ações…"
              }
              value={paletteQuery}
            />
            <div className="command-list">
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  setShowSettings(true);
                }}
                type="button"
              >
                {isEnglish ? "Open settings" : "Abrir configurações"}
              </button>
              {recentSessions
                .filter((session) =>
                  session.title.toLocaleLowerCase().includes(paletteQuery.toLocaleLowerCase()),
                )
                .map((session) => (
                  <button
                    key={session.id}
                    onClick={() => {
                      setPaletteOpen(false);
                      void openSession(session.id);
                    }}
                    type="button"
                  >
                    {isEnglish ? "Open session: " : "Abrir sessão: "}
                    {session.title}
                  </button>
                ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
