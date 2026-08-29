// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LayoutChangedMeta, PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { ChatRuntimeProvider, useSidecarChat } from "../features/chat/adapter/use-sidecar-runtime";
import { ApprovalCard } from "../features/chat/ui/ApprovalCard";
import { ChatThread } from "../features/chat/ui/ChatThread";
import { SessionUsageDialog } from "../features/chat/ui/SessionUsageDialog";
import { ProviderManager } from "../features/config/components/ProviderManager";
import type { SettingsSection } from "../features/config/settings-sections";
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
  type SessionSummary,
  selectSession,
  selectWorkspace,
  setSessionModel,
  setWorkspacePermissionMode,
  undoVaultRevision,
  uploadAttachment,
} from "../shared/api/sidecar";
import { ConfirmDialog } from "../shared/components/ConfirmDialog";
import { EnterExit } from "../shared/components/motion/EnterExit";
import { Skeleton } from "../shared/components/motion/Skeleton";
import { greetingForTime } from "./greetings";
import {
  cursorTextAvoidancePreference,
  readBooleanPreference,
  readNumberPreference,
  sidebarCollapsedPreference,
  sidebarPanelWidthPreference,
  skipSessionDeleteConfirmationPreference,
  vaultPanelWidthPreference,
  writeBooleanPreference,
  writeNumberPreference,
} from "./panel-preferences";
import { ChatHeader } from "./shell/ChatHeader";
import { Composer } from "./shell/Composer";
import { CommandPalette, RenameSessionDialog } from "./shell/Dialogs";
import { SessionsSidebar } from "./shell/SessionsSidebar";
import {
  emptyVaultMemory,
  maximumVaultWidth,
  minimumVaultWidth,
  type VaultMemory,
  VaultRail,
  VaultSlot,
} from "./shell/VaultSlot";
import {
  clampSidebarWidth,
  defaultSidebarWidth,
  maximumSidebarWidth,
  minimumSidebarWidth,
} from "./sidebar-layout";
import {
  reduceVaultView,
  type VaultViewState,
  vaultModePreference as vaultModePreferenceKey,
} from "./vault-view";

const defaultVaultWidth = 360;
function readStoredVaultMode(): VaultViewState["mode"] {
  try {
    const stored = window.localStorage.getItem(vaultModePreferenceKey);
    return stored === "rail" ? "rail" : "expanded";
  } catch {
    return "expanded";
  }
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
  const { t } = useTranslation();
  const [state, setState] = useState(appState);
  const [providers, setProviders] = useState<ConnectedProvider[]>(provider ? [provider] : []);
  const [activeProvider, setActiveProvider] = useState<ConnectedProvider | null>(provider);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("usage");
  const [cursorAvoidanceEnabled, setCursorAvoidanceEnabled] = useState(() =>
    readBooleanPreference(cursorTextAvoidancePreference),
  );
  const [vaultView, setVaultView] = useState<VaultViewState>(() => ({
    mode: readStoredVaultMode(),
    tab: "files",
  }));
  const [vaultMemory, setVaultMemory] = useState<VaultMemory>(emptyVaultMemory);
  const [vaultRefreshKey, setVaultRefreshKey] = useState(0);
  // Nota aberta é elevada para o shell: recolher/reabrir o Vault preserva a
  // leitura sem ação manual (UX do trilho único).
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readBooleanPreference(sidebarCollapsedPreference),
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(readNumberPreference(sidebarPanelWidthPreference, defaultSidebarWidth)),
  );
  // A sidebar só pode ser recolhida pelo botão global. O painel continua
  // collapsible para que a API imperativa do botão funcione, mas o divisor
  // fica não-colapsável durante o estado expandido e desabilitado no estado
  // recolhido.
  const [sidebarCollapseArmed, setSidebarCollapseArmed] = useState(() => sidebarCollapsed);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
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
  const [newChatDraft, setNewChatDraft] = useState(false);
  const [newChatModel, setNewChatModel] = useState("");
  const [error, setError] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [switchingSession, setSwitchingSession] = useState(false);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [resourceNotice, setResourceNotice] = useState("");
  const [vaultNoteConfirmation, setVaultNoteConfirmation] = useState<{
    path: string;
    revisionId: string;
    title: string;
    undoing: boolean;
  } | null>(null);
  const [permissionError, setPermissionError] = useState("");
  const [usageSummary, setUsageSummary] = useState<
    import("../shared/api/sidecar").UsageSummary | null
  >(null);
  const [showUsageDetails, setShowUsageDetails] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [skipSessionDeleteConfirmation, setSkipSessionDeleteConfirmation] = useState(() =>
    readBooleanPreference(skipSessionDeleteConfirmationPreference),
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
  const paletteOpenerRef = useRef<HTMLElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const recentSessionsRef = useRef<HTMLElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const newSessionRef = useRef<() => void>(() => undefined);
  const pendingDraftRef = useRef<string | null>(null);
  const pendingDraftSessionRef = useRef<string | null>(null);
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
  // Modelo efetivo: escolha explícita da sessão; sem ela, o padrão do
  // provedor quando existir. Nunca um modelo arbitrário (`models[0]`) nem uma
  // string vazia — ausência de escolha mantém o composer em "Escolher modelo".
  const sessionSelectedModel = newChatDraft
    ? newChatModel.trim()
    : activeSession?.selectedModel?.trim() || "";
  const selectedModel = sessionSelectedModel || activeProvider?.model?.trim() || "";
  const modelName =
    (models.find((model) => model.id === selectedModel)?.name ?? selectedModel) ||
    t("chat.selectModel");
  const ctxLabel = useMemo(() => {
    const last = usageSummary?.lastRequest;
    if (!last || last.totalTokens <= 0) return null;
    const compact = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      notation: "compact",
    });
    return compact.format(last.totalTokens);
  }, [usageSummary]);

  const {
    cancel: stopGeneration,
    clearError,
    editMessage,
    error: chatError,
    isRunning: isSending,
    messages,
    pullQueuedDraft,
    queuedCount,
    queuedPreview,
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
    onVaultNoteCreated: (note) => setVaultNoteConfirmation({ ...note, undoing: false }),
    profileId: state?.activeProfileId,
    providerId: activeProvider?.id ?? null,
    sessionId: newChatDraft ? null : (state?.activeSessionId ?? null),
    storedMessages: newChatDraft ? [] : (state?.messages ?? []),
    workspaceId: workspace?.id,
  });

  function submitDraft() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    composerRef.current?.style.removeProperty("height");
    setResourceNotice("");
    if (newChatDraft) {
      pendingDraftRef.current = content;
      void createSessionForPendingDraft();
      return;
    }
    sendMessage(content);
  }

  useEffect(() => {
    const content = pendingDraftRef.current;
    if (
      !content ||
      newChatDraft ||
      !state?.activeSessionId ||
      state.activeSessionId !== pendingDraftSessionRef.current
    ) {
      return;
    }
    pendingDraftRef.current = null;
    pendingDraftSessionRef.current = null;
    sendMessage(content);
  }, [newChatDraft, sendMessage, state?.activeSessionId]);

  useEffect(() => {
    if (!activeProvider) {
      setUsageSummary(null);
      return;
    }
    let cancelled = false;
    void getProviderUsage(activeProvider.id, {
      modelId: selectedModel || undefined,
      profileId: state?.activeProfileId ?? undefined,
      sessionId: newChatDraft ? undefined : activeSession?.id,
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
  }, [activeProvider, activeSession?.id, newChatDraft, selectedModel, state?.activeProfileId]);

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
    writeBooleanPreference(cursorTextAvoidancePreference, cursorAvoidanceEnabled);
  }, [cursorAvoidanceEnabled]);

  useEffect(() => {
    if (sidebarCollapsed) {
      sidebarPanelRef.current?.collapse();
      return;
    }
    sidebarPanelRef.current?.expand();
    setSidebarCollapseArmed(false);
  }, [sidebarCollapsed]);

  function handleSidebarLayout(_layout: { [panelId: string]: number }, _meta: LayoutChangedMeta) {
    const width = sidebarPanelRef.current?.getSize().inPixels;
    if (typeof width !== "number") return;
    if (sidebarCollapsed) return;
    const nextWidth = clampSidebarWidth(width, sidebarWidth);
    if (width !== nextWidth && width <= 0) {
      // A biblioteca pode atravessar o limiar de colapso antes de emitir o
      // callback. Reaplicar o mínimo no frame seguinte evita um estado visual
      // colapsado iniciado pelo arraste.
      requestAnimationFrame(() => sidebarPanelRef.current?.resize(nextWidth));
    }
    setSidebarWidth((current) => {
      if (Math.abs(nextWidth - current) < 0.5) return current;
      writeNumberPreference(sidebarPanelWidthPreference, nextWidth);
      return nextWidth;
    });
  }

  function toggleSidebar() {
    setSidebarCollapseArmed(true);
    setSidebarCollapsed((current) => !current);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(vaultModePreferenceKey, vaultView.mode);
    } catch {
      // Sem storage persistente o estado vivo em memória continua válido.
    }
  }, [vaultView.mode]);

  function dispatchVaultView(event: Parameters<typeof reduceVaultView>[1]) {
    setVaultView((current) => reduceVaultView(current, event));
  }

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
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setShowSettings(false);
    }
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dispatchVaultView só envolve setState (identidade estável); reagir a workspace evita re-disparos.
  useEffect(() => {
    if (!workspace) {
      dispatchVaultView({ type: "workspace-changed", hasWorkspace: false });
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: o corpo só usa refs de propósito — re-rolar deve acontecer apenas ao trocar de sessão ou mudar a contagem de mensagens; sem deps, o scroll roubava a posição do usuário a cada render.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      messageListRef.current?.scrollTo({
        behavior: "smooth",
        top: messageListRef.current.scrollHeight,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSession?.id, messages.length]);

  useEffect(() => {
    if (!activeProvider) {
      setModels([]);
      setModelsReady(true);
      return;
    }
    let cancelled = false;
    setModelsReady(false);
    void listStoredProviderModels(activeProvider.id)
      .then((available) => {
        if (cancelled) return;
        // Dedupe defensivo: alguns endpoints retornam o mesmo id duas vezes.
        const unique = available.filter(
          (model, index, all) => all.findIndex((item) => item.id === model.id) === index,
        );
        // O padrão legado do provedor continua listável quando existe e não
        // veio da sincronização; um default vazio nunca vira pseudo-modelo.
        const fallbackDefault = activeProvider.model?.trim();
        setModels(
          fallbackDefault && !unique.some((model) => model.id === fallbackDefault)
            ? [...unique, { capabilities: [], id: fallbackDefault, name: fallbackDefault }]
            : unique,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setModelsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProvider]);

  useEffect(() => {
    function onShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newSessionRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Guarda quem abriu por atalho para devolver o foco ao fechar.
        paletteOpenerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPaletteOpen((current) => !current);
      }
      // Escape é do Radix Dialog: fecha com animação, limpa a busca e
      // devolve o foco ao elemento que abriu a paleta.
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  async function changeModel(model: string) {
    if (newChatDraft) {
      setNewChatModel(model);
      return;
    }
    if (!activeSession || !activeProvider) return;
    // Sem try/catch: o Composer exibe falha INLINE no próprio menu (#208);
    // engolir aqui fecharia o menu como sucesso silencioso.
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
  }

  async function selectProvider(nextProvider: ConnectedProvider) {
    setActiveProvider(nextProvider);
    // Trocar provedor limpa o modelo incompatível e aplica o default somente
    // quando ele existe; a escolha é persistida explicitamente na sessão.
    const nextModel = nextProvider.model?.trim() || "";
    if (newChatDraft) {
      setNewChatModel(nextModel);
      return;
    }
    if (!activeSession) return;
    try {
      const session = await setSessionModel(activeSession.id, nextModel, nextProvider.id);
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
    setNewChatDraft(false);
    setSwitchingSession(true);
    try {
      const nextState = await selectSession(sessionId);
      activeSessionIdRef.current = sessionId;
      const nextSession = nextState.sessions.find((item) => item.id === sessionId);
      const resolvedProvider = nextSession?.selectedProviderId
        ? (providers.find((item) => item.id === nextSession.selectedProviderId) ??
          providers[0] ??
          null)
        : (providers[0] ?? null);
      // Sessão sem modelo e provedor com padrão: aplica e persiste a escolha
      // explicitamente (selectedProviderId + selectedModel) na seleção.
      if (nextSession && !nextSession.selectedModel?.trim() && resolvedProvider?.model?.trim()) {
        try {
          const updated = await setSessionModel(
            sessionId,
            resolvedProvider.model.trim(),
            resolvedProvider.id,
          );
          Object.assign(nextSession, updated);
          nextState.recentSessions = nextState.recentSessions.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          );
          nextState.sessions = nextState.sessions.map((item) =>
            item.id === updated.id ? updated : item,
          );
        } catch {
          // Persistência do default é uma conveniência; não bloqueia a abertura.
        }
      }
      setState(nextState);
      setActiveProvider(resolvedProvider);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotOpenTheSession"));
    } finally {
      setSwitchingSession(false);
    }
  }

  async function openWorkspace(workspaceId: string) {
    if (workspaceId === workspace?.id) return;
    setNewChatDraft(false);
    const wasWithoutWorkspace = !workspace;
    setError("");
    setSwitchingSession(true);
    try {
      const nextState = await selectWorkspace(workspaceId);
      activeSessionIdRef.current = nextState.activeSessionId;
      const nextSession = nextState.sessions.find((item) => item.id === nextState.activeSessionId);
      const resolvedProvider = nextSession?.selectedProviderId
        ? (providers.find((item) => item.id === nextSession.selectedProviderId) ??
          providers[0] ??
          null)
        : (providers[0] ?? null);
      // Mesma regra do openSession: default do provedor é aplicado e
      // persistido explicitamente quando a sessão ainda não tem modelo.
      if (nextSession && !nextSession.selectedModel?.trim() && resolvedProvider?.model?.trim()) {
        try {
          const updated = await setSessionModel(
            nextSession.id,
            resolvedProvider.model.trim(),
            resolvedProvider.id,
          );
          Object.assign(nextSession, updated);
          nextState.recentSessions = nextState.recentSessions.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          );
          nextState.sessions = nextState.sessions.map((item) =>
            item.id === updated.id ? updated : item,
          );
        } catch {
          // Conveniência; não bloqueia a troca de workspace.
        }
      }
      setState(nextState);
      setActiveProvider(resolvedProvider);
      if (wasWithoutWorkspace) {
        dispatchVaultView({ type: "workspace-changed", hasWorkspace: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("chat.couldNotOpenTheWorkspace"));
    } finally {
      setSwitchingSession(false);
    }
  }

  async function newSession() {
    if (!state?.activeProfileId || isCreatingSession) return;
    setNewChatDraft(false);
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

  function openNewChatDraft() {
    pendingDraftRef.current = null;
    pendingDraftSessionRef.current = null;
    setNewChatDraft(true);
    setNewChatModel(activeProvider?.model?.trim() || "");
    setDraft("");
    setAttachments([]);
    setAttachmentStatus("");
    setShowUsageDetails(false);
    setError("");
    setResourceNotice("");
    setUsageSummary(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function createSessionForPendingDraft() {
    if (!state?.activeProfileId || isCreatingSession) return;
    setIsCreatingSession(true);
    setError("");
    try {
      let session = await createSession(workspace?.id ?? null, undefined, state.activeProfileId);
      if (newChatModel && activeProvider) {
        try {
          session = await setSessionModel(session.id, newChatModel, activeProvider.id);
        } catch {
          // A model choice is a convenience; the session can still start.
        }
      }
      pendingDraftSessionRef.current = session.id;
      setNewChatDraft(false);
      await openSession(session.id);
    } catch (reason) {
      pendingDraftRef.current = null;
      pendingDraftSessionRef.current = null;
      setError(reason instanceof Error ? reason.message : t("chat.couldNotCreateTheSession"));
    } finally {
      setIsCreatingSession(false);
    }
  }

  newSessionRef.current = openNewChatDraft;

  function newWorkspace() {
    setResourceNotice("");
    setSettingsSection("workspaces");
    setShowSettings(true);
  }

  function openProvidersCenter() {
    setSettingsSection("providers");
    setShowSettings(true);
  }

  function openSettings() {
    setSettingsSection("usage");
    setShowSettings(true);
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
    try {
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
      const resolvedProvider = session.selectedProviderId
        ? (providers.find((item) => item.id === session.selectedProviderId) ?? providers[0] ?? null)
        : (providers[0] ?? null);
      // Sessão recém-criada herda o default do provedor de forma explícita
      // quando ele existe; sem default, nasce sem modelo escolhido.
      if (!session.selectedModel?.trim() && resolvedProvider?.model?.trim()) {
        try {
          const updated = await setSessionModel(
            session.id,
            resolvedProvider.model.trim(),
            resolvedProvider.id,
          );
          nextStateWithWorkspace.recentSessions = nextStateWithWorkspace.recentSessions.map(
            (item) => (item.id === updated.id ? { ...item, ...updated } : item),
          );
          nextStateWithWorkspace.sessions = nextStateWithWorkspace.sessions.map((item) =>
            item.id === updated.id ? updated : item,
          );
          setState({ ...nextStateWithWorkspace });
        } catch {
          // Conveniência; não bloqueia a ativação do workspace.
        }
      }
      setActiveProvider(resolvedProvider);
      dispatchVaultView({ type: "workspace-changed", hasWorkspace: true });
      setResourceNotice("");
    } catch (reason) {
      // Única ação de fluxo sem tratamento — falha aqui virava unhandled
      // rejection sem feedback nenhum para o usuário.
      setError(reason instanceof Error ? reason.message : t("errors.openWorkspace"));
    }
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
      setError(reason instanceof Error ? reason.message : t("errors.renameSession"));
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

  function requestDelete(session: SessionSummary) {
    if (skipSessionDeleteConfirmation) {
      void remove(session.id);
      return;
    }
    setSessionToDelete({ id: session.id, title: session.title });
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
      const message = reason instanceof Error ? reason.message : t("errors.savePermissions");
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
    setAttachmentStatus(t("chat.indexingAttachment", { name: file.name }));
    setError("");
    try {
      const attachment = await uploadAttachment(file, workspace.id, activeSession.id);
      setAttachments((current) => [...current, attachment]);
      setAttachmentStatus(t("chat.attachmentIndexed", { name: attachment.filename }));
    } catch (reason) {
      setAttachmentStatus("");
      setError(reason instanceof Error ? reason.message : t("errors.indexAttachment"));
    }
  }

  async function detachFile(attachment: Attachment) {
    try {
      await removeAttachment(attachment.id);
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setAttachmentStatus(t("chat.attachmentRemoved", { name: attachment.filename }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errors.removeAttachment"));
    }
  }

  async function undoSavedVaultNote() {
    if (!workspace || !vaultNoteConfirmation || vaultNoteConfirmation.undoing) return;
    setVaultNoteConfirmation((current) => (current ? { ...current, undoing: true } : current));
    try {
      await undoVaultRevision(workspace.id, vaultNoteConfirmation.revisionId);
      setVaultNoteConfirmation(null);
      setVaultRefreshKey((key) => key + 1);
    } catch (reason) {
      setVaultNoteConfirmation((current) => (current ? { ...current, undoing: false } : current));
      setError(reason instanceof Error ? reason.message : t("chat.couldNotUndoVaultNote"));
    }
  }

  const visibleMessages = (newChatDraft ? [] : messages).filter(
    (message) =>
      !(message.role === "assistant" && !message.content.trim() && message.toolCalls?.length),
  );
  const isEmpty = !switchingSession && visibleMessages.length === 0;

  const chatArea = (
    // h-full garante ancoragem inferior estável também dentro do painel
    // redimensionável (sem ela, o composer sobe com o conteúdo ao abrir o Vault).
    <section className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center border-b border-neutral-900/80 bg-[#0a0a0b] px-4 md:px-6">
        {ctxLabel && (
          <button
            aria-haspopup="dialog"
            className="rounded px-1.5 py-1 font-mono text-[0.68rem] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
            onClick={() => setShowUsageDetails(true)}
            title={t("chat.viewFullUsage")}
            type="button"
          >
            {ctxLabel}
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col px-4 md:px-6">
          {switchingSession && (
            <EnterExit className="px-1 pt-2" offsetPx={4} show>
              <div aria-busy="true" role="status">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-4 h-16" />
                <Skeleton className="mt-4 h-10 w-2/3" />
              </div>
            </EnterExit>
          )}
          {isEmpty ? (
            // Estado vazio sem ilustração decorativa: saudação + orientação.
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <h1 className="text-2xl font-medium tracking-tight text-foreground">
                {greeting}, {name}
              </h1>
              <p className="mt-2 text-xs text-muted-foreground">
                {workspace ? t("chat.whatWillWeBuildToday") : t("chat.chatFreelyAddAFolder")}
              </p>
            </div>
          ) : (
            <ChatThread
              copiedMessageId={copiedMessageId}
              copyMessage={(message) => void copyMessage(message)}
              cursorAvoidanceEnabled={cursorAvoidanceEnabled}
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
        </div>
      </div>
      <div className="w-full px-4 pb-4 md:px-6">
        <div className="mx-auto w-full max-w-4xl">
          {attachments.length > 0 && (
            <ul
              className="m-0 mb-2 flex list-none flex-wrap items-center gap-1.5 p-0"
              aria-label={t("chat.indexedAttachments")}
            >
              {attachments.map((attachment) => (
                <li
                  className="flex items-center gap-0.5 font-mono text-xs text-muted-foreground"
                  key={attachment.id}
                >
                  <span>[{attachment.filename}</span>
                  <button
                    aria-label={`${t("chat.remove")} ${attachment.filename}`}
                    className="transition-colors duration-[120ms] hover:text-destructive focus-visible:outline-none"
                    onClick={() => setAttachmentToRemove(attachment)}
                    type="button"
                  >
                    ×]
                  </button>
                </li>
              ))}
            </ul>
          )}
          {toolApproval && <ApprovalCard onResolve={resolveToolDecision} request={toolApproval} />}
          {vaultNoteConfirmation && (
            <EnterExit className="mb-2" offsetPx={4} show>
              <div
                aria-busy={vaultNoteConfirmation.undoing}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-[#121215] px-3 py-2 font-mono text-xs"
                role="status"
              >
                <span className="min-w-0 flex-1 truncate">
                  {t("chat.noteSavedInVault", { path: vaultNoteConfirmation.path })}
                </span>
                <button
                  className="text-button"
                  onClick={() => {
                    setSelectedNotePath(vaultNoteConfirmation.path);
                    dispatchVaultView({ type: "shortcut-activated", tab: "files" });
                  }}
                  type="button"
                >
                  {t("chat.openVaultNote")}
                </button>
                <button
                  className="text-button"
                  disabled={vaultNoteConfirmation.undoing}
                  onClick={() => void undoSavedVaultNote()}
                  type="button"
                >
                  {vaultNoteConfirmation.undoing
                    ? t("chat.undoingVaultNote")
                    : t("chat.undoVaultNote")}
                </button>
                <button
                  aria-label={t("chat.dismiss")}
                  className="text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
                  onClick={() => setVaultNoteConfirmation(null)}
                  type="button"
                >
                  ✕
                </button>
              </div>
            </EnterExit>
          )}
          <Composer
            activeProvider={activeProvider}
            activeSessionId={newChatDraft ? "draft" : activeSession?.id}
            changeModel={changeModel}
            changePermissionMode={(mode) => void changePermissionMode(mode)}
            composerRef={composerRef}
            draft={draft}
            isModelsLoading={!modelsReady}
            isSending={isSending}
            modelName={modelName}
            models={models}
            onAttachFile={(file) => void attachFile(file)}
            onEditQueued={() => {
              const next = pullQueuedDraft();
              if (next !== null) setDraft(next);
              composerRef.current?.focus();
            }}
            onOpenProviders={openProvidersCenter}
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft();
            }}
            permissionError={permissionError}
            queuedCount={queuedCount}
            queuedPreview={queuedPreview}
            selectedModel={selectedModel}
            setDraft={setDraft}
            stopGeneration={stopGeneration}
            workspace={workspace}
          />
          {attachmentStatus && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">{attachmentStatus}</p>
          )}
          {resourceNotice && (
            <div className="resource-gate" role="alert">
              <span>{resourceNotice}</span>
              <button className="text-button" onClick={newWorkspace} type="button">
                {t("chat.addAWorkspaceInSettings")}
              </button>
            </div>
          )}
          {(error || chatError) && (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground"
              role="alert"
            >
              <span aria-hidden="true">⚠</span>
              <span className="min-w-0 flex-1 truncate">{error || chatError}</span>
              {!isSending && messages.length > 0 && (
                <button
                  className="transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
                  onClick={() => {
                    setError("");
                    clearError();
                    regenerate();
                  }}
                  type="button"
                >
                  {t("chat.retry")}
                </button>
              )}
              <button
                aria-label={t("chat.dismiss")}
                className="transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
                onClick={() => {
                  setError("");
                  clearError();
                }}
                type="button"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <ChatRuntimeProvider runtime={runtime}>
      <main
        className={`flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
        <ChatHeader
          onToggleSidebar={toggleSidebar}
          onToggleVault={() => {
            if (!workspace) {
              // Sem workspace o botão permanece visível e explica o bloqueio.
              setResourceNotice(t("chat.selectAFolderToConfigure"));
              return;
            }
            setResourceNotice("");
            dispatchVaultView({ type: "toggle-requested", hasWorkspace: true });
          }}
          sessionTitle={newChatDraft ? t("chat.newConversation") : activeSession?.title}
          sidebarCollapsed={sidebarCollapsed}
          vaultBlocked={!workspace}
          vaultMode={workspace ? vaultView.mode : "rail"}
        />

        <div className="flex min-h-0 w-full flex-1">
          <ResizablePanelGroup
            className="min-h-0 flex-1"
            onLayoutChanged={handleSidebarLayout}
            orientation="horizontal"
          >
            <ResizablePanel
              className="min-w-0"
              collapsible={sidebarCollapseArmed}
              collapsedSize={0}
              defaultSize={sidebarWidth}
              disabled={sidebarCollapsed}
              id="bw-sidebar"
              maxSize={maximumSidebarWidth}
              minSize={minimumSidebarWidth}
              panelRef={sidebarPanelRef}
            >
              <SessionsSidebar
                activeProfile={activeProfile}
                activeSessionId={newChatDraft ? undefined : activeSession?.id}
                collapsed={sidebarCollapsed}
                cursorAvoidanceEnabled={cursorAvoidanceEnabled}
                hasActiveProfile={Boolean(state?.activeProfileId)}
                isCreatingSession={isCreatingSession}
                name={name}
                newSession={() => void newSession()}
                newWorkspace={() => void newWorkspace()}
                onDeleteRequest={requestDelete}
                onRenameRequest={(session) => {
                  setRenameDraft(session.title);
                  setSessionToRename({ id: session.id, title: session.title });
                }}
                onTogglePalette={(event) => {
                  paletteOpenerRef.current =
                    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
                  setPaletteOpen(true);
                }}
                openSession={(sessionId) => void openSession(sessionId)}
                openWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
                openSettings={() => {
                  setSettingsSection("usage");
                  setShowSettings(true);
                }}
                recentSessions={recentSessions}
                recentSessionsRef={recentSessionsRef}
                settingsButtonRef={settingsButtonRef}
                setCursorAvoidanceEnabled={setCursorAvoidanceEnabled}
                workspace={workspace}
                workspaces={state?.workspaces ?? []}
              />
            </ResizablePanel>
            <ResizableHandle
              aria-label={t("sessions.resizeSidebar")}
              className="cursor-col-resize bg-transparent after:cursor-col-resize hover:bg-neutral-800/70"
            />

            <ResizablePanel
              className="flex min-h-0 min-w-0"
              defaultSize={Math.max(360, window.innerWidth - sidebarWidth - 1)}
              id="bw-workspace"
              minSize={360}
            >
              <div className="relative h-full min-h-0 w-full min-w-0 flex-1">
                <div
                  className={`absolute inset-0 z-10 ${showSettings ? "pointer-events-auto" : "pointer-events-none"}`}
                >
                  <EnterExit className="h-full min-h-0 w-full" show={showSettings}>
                    <ProviderManager
                      activeSessionId={state?.activeSessionId ?? null}
                      activeWorkspaceId={state?.activeWorkspaceId ?? null}
                      activeProviderId={activeProvider?.id ?? null}
                      onClose={() => setShowSettings(false)}
                      onSectionChange={setSettingsSection}
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
                      section={settingsSection}
                      workspaces={state?.workspaces ?? []}
                    />
                  </EnterExit>
                </div>
                {!showSettings && (
                  <div className="h-full min-h-0">
                    {(() => {
                      if (!workspace) {
                        return chatArea;
                      }
                      if (vaultView.mode === "expanded") {
                        return (
                          <ResizablePanelGroup
                            className="min-h-0 flex-1"
                            orientation="horizontal"
                            onLayoutChanged={handleSplitLayout}
                          >
                            <ResizablePanel className="min-w-0" id="bw-main" minSize={360}>
                              {chatArea}
                            </ResizablePanel>
                            <ResizableHandle aria-label={t("vault.resizeVaultPanel")} />
                            <ResizablePanel
                              className="min-w-0"
                              defaultSize={vaultWidth}
                              id="bw-vault"
                              maxSize={maximumVaultWidth}
                              minSize={minimumVaultWidth}
                            >
                              <div className="h-full w-full min-w-0" id="bw-vault-panel">
                                <VaultSlot
                                  cursorAvoidanceEnabled={cursorAvoidanceEnabled}
                                  memory={vaultMemory}
                                  onMemoryChange={setVaultMemory}
                                  onSelectPath={setSelectedNotePath}
                                  onTabChange={(tab) => {
                                    dispatchVaultView({ type: "tab-changed", tab });
                                  }}
                                  refreshKey={vaultRefreshKey}
                                  selectedPath={selectedNotePath}
                                  tab={vaultView.tab}
                                  workspaceId={workspace.id}
                                />
                              </div>
                            </ResizablePanel>
                          </ResizablePanelGroup>
                        );
                      }
                      return (
                        <>
                          {chatArea}
                          <VaultRail
                            activeTab={vaultView.tab}
                            onOpenFiles={() => {
                              dispatchVaultView({ type: "shortcut-activated", tab: "files" });
                            }}
                            onOpenGraph={() => {
                              dispatchVaultView({ type: "shortcut-activated", tab: "graph" });
                            }}
                          />
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
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
            dontAskAgain={skipSessionDeleteConfirmation}
            dontAskAgainLabel={t("chat.dontAskAgain")}
            onCancel={() => setSessionToDelete(null)}
            onConfirm={() => {
              const session = sessionToDelete;
              setSessionToDelete(null);
              void remove(session.id);
            }}
            onDontAskAgainChange={(checked) => {
              setSkipSessionDeleteConfirmation(checked);
              writeBooleanPreference(skipSessionDeleteConfirmationPreference, checked);
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
        <CommandPalette
          onClose={() => {
            setPaletteOpen(false);
            // Retorno de foco determinístico (clique OU atalho).
            const opener = paletteOpenerRef.current;
            requestAnimationFrame(() => opener?.focus());
          }}
          onFocusModelSelector={
            activeProvider
              ? () => {
                  document
                    .querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')
                    ?.focus();
                }
              : undefined
          }
          onNewSession={() => void newSession()}
          onOpenNote={
            workspace
              ? () => {
                  dispatchVaultView({ type: "shortcut-activated", tab: "files" });
                }
              : undefined
          }
          onOpenProfileChooser={() => void onSignOut()}
          onOpenSession={(sessionId) => void openSession(sessionId)}
          onOpenProviders={openProvidersCenter}
          onOpenSettings={openSettings}
          onOpenSoulSection={() => {
            setSettingsSection("profile");
            setShowSettings(true);
          }}
          open={paletteOpen}
          paletteQuery={paletteQuery}
          recentSessions={recentSessions}
          setPaletteQuery={setPaletteQuery}
        />
      </main>
    </ChatRuntimeProvider>
  );
}
