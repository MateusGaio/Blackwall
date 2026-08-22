// MIT License — Copyright (c) 2026 Mateus Gaio

import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../shared/api/sidecar";
import { SafeMarkdown } from "../../shared/components/SafeMarkdown";
import { ConversationSummaryCard } from "../ConversationSummaryCard";
import { CompactIcon } from "./CompactIcon";

type MessageListProps = {
  copiedMessageId: string | null;
  copyMessage: (message: ChatMessage) => void;
  editingMessageDraft: string;
  editingMessageId: string | null;
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
  const { t } = useTranslation();
  return (
    <ol className="message-list" ref={listRef}>
      {visibleMessages.map((message) =>
        message.isSummary ? (
          <ConversationSummaryCard content={message.content} key={message.id} />
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
                <SafeMarkdown content={message.content} />
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
              </>
            )}
          </li>
        ),
      )}
      {isSending && (
        <li className="message message-assistant message-streaming">
          {streamingContent ? <SafeMarkdown content={streamingContent} /> : streamingStatus}
          <span aria-hidden="true" className="streaming-cursor" />
        </li>
      )}
    </ol>
  );
}
