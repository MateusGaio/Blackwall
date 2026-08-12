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
import { pickDirectory } from "../platform/runtime";
import {
  type AppState,
  type Attachment,
  type ChatMessage,
  type ConnectedProvider,
  createSession,
  createWorkspace,
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
  const [showVault, setShowVault] = useState(true);
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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const activeStream = useRef<{ stop: () => void } | null>(null);

  const name = profileName.trim() || "você";
  const workspace = state?.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const activeSession = state?.sessions.find((item) => item.id === state.activeSessionId);
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
    setError("");
    try {
      const nextState = await selectWorkspace(workspaceId);
      setState(nextState);
      setMessages(nextState.messages);
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

  async function newWorkspace() {
    const profileId = state?.activeProfileId;
    if (!profileId) return;
    const name = window.prompt("Nome do novo workspace")?.trim();
    if (!name) return;
    const folder = await pickDirectory();
    if (!folder) return;
    try {
      const created = await createWorkspace({
        name,
        profileId,
        rootPath: folder.path ?? "",
        soul: "Preserve o contexto e as convenções deste workspace.",
        workspaceFiles: folder.files,
      });
      const session = await createSession(created.id);
      const nextState = await selectSession(session.id);
      setState(nextState);
      setMessages(nextState.messages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o workspace.");
    }
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
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar as permissões.");
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
    <main className={`workspace-shell ${showVault ? "has-vault" : ""}`}>
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
            <p className="eyebrow">Sessões</p>
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
          <nav aria-label="Sessões do workspace">
            {state?.sessions.map((session) => (
              <div className="session-row" key={session.id}>
                <button
                  className={`session-item ${session.id === activeSession?.id ? "is-active" : ""}`}
                  onClick={() => void openSession(session.id)}
                  onDoubleClick={() => void rename(session.id, session.title)}
                  type="button"
                >
                  {session.title}
                </button>
                <button
                  aria-label={`Renomear ${session.title}`}
                  className="session-more"
                  onClick={() => void rename(session.id, session.title)}
                  type="button"
                >
                  ···
                </button>
                <button
                  aria-label={`Excluir ${session.title}`}
                  className="session-delete"
                  onClick={() => void remove(session.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </nav>
        </div>
        <label className="sidebar-settings">
          <span>Permissões do workspace</span>
          <select
            aria-label="Modo de permissões"
            disabled={!workspace}
            onChange={(event) =>
              void changePermissionMode(
                event.target.value as NonNullable<typeof workspace>["permissionMode"],
              )
            }
            value={workspace?.permissionMode ?? "ask"}
          >
            <option value="ask">Perguntar sempre</option>
            <option value="automatic">Automático</option>
            <option value="read-only">Somente leitura</option>
          </select>
          <button className="sidebar-config" onClick={() => setShowSettings(true)} type="button">
            Configurações de provedores
          </button>
        </label>
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
            {workspace && (
              <button
                aria-pressed={showVault}
                className={`header-toggle ${showVault ? "is-active" : ""}`}
                onClick={() => setShowVault((current) => !current)}
                type="button"
              >
                Vault
              </button>
            )}
          </div>
        </header>
        <section className="chat-shell" aria-label="Conversa">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p className="eyebrow">Pronto, {name}</p>
              <h1>
                Nenhuma conversa por ora — envie uma mensagem para começar
                {workspace ? "." : ", mesmo sem workspace."}
              </h1>
              <p>
                {workspace
                  ? `As respostas serão enviadas por ${activeProvider?.name ?? "seu provedor local"}.`
                  : "Você está no modo sem workspace. Adicione uma pasta quando quiser usar arquivos e o Vault."}
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
          providers={providers}
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
              {state?.sessions
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
