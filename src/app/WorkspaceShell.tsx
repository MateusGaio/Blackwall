// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { type ChatMessage, type ConnectedProvider, sendMessage } from "../shared/api/sidecar";
import { isSubmitShortcut } from "./composer";

type WorkspaceShellProps = {
  profileName: string;
  provider: ConnectedProvider | null;
};

export default function WorkspaceShell({ profileName, provider }: WorkspaceShellProps) {
  const name = profileName.trim() || "você";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !provider || isSending) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { content, id: crypto.randomUUID(), role: "user" },
    ];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setIsSending(true);
    try {
      const result = await sendMessage(provider.id, nextMessages);
      setMessages((current) => [
        ...current,
        { content: result.content, id: crypto.randomUUID(), role: "assistant" },
      ]);
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
      <header>
        <span className="brand-mark" aria-hidden="true">
          BW
        </span>
        <p className="eyebrow">Workspace padrão / {provider?.name ?? "sem provedor"}</p>
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
            aria-describedby="composer-shortcut"
            disabled={!provider || isSending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Envie uma mensagem…"
            rows={1}
            value={draft}
          />
          <button
            className="button button-primary"
            disabled={!draft.trim() || !provider || isSending}
            type="submit"
          >
            Enviar
          </button>
        </form>
        <p className="composer-shortcut" id="composer-shortcut">
          Enter envia · Shift + Enter adiciona uma linha
        </p>
        {error && (
          <p className="form-error chat-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
