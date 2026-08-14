// MIT License — Copyright (c) 2026 Mateus Gaio
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
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
  editSessionMessage,
  getAppState,
  getProviderUsage,
  listAttachments,
  listProviders,
  listStoredProviderModels,
  type ProviderModel,
  persistMessage,
  regenerateSession,
  removeAttachment,
  renameSession,
  searchAttachments,
  selectSession,
  selectWorkspace,
  setSessionModel,
  setWorkspacePermissionMode,
  streamMessage,
  uploadAttachment,
  type WorkspaceToolApproval,
  type WorkspaceToolDecision,
  type WorkspaceToolName,
} from "../shared/api/sidecar";
import { ConfirmDialog } from "../shared/components/ConfirmDialog";
import { SafeMarkdown } from "../shared/components/SafeMarkdown";
import { isSubmitShortcut } from "./composer";
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

const VaultPanel = lazy(async () => {
  const module = await import("../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type SidebarFocusTarget = "recent" | "settings" | "workspace";
type VaultTab = "files" | "graph";

const minimumVaultWidth = 300;
const maximumVaultWidth = 680;
const defaultVaultWidth = 360;

function CompactIcon({
  kind,
}: {
  kind: "files" | "graph" | "recent" | "settings" | "workspace" | "panel";
}) {
  const paths = {
    files: <path d="M5 4h9l4 4v12H5V4Zm9 0v4h4M8 13h8M8 17h6" />,
    graph: (
      <path d="m7 6 5 3 5-3M7 18l5-3 5 3M12 9v6M5 5h4v4H5V5Zm10 0h4v4h-4V5ZM5 15h4v4H5v-4Zm10 0h4v4h-4v-4Z" />
    ),
    recent: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 7v5l3.5 2" />,
    settings: (
      <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0-5.3 1 2.3 2.4.5 1.9-1.5 1.7 1.7-1.5 1.9.5 2.4 2.3 1v2.4l-2.3 1-.5 2.4 1.5 1.9-1.7 1.7-1.9-1.5-2.4.5-1 2.3h-2.4l-1-2.3-2.4-.5-1.9 1.5-1.7-1.7 1.5-1.9-.5-2.4-2.3-1v-2.4l2.3-1 .5-2.4-1.5-1.9 1.7-1.7 1.9 1.5 2.4-.5 1-2.3H12Z" />
    ),
    workspace: <path d="M3.5 7.5h6l1.8 2H20.5v9.8H3.5V7.5Zm0 0V5h6l1.8 2.5" />,
    panel: <path d="M4 5h16v14H4V5Zm5 0v14M12 9l3 3-3 3" />,
  } as const;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[kind]}
    </svg>
  );
}

function usageBadgeLabel(
  summary: import("../shared/api/sidecar").UsageSummary | null,
  isEnglish: boolean,
) {
  const restrictive = summary?.windows
    .filter((window) => window.remainingPercent !== undefined)
    .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101))[0];
  if (restrictive?.remainingPercent !== undefined)
    return `${Math.round(restrictive.remainingPercent)}% ${isEnglish ? "remaining" : "restante"}`;
  if (summary && summary.totals.totalTokens > 0)
    return `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(summary.totals.totalTokens)} ${isEnglish ? "tokens" : "tokens"}`;
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => appState?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingStatus, setStreamingStatus] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [resourceNotice, setResourceNotice] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [usageSummary, setUsageSummary] = useState<
    import("../shared/api/sidecar").UsageSummary | null
  >(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [toolApproval, setToolApproval] = useState<WorkspaceToolApproval | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [sessionToRename, setSessionToRename] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [attachmentToRemove, setAttachmentToRemove] = useState<Attachment | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const activeStream = useRef<{ stop: () => void } | null>(null);
  const pendingToolDecision = useRef<((decision: WorkspaceToolDecision) => void) | null>(null);
  const streamingContentRef = useRef("");
  const runningToolRef = useRef<WorkspaceToolName | null>(null);
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
    }
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenSessionMenuId(null);
      setSessionMenuPosition(null);
      setPermissionOpen(false);
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

  function resolveToolDecision(decision: WorkspaceToolDecision) {
    const resolveDecision = pendingToolDecision.current;
    pendingToolDecision.current = null;
    setToolApproval(null);
    resolveDecision?.(decision);
  }

  async function generateResponse(promptMessages: ChatMessage[], sessionId: string) {
    if (!activeProvider || isSending) return;
    setError("");
    setIsSending(true);
    setStreamingContent("");
    streamingContentRef.current = "";
    setStreamingStatus("Consultando…");
    const requestProvider = activeProvider;
    const requestModel = selectedModel;
    const requestWorkspaceId = workspace?.id ?? "default";
    const requestProfileId = state?.activeProfileId;
    try {
      const stream = await streamMessage(
        requestProvider.id,
        promptMessages,
        requestModel,
        requestWorkspaceId,
        {
          onDelta: (delta) => {
            if (activeSessionIdRef.current !== sessionId) return;
            streamingContentRef.current += delta;
            setStreamingContent(streamingContentRef.current);
            setStreamingStatus("Gerando…");
          },
          onUsage: () => {
            void getProviderUsage(requestProvider.id, {
              modelId: requestModel || undefined,
              profileId: requestProfileId,
              sessionId,
            })
              .then(setUsageSummary)
              .catch(() => undefined);
          },
          onRetry: (message) => {
            if (activeSessionIdRef.current === sessionId) setStreamingStatus(message);
          },
          onApproval: (approval, resolveDecision) => {
            if (activeSessionIdRef.current !== sessionId) {
              resolveDecision("deny");
              return;
            }
            pendingToolDecision.current = resolveDecision;
            setToolApproval(approval);
            setStreamingStatus(isEnglish ? "Waiting for permission…" : "Aguardando autorização…");
          },
          onToolStarted: (tool) => {
            runningToolRef.current = tool;
            if (activeSessionIdRef.current === sessionId)
              setStreamingStatus(`${isEnglish ? "Running" : "Executando"} ${tool}…`);
          },
          onToolCompleted: () => {
            if (runningToolRef.current === "create_or_update_file")
              setVaultRefreshKey((key) => key + 1);
            runningToolRef.current = null;
            if (activeSessionIdRef.current === sessionId)
              setStreamingStatus(isEnglish ? "Continuing…" : "Continuando…");
          },
        },
        requestProfileId ?? undefined,
        sessionId,
      );
      activeStream.current = stream;
      const result = await stream.done;
      const assistantContent = result.content.trim();
      if (assistantContent && !result.persisted) {
        await persistMessage(sessionId, {
          content: assistantContent,
          model: result.provider?.model ?? requestModel,
          providerId: result.provider?.id ?? requestProvider.id,
          role: "assistant",
          status: result.stopped ? "stopped" : "complete",
        });
      }
      const refreshed = await getAppState();
      setState(refreshed);
      if (activeSessionIdRef.current === sessionId) setMessages(refreshed.messages);
      if (result.failed && result.error) setError(result.error);
    } catch (reason) {
      const partial = streamingContentRef.current.trim();
      if (partial) {
        await persistMessage(sessionId, {
          content: partial,
          model: requestModel,
          providerId: requestProvider.id,
          role: "assistant",
          status: "failed",
        }).catch(() => undefined);
        const refreshed = await getAppState().catch(() => null);
        if (refreshed) {
          setState(refreshed);
          if (activeSessionIdRef.current === sessionId) setMessages(refreshed.messages);
        }
      }
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally {
      activeStream.current = null;
      setStreamingContent("");
      streamingContentRef.current = "";
      setStreamingStatus("");
      setIsSending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    const sessionId = state?.activeSessionId;
    if (!content || !activeProvider || !sessionId || isSending) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { content, id: crypto.randomUUID(), role: "user" },
    ];
    setMessages(nextMessages);
    activeSessionIdRef.current = sessionId;
    setDraft("");
    composerRef.current?.style.removeProperty("height");
    setResourceNotice("");
    await persistMessage(sessionId, { content, role: "user", status: "complete" });
    // Atualiza a lista de Recentes assim que a conversa recebe atividade,
    // antes mesmo de a resposta do modelo terminar de chegar.
    setState(await getAppState());
    const relevantAttachments = workspace
      ? await searchAttachments(workspace.id, content.slice(0, 160)).catch(() => [])
      : [];
    const contextMessage: ChatMessage | null = relevantAttachments.length
      ? {
          content: `Trechos relevantes dos anexos locais:\n${relevantAttachments
            .map((item) => `[${item.filename}]\n${item.content}`)
            .join("\n\n")}`,
          id: crypto.randomUUID(),
          role: "system",
        }
      : null;
    await generateResponse(
      contextMessage ? [...nextMessages, contextMessage] : nextMessages,
      sessionId,
    );
  }

  async function editMessage(messageId: string, content: string) {
    const sessionId = state?.activeSessionId;
    if (!sessionId || isSending) return;
    try {
      const next = await editSessionMessage(sessionId, messageId, content);
      setMessages(next as ChatMessage[]);
      const refreshed = await getAppState();
      setState(refreshed);
      setMessages(refreshed.messages);
      await generateResponse(refreshed.messages as ChatMessage[], sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível editar a mensagem.");
    }
  }

  async function regenerate() {
    const sessionId = state?.activeSessionId;
    if (!sessionId || isSending) return;
    try {
      const next = await regenerateSession(sessionId);
      setMessages(next as ChatMessage[]);
      await generateResponse(next as ChatMessage[], sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível regenerar a resposta.");
    }
  }

  function stopGeneration() {
    activeStream.current?.stop();
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !isSubmitShortcut({
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        shiftKey: event.shiftKey,
      })
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function resizeComposer(target: HTMLTextAreaElement) {
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
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
      <aside
        className="workspace-sidebar"
        aria-label={isEnglish ? "Workspace navigation" : "Navegação do workspace"}
      >
        <div className="sidebar-heading">
          <span aria-label="Blackwall" className="sidebar-brand-mark" role="img">
            BW
          </span>
          <div className="sidebar-profile-summary">
            {activeProfile?.avatarData ? (
              <img alt="" className="brand-mark profile-avatar" src={activeProfile.avatarData} />
            ) : null}
            <strong>{name}</strong>
          </div>
          <button
            aria-label={
              sidebarCollapsed
                ? isEnglish
                  ? "Show sidebar"
                  : "Mostrar sidebar"
                : isEnglish
                  ? "Hide sidebar"
                  : "Esconder sidebar"
            }
            aria-pressed={sidebarCollapsed}
            className="sidebar-toggle"
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
        </div>
        {sidebarCollapsed && (
          <nav
            aria-label={isEnglish ? "Sidebar shortcuts" : "Atalhos da sidebar"}
            className="sidebar-rail"
          >
            <button
              aria-label={isEnglish ? "Open workspaces" : "Abrir workspaces"}
              onClick={() => expandSidebar("workspace")}
              title="Workspaces"
              type="button"
            >
              <CompactIcon kind="workspace" />
            </button>
            <button
              aria-label={isEnglish ? "Open recent sessions" : "Abrir sessões recentes"}
              onClick={() => expandSidebar("recent")}
              title={isEnglish ? "Recent" : "Recentes"}
              type="button"
            >
              <CompactIcon kind="recent" />
            </button>
            <button
              aria-label={isEnglish ? "Open settings" : "Abrir configurações"}
              className="sidebar-rail-settings"
              onClick={() => expandSidebar("settings")}
              title={isEnglish ? "Settings" : "Configurações"}
              type="button"
            >
              <CompactIcon kind="settings" />
            </button>
          </nav>
        )}
        <div className="sidebar-section">
          <div className="sidebar-section-heading">
            <p className="eyebrow">Workspaces</p>
            <button
              aria-label={isEnglish ? "Create workspace" : "Criar workspace"}
              className="icon-button"
              onClick={() => void newWorkspace()}
              type="button"
            >
              +
            </button>
          </div>
          {workspace && (
            <label className="workspace-picker">
              <span className="workspace-picker-label">
                {isEnglish ? "Current workspace" : "Workspace atual"}
              </span>
              <span className="workspace-picker-control">
                <select
                  aria-label={isEnglish ? "Current workspace" : "Workspace atual"}
                  onChange={(event) => void openWorkspace(event.target.value)}
                  ref={workspacePickerRef}
                  value={workspace.id}
                >
                  {state?.workspaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true" className="workspace-picker-chevron">
                  ⌄
                </span>
              </span>
              <span>{workspace.rootPath}</span>
            </label>
          )}
          {!workspace && (
            <div className="workspace-empty">
              <strong>{isEnglish ? "No workspace" : "Sem workspace"}</strong>
              <span>
                {isEnglish
                  ? "Conversation without file context."
                  : "Conversa sem contexto de arquivos."}
              </span>
              <button className="sidebar-config" onClick={() => void newWorkspace()} type="button">
                {isEnglish ? "Add workspace" : "Adicionar workspace"}
              </button>
            </div>
          )}
        </div>
        <div className="sidebar-section sidebar-sessions">
          <div className="sidebar-section-heading">
            <p className="eyebrow">{isEnglish ? "Recent" : "Recentes"}</p>
            <button
              aria-label={isEnglish ? "New session" : "Nova sessão"}
              className="icon-button"
              disabled={isCreatingSession || !state?.activeProfileId}
              onClick={() => void newSession()}
              type="button"
            >
              {isCreatingSession ? "…" : "+"}
            </button>
          </div>
          <nav
            aria-label={isEnglish ? "Recent sessions" : "Sessões recentes"}
            ref={recentSessionsRef}
            tabIndex={-1}
          >
            {recentSessions.map((session) => (
              <div className="session-row" data-session-menu key={session.id}>
                <button
                  className={`session-item ${session.id === activeSession?.id ? "is-active" : ""}`}
                  onClick={() => void openSession(session.id)}
                  type="button"
                >
                  <span aria-hidden="true" className="session-icon" />
                  <span className="session-copy">
                    <strong>{session.title}</strong>
                    <small>
                      {session.workspaceName ?? (isEnglish ? "No workspace" : "Sem workspace")}
                    </small>
                  </span>
                </button>
                <button
                  aria-expanded={openSessionMenuId === session.id}
                  aria-haspopup="menu"
                  aria-label={`${isEnglish ? "Actions for" : "Ações de"} ${session.title}`}
                  className="session-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const nextId = openSessionMenuId === session.id ? null : session.id;
                    setOpenSessionMenuId(nextId);
                    setSessionMenuPosition(
                      nextId
                        ? {
                            left: Math.max(8, rect.right - 142),
                            top: Math.min(window.innerHeight - 92, rect.bottom + 4),
                          }
                        : null,
                    );
                  }}
                  type="button"
                >
                  …
                </button>
              </div>
            ))}
          </nav>
        </div>
        <div className="sidebar-settings">
          <button
            className="sidebar-config"
            onClick={() => setShowSettings(true)}
            ref={settingsButtonRef}
            type="button"
          >
            {isEnglish ? "Settings" : "Configurações"}
          </button>
        </div>
        {openSessionMenuId && sessionMenuPosition && (
          <div
            className="session-menu session-menu-floating"
            role="menu"
            style={{ left: sessionMenuPosition.left, top: sessionMenuPosition.top }}
          >
            <button
              onClick={() => {
                const session = recentSessions.find((item) => item.id === openSessionMenuId);
                if (!session) return;
                setOpenSessionMenuId(null);
                setSessionMenuPosition(null);
                setRenameDraft(session.title);
                setSessionToRename({ id: session.id, title: session.title });
              }}
              role="menuitem"
              type="button"
            >
              {isEnglish ? "Rename" : "Renomear"}
            </button>
            <button
              className="session-menu-danger"
              onClick={() => {
                const session = recentSessions.find((item) => item.id === openSessionMenuId);
                if (!session) return;
                setOpenSessionMenuId(null);
                setSessionMenuPosition(null);
                setSessionToDelete({ id: session.id, title: session.title });
              }}
              role="menuitem"
              type="button"
            >
              {isEnglish ? "Delete" : "Excluir"}
            </button>
          </div>
        )}
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">
              {workspace?.name ?? (isEnglish ? "No workspace" : "Sem workspace")}
            </p>
            <p className="workspace-session-title">
              {activeSession?.title ?? (isEnglish ? "New conversation" : "Nova conversa")}
            </p>
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
              <label className="model-selector">
                <span className="sr-only">{isEnglish ? "Model" : "Modelo"}</span>
                <select
                  aria-label={isEnglish ? "Select model" : "Selecionar modelo"}
                  onChange={(event) => void changeModel(event.target.value)}
                  title={isEnglish ? "Select model" : "Selecionar modelo"}
                  value={selectedModel}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
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
                    <strong>{isEnglish ? "Current usage" : "Uso atual"}</strong>
                    <span>
                      {isEnglish ? "Requests" : "Requisições"}: {usageSummary?.totals.requests ?? 0}
                    </span>
                    <span>
                      {isEnglish ? "Tokens" : "Tokens"}: {usageSummary?.totals.totalTokens ?? 0}
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
                        setShowSettings(true);
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
            <ol className="message-list" ref={messageListRef}>
              {visibleMessages.map((message) => (
                <li className={`message message-${message.role}`} key={message.id}>
                  {editingMessageId === message.id ? (
                    <form
                      className="message-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setEditingMessageId(null);
                        void editMessage(message.id, editingMessageDraft);
                      }}
                    >
                      <textarea
                        aria-label={isEnglish ? "Edit message" : "Editar mensagem"}
                        onChange={(event) => setEditingMessageDraft(event.target.value)}
                        value={editingMessageDraft}
                      />
                      <div className="message-actions">
                        <button
                          className="button button-secondary"
                          onClick={() => setEditingMessageId(null)}
                          type="button"
                        >
                          {isEnglish ? "Cancel" : "Cancelar"}
                        </button>
                        <button className="button button-primary" type="submit">
                          {isEnglish ? "Save and regenerate" : "Salvar e regenerar"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <SafeMarkdown content={message.content} locale={isEnglish ? "en" : "pt-BR"} />
                      <div className="message-actions">
                        {message.role === "user" && (
                          <button
                            className="message-action"
                            onClick={() => {
                              setEditingMessageDraft(message.content);
                              setEditingMessageId(message.id);
                            }}
                            type="button"
                          >
                            {isEnglish ? "Edit" : "Editar"}
                          </button>
                        )}
                        {message.role === "assistant" &&
                          message.id === visibleMessages.at(-1)?.id && (
                            <button
                              className="message-action"
                              onClick={() => void regenerate()}
                              type="button"
                            >
                              {isEnglish ? "Regenerate" : "Regenerar"}
                            </button>
                          )}
                      </div>
                    </>
                  )}
                </li>
              ))}
              {isSending && (
                <li className="message message-assistant message-streaming">
                  {streamingContent ? (
                    <SafeMarkdown content={streamingContent} locale={isEnglish ? "en" : "pt-BR"} />
                  ) : (
                    streamingStatus
                  )}
                  <span aria-hidden="true" className="streaming-cursor" />
                </li>
              )}
            </ol>
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
          <form className="composer" onSubmit={submit}>
            <input
              accept=".c,.cpp,.css,.csv,.go,.h,.html,.java,.js,.json,.jsx,.md,.pdf,.py,.rs,.sh,.sql,.toml,.ts,.tsx,.txt,.yaml,.yml"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void attachFile(file);
              }}
              ref={fileInput}
              type="file"
            />
            <button
              aria-label={isEnglish ? "Attach file" : "Anexar arquivo"}
              className="composer-attach"
              disabled={!activeSession || !workspace || isSending}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              +
            </button>
            {workspace && (
              <div className="permission-control" data-permission-control>
                <button
                  aria-expanded={permissionOpen}
                  aria-haspopup="menu"
                  aria-label={isEnglish ? "Permission mode" : "Modo de permissões"}
                  className="composer-permission"
                  onClick={() => setPermissionOpen((current) => !current)}
                  title={`Permissões: ${
                    workspace.permissionMode === "ask"
                      ? isEnglish
                        ? "Ask every time"
                        : "Perguntar sempre"
                      : workspace.permissionMode === "automatic"
                        ? isEnglish
                          ? "Automatic"
                          : "Automático"
                        : isEnglish
                          ? "Read-only"
                          : "Somente leitura"
                  }`}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 3 5 6v5c0 4.3 2.8 8.2 7 10 4.2-1.8 7-5.7 7-10V6l-7-3Z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </button>
                {permissionOpen && (
                  <div className="permission-popover" role="menu">
                    <p>{isEnglish ? "Permissions" : "Permissões"}</p>
                    {(
                      [
                        ["ask", isEnglish ? "Ask every time" : "Perguntar sempre"],
                        ["automatic", isEnglish ? "Automatic" : "Automático"],
                        ["read-only", isEnglish ? "Read-only" : "Somente leitura"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        className={workspace.permissionMode === mode ? "is-selected" : ""}
                        key={mode}
                        onClick={() => {
                          void changePermissionMode(mode);
                          setPermissionOpen(false);
                        }}
                        role="menuitemradio"
                        aria-checked={workspace.permissionMode === mode}
                        type="button"
                      >
                        <span>{label}</span>
                        {workspace.permissionMode === mode && <span aria-hidden="true">✓</span>}
                      </button>
                    ))}
                    {permissionError && (
                      <small className="permission-error">{permissionError}</small>
                    )}
                  </div>
                )}
              </div>
            )}
            <textarea
              aria-label={isEnglish ? "Message" : "Mensagem"}
              data-testid="chat-composer"
              disabled={!activeProvider || !activeSession || isSending}
              onChange={(event) => {
                setDraft(event.target.value);
                resizeComposer(event.target);
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder={isEnglish ? "Send a message…" : "Envie uma mensagem…"}
              ref={composerRef}
              rows={1}
              value={draft}
            />
            {isSending ? (
              <button className="button button-secondary" onClick={stopGeneration} type="button">
                {isEnglish ? "Stop" : "Parar"}
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={!draft.trim() || !activeProvider || !activeSession}
                type="submit"
              >
                {isEnglish ? "Send" : "Enviar"}
              </button>
            )}
          </form>
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
