// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  type AppState,
  type Attachment,
  type ChatMessage,
  type ConnectedProvider,
  createSession,
  getAppState,
  listStoredProviderModels,
  type ProviderModel,
  persistMessage,
  removeAttachment,
  searchAttachments,
  selectSession,
  setSessionModel,
  streamMessage,
  uploadAttachment,
} from "../shared/api/sidecar";
import { isSubmitShortcut } from "./composer";

type WorkspaceShellProps = {
  appState: AppState | null;
  profileName: string;
  provider: ConnectedProvider | null;
};

export default function WorkspaceShell({ appState, profileName, provider }: WorkspaceShellProps) {
  const [state, setState] = useState(appState);
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
  const selectedModel = activeSession?.selectedModel ?? provider?.model ?? models[0]?.id ?? "";

  useEffect(() => {
    if (!provider) return;
    setModels([{ capabilities: [], id: provider.model, name: provider.model }]);
    void listStoredProviderModels(provider.id)
      .then((available) =>
        setModels(
          available.length > 0
            ? available
            : [{ capabilities: [], id: provider.model, name: provider.model }],
        ),
      )
      .catch(() => undefined);
  }, [provider]);

  async function changeModel(model: string) {
    if (!activeSession || !provider) return;
    try {
      const session = await setSessionModel(activeSession.id, model, provider.id);
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

  async function newSession() {
    if (!workspace || isCreatingSession) return;
    setIsCreatingSession(true);
    setError("");
    try {
      const session = await createSession(workspace.id);
      await openSession(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a sessão.");
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    const sessionId = state?.activeSessionId;
    if (!content || !provider || !sessionId || isSending) return;
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
        provider.id,
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
          providerId: result.provider?.id ?? provider.id,
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
    <main className="workspace-shell">
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
            <button aria-label="Criar workspace" className="icon-button" type="button">
              +
            </button>
          </div>
          {workspace && (
            <div className="workspace-item is-active">
              <strong>{workspace.name}</strong>
              <span>{workspace.rootPath}</span>
            </div>
          )}
        </div>
        <div className="sidebar-section sidebar-sessions">
          <div className="sidebar-section-heading">
            <p className="eyebrow">Sessões</p>
            <button
              aria-label="Nova sessão"
              className="icon-button"
              disabled={isCreatingSession || !workspace}
              onClick={() => void newSession()}
              type="button"
            >
              +
            </button>
          </div>
          <nav aria-label="Sessões do workspace">
            {state?.sessions.map((session) => (
              <button
                className={`session-item ${session.id === activeSession?.id ? "is-active" : ""}`}
                key={session.id}
                onClick={() => void openSession(session.id)}
                type="button"
              >
                {session.title}
              </button>
            ))}
          </nav>
        </div>
        <button className="sidebar-settings" type="button">
          Configurações
        </button>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{workspace?.name ?? "Workspace"}</p>
            <p className="workspace-session-title">{activeSession?.title ?? "Nova conversa"}</p>
          </div>
          <div className="chat-controls">
            <p className="eyebrow">{provider?.name ?? "sem provedor"}</p>
            {provider && (
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
          </div>
        </header>
        <section className="chat-shell" aria-label="Conversa">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p className="eyebrow">Pronto, {name}</p>
              <h1>Nenhuma conversa por ora — envie uma mensagem para começar.</h1>
              <p>As respostas serão enviadas por {provider?.name ?? "seu provedor local"}.</p>
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
              disabled={!provider || !activeSession || isSending}
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
                disabled={!draft.trim() || !provider || !activeSession}
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
    </main>
  );
}
