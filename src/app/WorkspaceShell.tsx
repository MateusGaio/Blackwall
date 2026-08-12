// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, type KeyboardEvent, useState } from "react";
import {
  type AppState,
  type ChatMessage,
  type ConnectedProvider,
  createSession,
  getAppState,
  persistMessage,
  selectSession,
  sendMessage,
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

  const name = profileName.trim() || "você";
  const workspace = state?.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const activeSession = state?.sessions.find((item) => item.id === state.activeSessionId);

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
    try {
      await persistMessage(sessionId, { content, role: "user", status: "complete" });
      const result = await sendMessage(provider.id, nextMessages);
      const assistantMessage = {
        content: result.content,
        id: crypto.randomUUID(),
        role: "assistant" as const,
      };
      await persistMessage(sessionId, {
        content: assistantMessage.content,
        model: result.provider.model,
        providerId: result.provider.id,
        role: assistantMessage.role,
        status: "complete",
      });
      setMessages((current) => [...current, assistantMessage]);
      const refreshed = await getAppState();
      setState(refreshed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally {
      setIsSending(false);
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
          <p className="eyebrow">{provider?.name ?? "sem provedor"}</p>
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
                <li className="message message-pending">Consultando {provider?.name}…</li>
              )}
            </ol>
          )}
          <form className="composer" onSubmit={submit}>
            <textarea
              aria-label="Mensagem"
              disabled={!provider || !activeSession || isSending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Envie uma mensagem…"
              rows={1}
              value={draft}
            />
            <button
              className="button button-primary"
              disabled={!draft.trim() || !provider || !activeSession || isSending}
              type="submit"
            >
              Enviar
            </button>
          </form>
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
