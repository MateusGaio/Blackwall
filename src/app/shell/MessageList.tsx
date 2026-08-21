// MIT License — Copyright (c) 2026 Mateus Gaio
import type { RefObject } from "react";
import type { ChatMessage } from "../../shared/api/sidecar";
import { SafeMarkdown } from "../../shared/components/SafeMarkdown";
import { ConversationSummaryCard } from "../ConversationSummaryCard";
import { CompactIcon } from "./CompactIcon";

type MessageListProps = {
  copiedMessageId: string | null;
  copyMessage: (message: ChatMessage) => void;
  editingMessageDraft: string;
  editingMessageId: string | null;
  isEnglish: boolean;
  isSending: boolean;
  listRef: RefObject<HTMLOListElement | null>;
  onEditCancel: () => void;
  onEditChange: (draft: string) => void;
  onEditSubmit: (messageId: string, draft: string) => void;
  onEditingStart: (message: ChatMessage) => void;
  regenerate: () => void;
  streamingContent: string;
  streamingStatus: string;
  visibleMessages: ChatMessage[];
};

export function MessageList({
  copiedMessageId,
  copyMessage,
  editingMessageDraft,
  editingMessageId,
  isEnglish,
  isSending,
  listRef,
  onEditCancel,
  onEditChange,
  onEditSubmit,
  onEditingStart,
  regenerate,
  streamingContent,
  streamingStatus,
  visibleMessages,
}: MessageListProps) {
  return (
    <ol className="message-list" ref={listRef}>
      {visibleMessages.map((message) =>
        message.isSummary ? (
          <ConversationSummaryCard
            content={message.content}
            isEnglish={isEnglish}
            key={message.id}
          />
        ) : (
          <li className={`message message-${message.role}`} key={message.id}>
            {editingMessageId === message.id ? (
              <form
                className="message-edit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onEditSubmit(message.id, editingMessageDraft);
                }}
              >
                <textarea
                  aria-label={isEnglish ? "Edit message" : "Editar mensagem"}
                  onChange={(event) => onEditChange(event.target.value)}
                  value={editingMessageDraft}
                />
                <div className="message-actions">
                  <button className="button button-secondary" onClick={onEditCancel} type="button">
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
                <div className="action-bar" data-action-bar>
                  {message.role === "user" && (
                    <button
                      aria-label={isEnglish ? "Edit message" : "Editar mensagem"}
                      className="action-bar-button"
                      onClick={() => onEditingStart(message)}
                      title={isEnglish ? "Edit" : "Editar"}
                      type="button"
                    >
                      <CompactIcon kind="edit" />
                    </button>
                  )}
                  {message.role === "assistant" && message.id === visibleMessages.at(-1)?.id && (
                    <>
                      <button
                        aria-label={isEnglish ? "Copy message" : "Copiar mensagem"}
                        className="action-bar-button"
                        onClick={() => copyMessage(message)}
                        title={
                          copiedMessageId === message.id
                            ? isEnglish
                              ? "Copied"
                              : "Copiado"
                            : isEnglish
                              ? "Copy"
                              : "Copiar"
                        }
                        type="button"
                      >
                        {copiedMessageId === message.id ? (
                          <span aria-hidden="true">✓</span>
                        ) : (
                          <CompactIcon kind="copy" />
                        )}
                      </button>
                      <button
                        aria-label={isEnglish ? "Regenerate response" : "Regenerar resposta"}
                        className="action-bar-button"
                        onClick={regenerate}
                        title={isEnglish ? "Regenerate" : "Regenerar"}
                        type="button"
                      >
                        <CompactIcon kind="refresh" />
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        ),
      )}
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
  );
}
