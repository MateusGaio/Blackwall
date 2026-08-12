// MIT License — Copyright (c) 2026 Mateus Gaio
import {
  type FormEvent,
  type KeyboardEvent,
  lazy,
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
  listProviders,
  listStoredProviderModels,
  type ProviderModel,
  persistMessage,
  removeAttachment,
  renameSession,
  searchAttachments,
  selectSession,
  selectWorkspace,
  setSessionModel,
  setWorkspacePermissionMode,
  streamMessage,
  uploadAttachment,
} from "../shared/api/sidecar";
import { isSubmitShortcut } from "./composer";
import { greetingForTime } from "./greetings";

const VaultPanel = lazy(async () => {
  const module = await import("../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type WorkspaceShellProps = {
  appState: AppState | null;
  profileName: string;
  provider: ConnectedProvider | null;
};

export default function WorkspaceShell({ appState, profileName, provider }: WorkspaceShellProps) {
  const [state, setState] = useState(appState);
  const [providers, setProviders] = useState<ConnectedProvider[]>(provider ? [provider] : []);
  const [activeProvider, setActiveProvider] = useState<ConnectedProvider | null>(provider);
  const [showSettings, setShowSettings] = useState(false);
  const [showVault, setShowVault] = useState(Boolean(appState?.activeWorkspaceId));
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const activeStream = useRef<{ stop: () => void } | null>(null);

  const name = profileName.trim() || "você";
  const profileLocale = state?.profiles.find(
    (profile) => profile.id === state.activeProfileId,
  )?.locale;
  const greeting = greetingForTime(new Date(), profileLocale);
  const workspace = state?.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const activeSession = state?.sessions.find((item) => item.id === state.activeSessionId);
  const recentSessions = state?.recentSessions ?? [];
  const selectedModel =
    activeSession?.selectedModel ?? activeProvider?.model ?? models[0]?.id ?? "";

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
      if (!target.closest("[data-session-menu]")) setOpenSessionMenuId(null);
      if (!target.closest("[data-permission-control]")) setPermissionOpen(false);
    }
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenSessionMenuId(null);
      setPermissionOpen(false);
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
    }
  }, [workspace]);

  useEffect(() => {
    if (!activeProvider) return;
    setModels([{ capabilities: [], id: activeProvider.model, name: activeProvider.model }]);
    void listStoredProviderModels(activeProvider.id)
      .then((available) =>
        setModels(
          available.length > 0
            ? available
            : [{ capabilities: [], id: activeProvider.model, name: activeProvider.model }],
        ),
      )
      .catch(() => undefined);
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
      setError(reason instanceof Error ? reason.message : "Não foi possível trocar o modelo.");
    }
  }

  async function openSession(sessionId: string) {
    setError("");
    setOpenSessionMenuId(null);
    try {
      const nextState = await selectSession(sessionId);
      setState(nextState);
      setMessages(nextState.messages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível abrir a sessão.");
    }
  }

  async function openWorkspace(workspaceId: string) {
    if (workspaceId === workspace?.id) return;
    const wasWithoutWorkspace = !workspace;
    setError("");
    try {
      const nextState = await selectWorkspace(workspaceId);
      setState(nextState);
      setMessages(nextState.messages);
      if (wasWithoutWorkspace) setShowVault(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível abrir o workspace.");
    }
  }

  async function newSession() {
    if (!state?.activeProfileId || isCreatingSession) return;
    setIsCreatingSession(true);
    setError("");
    try {
      const session = await createSession(workspace?.id ?? null);
      await openSession(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a sessão.");
    } finally {
      setIsCreatingSession(false);
    }
  }

  function newWorkspace() {
    setResourceNotice("");
    setShowSettings(true);
  }

  async function activateWorkspace(created: NonNullable<typeof workspace>) {
    if (state?.workspaces.some((item) => item.id === created.id)) {
      await openWorkspace(created.id);
      return;
    }
    const session = await createSession(created.id);
    const nextState = await selectSession(session.id);
    setState(nextState);
    setMessages(nextState.messages);
    setShowVault(true);
    setResourceNotice("");
  }

  async function rename(sessionId: string, currentTitle: string) {
    const title = window.prompt("Nome da sessão", currentTitle)?.trim();
    if (!title || title === currentTitle) return;
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível renomear a sessão.");
    }
  }

  async function remove(sessionId: string) {
    if (!window.confirm("Excluir esta sessão e seu histórico?")) return;
    try {
      await deleteSession(sessionId);
      const refreshed = await getAppState();
      setState(refreshed);
      setMessages(refreshed.messages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível excluir a sessão.");
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    const sessionId = state?.activeSessionId;
    const selectedProvider = activeProvider;
    if (!content || !selectedProvider || !sessionId || isSending) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { content, id: crypto.randomUUID(), role: "user" },
    ];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setResourceNotice("");
    setIsSending(true);
    setStreamingContent("");
    setStreamingStatus("Consultando…");
    try {
      await persistMessage(sessionId, { content, role: "user", status: "complete" });
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
      const stream = await streamMessage(
        selectedProvider.id,
        contextMessage ? [...nextMessages, contextMessage] : nextMessages,
        selectedModel,
        workspace?.id ?? "default",
        {
          onDelta: (delta) => {
            setStreamingContent((current) => current + delta);
            setStreamingStatus("Gerando…");
          },
          onRetry: (message) => setStreamingStatus(message),
        },
        state?.activeProfileId ?? undefined,
      );
      activeStream.current = stream;
      const result = await stream.done;
      const assistantContent = result.content.trim();
      if (assistantContent) {
        const assistantMessage = {
          content: assistantContent,
          id: crypto.randomUUID(),
          role: "assistant" as const,
        };
        await persistMessage(sessionId, {
          content: assistantMessage.content,
          model: result.provider?.model ?? selectedModel,
          providerId: result.provider?.id ?? selectedProvider.id,
          role: assistantMessage.role,
          status: result.stopped ? "stopped" : "complete",
        });
        setMessages((current) => [...current, assistantMessage]);
      }
      const refreshed = await getAppState();
      setState(refreshed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally {
      activeStream.current = null;
      setStreamingContent("");
      setStreamingStatus("");
      setIsSending(false);
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

  return (
    <main className={`workspace-shell ${showVault && workspace ? "has-vault" : ""}`}>
      <aside className="workspace-sidebar" aria-label="Navegação do workspace">
        <div className="sidebar-heading">
          <span className="brand-mark" aria-hidden="true">
            BW
          </span>
          <div>
            <p className="eyebrow">Perfil</p>
            <strong>{name}</strong>
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-heading">
            <p className="eyebrow">Workspaces</p>
            <button
              aria-label="Criar workspace"
              className="icon-button"
              onClick={() => void newWorkspace()}
              type="button"
            >
              +
            </button>
          </div>
          {workspace && (
            <label className="workspace-picker">
              <span className="sr-only">Workspace atual</span>
              <select
                aria-label="Workspace atual"
                onChange={(event) => void openWorkspace(event.target.value)}
                value={workspace.id}
              >
                {state?.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <span>{workspace.rootPath}</span>
            </label>
          )}
          {!workspace && (
            <div className="workspace-empty">
              <strong>Sem workspace</strong>
              <span>Conversa sem contexto de arquivos.</span>
              <button className="sidebar-config" onClick={() => void newWorkspace()} type="button">
                Adicionar workspace
              </button>
            </div>
          )}
        </div>
        <div className="sidebar-section sidebar-sessions">
          <div className="sidebar-section-heading">
            <p className="eyebrow">Recentes</p>
            <button
              aria-label="Nova sessão"
              className="icon-button"
              disabled={isCreatingSession || !state?.activeProfileId}
              onClick={() => void newSession()}
              type="button"
            >
              +
            </button>
          </div>
          <nav aria-label="Sessões recentes">
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
                    <small>{session.workspaceName ?? "Sem workspace"}</small>
                  </span>
                </button>
                <button
                  aria-expanded={openSessionMenuId === session.id}
                  aria-haspopup="menu"
                  aria-label={`Ações de ${session.title}`}
                  className="session-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenSessionMenuId((current) => (current === session.id ? null : session.id));
                  }}
                  type="button"
                >
                  …
                </button>
                {openSessionMenuId === session.id && (
                  <div className="session-menu" role="menu">
                    <button
                      onClick={() => {
                        setOpenSessionMenuId(null);
                        void rename(session.id, session.title);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Renomear
                    </button>
                    <button
                      className="session-menu-danger"
                      onClick={() => {
                        setOpenSessionMenuId(null);
                        void remove(session.id);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>
        <div className="sidebar-settings">
          <button className="sidebar-config" onClick={() => setShowSettings(true)} type="button">
            Configurações de provedores
          </button>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{workspace?.name ?? "Sem workspace"}</p>
            <p className="workspace-session-title">{activeSession?.title ?? "Nova conversa"}</p>
          </div>
          <div className="chat-controls">
            <p className="eyebrow">{activeProvider?.name ?? "sem provedor"}</p>
            {activeProvider && (
              <label className="model-selector">
                <span className="sr-only">Modelo</span>
                <select
                  onChange={(event) => void changeModel(event.target.value)}
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
            <button
              aria-pressed={Boolean(workspace && showVault)}
              className={`header-toggle ${showVault && workspace ? "is-active" : ""}`}
              onClick={() => {
                if (!workspace) {
                  setResourceNotice(
                    "Para usar o Vault e o grafo, selecione uma pasta para configurar seu workspace.",
                  );
                  return;
                }
                setResourceNotice("");
                setShowVault((current) => !current);
              }}
              type="button"
            >
              Vault
            </button>
          </div>
        </header>
        <section
          className={`chat-shell ${messages.length === 0 ? "is-empty" : ""}`}
          aria-label="Conversa"
        >
          {messages.length === 0 ? (
            <div className="empty-state">
              <h1>
                {greeting}, {name}
              </h1>
              <p>
                {workspace
                  ? "O que vamos construir hoje?"
                  : "Converse livremente. Adicione uma pasta quando quiser usar arquivos e o Vault."}
              </p>
            </div>
          ) : (
            <ol className="message-list">
              {messages.map((message) => (
                <li className={`message message-${message.role}`} key={message.id}>
                  {message.content}
                </li>
              ))}
              {isSending && (
                <li className="message message-assistant message-streaming">
                  {streamingContent || streamingStatus}
                  <span aria-hidden="true" className="streaming-cursor" />
                </li>
              )}
            </ol>
          )}
          {attachments.length > 0 && (
            <ul className="attachment-list" aria-label="Anexos indexados">
              {attachments.map((attachment) => (
                <li className="attachment-chip" key={attachment.id}>
                  <span>{attachment.filename}</span>
                  <button
                    aria-label={`Remover ${attachment.filename}`}
                    onClick={() => void detachFile(attachment)}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
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
              aria-label="Anexar arquivo"
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
                  aria-label="Modo de permissões"
                  className="composer-permission"
                  onClick={() => setPermissionOpen((current) => !current)}
                  title={`Permissões: ${
                    workspace.permissionMode === "ask"
                      ? "Perguntar sempre"
                      : workspace.permissionMode === "automatic"
                        ? "Automático"
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
                    <p>Permissões</p>
                    {(
                      [
                        ["ask", "Perguntar sempre"],
                        ["automatic", "Automático"],
                        ["read-only", "Somente leitura"],
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
              aria-label="Mensagem"
              disabled={!activeProvider || !activeSession || isSending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Envie uma mensagem…"
              rows={1}
              value={draft}
            />
            {isSending ? (
              <button className="button button-secondary" onClick={stopGeneration} type="button">
                Parar
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={!draft.trim() || !activeProvider || !activeSession}
                type="submit"
              >
                Enviar
              </button>
            )}
          </form>
          {attachmentStatus && <p className="attachment-status">{attachmentStatus}</p>}
          {resourceNotice && (
            <div className="resource-gate" role="alert">
              <span>{resourceNotice}</span>
              <button className="text-button" onClick={newWorkspace} type="button">
                Adicionar workspace nas configurações
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
        <Suspense fallback={<aside className="vault-panel vault-loading-panel" aria-busy="true" />}>
          <VaultPanel onClose={() => setShowVault(false)} workspaceId={workspace.id} />
        </Suspense>
      )}
      {showSettings && (
        <ProviderManager
          activeWorkspaceId={state?.activeWorkspaceId ?? null}
          onClose={() => setShowSettings(false)}
          onProvidersChange={(next) => {
            setProviders(next);
            setActiveProvider((current) =>
              current
                ? (next.find((item) => item.id === current.id) ?? next[0] ?? null)
                : (next[0] ?? null),
            );
          }}
          onSelect={(next) => setActiveProvider(next)}
          onWorkspaceSelected={activateWorkspace}
          profileId={state?.activeProfileId ?? null}
          providers={providers}
          workspaces={state?.workspaces ?? []}
        />
      )}
      {paletteOpen && (
        <div className="command-backdrop" role="presentation">
          <section aria-label="Command palette" className="command-palette">
            <input
              aria-label="Pesquisar comandos"
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder="Pesquisar sessões e ações…"
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
                Abrir configurações
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
                    Abrir sessão: {session.title}
                  </button>
                ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
