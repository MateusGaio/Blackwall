// MIT License — Copyright (c) 2026 Mateus Gaio

import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import { ConversationSummaryCard } from "../../../app/ConversationSummaryCard";
import { CompactIcon } from "../../../app/shell/CompactIcon";
import type { ChatMessage } from "../../../shared/api/sidecar";
import { SafeMarkdown } from "../../../shared/components/SafeMarkdown";

type ChatThreadProps = {
  copiedMessageId: string | null;
  copyMessage: (message: ChatMessage) => void;
  editingMessageDraft: string;
  editingMessageId: string | null;
  listRef: RefObject<HTMLOListElement | null>;
  onEditCancel: () => void;
  onEditChange: (draft: string) => void;
  onEditSubmit: (messageId: string, draft: string) => void;
  onEditingStart: (message: ChatMessage) => void;
  regenerate: () => void;
  streamingId: string | null;
  streamingStatus: string;
  visibleMessages: readonly ChatMessage[];
};

type GhostItem = { key: string; message: ChatMessage };

/**
 * Mensagem removida da lista (regenerar/editar) que permanece montada apenas
 * para executar a transição de saída (ADR-09 item 3) antes de desmontar.
 */
function ExitingMessage({ message, onExited }: { message: ChatMessage; onExited: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (leaving) return;
    const frame = requestAnimationFrame(() => setLeaving(true));
    return () => cancelAnimationFrame(frame);
  }, [leaving]);
  return (
    <EnterExit
      as="li"
      className={`message message-${message.role}`}
      onExited={onExited}
      show={!leaving}
    >
      <SafeMarkdown content={message.content} />
    </EnterExit>
  );
}

export function ChatThread({
  copiedMessageId,
  copyMessage,
  editingMessageDraft,
  editingMessageId,
  listRef,
  onEditCancel,
  onEditChange,
  onEditSubmit,
  onEditingStart,
  regenerate,
  streamingId,
  streamingStatus,
  visibleMessages,
}: ChatThreadProps) {
  const { t } = useTranslation();
  const previousRef = useRef(visibleMessages);
  const ghostKey = useRef(0);
  const [ghosts, setGhosts] = useState<GhostItem[]>([]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = visibleMessages;
    if (previous === visibleMessages || previous.length === 0) return;
    const currentIds = new Set(visibleMessages.map((message) => message.id));
    const currentContent = new Set(
      visibleMessages.map((message) => `${message.role}:${message.content}`),
    );
    // Remoções reais apenas: reconciliação com o servidor troca ids mas preserva
    // papel+conteúdo — essa troca NÃO é saída de mensagem (evita duplicar no DOM).
    const removed = previous.filter(
      (message) =>
        !currentIds.has(message.id) && !currentContent.has(`${message.role}:${message.content}`),
    );
    if (removed.length === 0) return;
    const overlap = previous.length - removed.length;
    // Troca integral (ex.: troca de sessão) não anima saída — evita flash.
    if (overlap === 0) {
      setGhosts([]);
      return;
    }
    ghostKey.current += 1;
    const batch = ghostKey.current;
    setGhosts(
      removed.slice(-2).map((message) => ({ key: `ghost-${batch}-${message.id}`, message })),
    );
  }, [visibleMessages]);

  return (
    <ol className="message-list" ref={listRef}>
      {visibleMessages.map((message) =>
        message.isSummary ? (
          <ConversationSummaryCard content={message.content} key={message.id} />
        ) : (
          <EnterExit
            as="li"
            className={`message message-${message.role}${message.id === streamingId ? " message-streaming" : ""}`}
            key={message.id}
            offsetPx={6}
            show
          >
            {editingMessageId === message.id ? (
              <form
                className="message-edit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onEditSubmit(message.id, editingMessageDraft);
                }}
              >
                <textarea
                  aria-label={t("chat.editMessage")}
                  onChange={(event) => onEditChange(event.target.value)}
                  value={editingMessageDraft}
                />
                <div className="message-actions">
                  <button className="button button-secondary" onClick={onEditCancel} type="button">
                    {t("chat.cancel")}
                  </button>
                  <button className="button button-primary" type="submit">
                    {t("chat.saveAndRegenerate")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {message.content.trim() ? (
                  <SafeMarkdown content={message.content} />
                ) : (
                  message.id === streamingId && <p>{streamingStatus}</p>
                )}
                {message.id === streamingId && (
                  <span aria-hidden="true" className="streaming-cursor" />
                )}
                {!message.isSummary && message.id !== streamingId && (
                  <div className="action-bar" data-action-bar>
                    {message.role === "user" && (
                      <button
                        aria-label={t("chat.editMessage")}
                        className="action-bar-button"
                        onClick={() => onEditingStart(message)}
                        title={t("chat.edit")}
                        type="button"
                      >
                        <CompactIcon kind="edit" />
                      </button>
                    )}
                    {message.role === "assistant" && message.id === visibleMessages.at(-1)?.id && (
                      <>
                        <button
                          aria-label={t("chat.copyMessage")}
                          className="action-bar-button"
                          onClick={() => copyMessage(message)}
                          title={copiedMessageId === message.id ? t("chat.copied") : t("chat.copy")}
                          type="button"
                        >
                          {copiedMessageId === message.id ? (
                            <span aria-hidden="true">✓</span>
                          ) : (
                            <CompactIcon kind="copy" />
                          )}
                        </button>
                        <button
                          aria-label={t("chat.regenerateResponse")}
                          className="action-bar-button"
                          onClick={regenerate}
                          title={t("chat.regenerate")}
                          type="button"
                        >
                          <CompactIcon kind="refresh" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </EnterExit>
        ),
      )}
      {ghosts.map((ghost) => (
        <ExitingMessage
          key={ghost.key}
          message={ghost.message}
          onExited={() => setGhosts((current) => current.filter((item) => item.key !== ghost.key))}
        />
      ))}
    </ol>
  );
}
