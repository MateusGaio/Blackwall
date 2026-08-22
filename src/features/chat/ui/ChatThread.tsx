// MIT License — Copyright (c) 2026 Mateus Gaio

import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
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

/** Mensagens flat do §3/U4: usuário à direita, agente à esquerda, sem bolha. */
function messageClasses(role: ChatMessage["role"]) {
  return cn(
    "max-w-[min(85%,640px)] leading-relaxed",
    role === "user" && "message-user flex flex-col items-end gap-1 self-end text-right",
    role === "assistant" &&
      "message-assistant flex flex-col items-start gap-1 self-start px-1 text-foreground/90",
    role === "system" &&
      "self-start border-l-2 border-border px-3 font-mono text-xs text-muted-foreground",
  );
}

/** Marcador de papel em mono (U4): › você · ● agente. */
function RoleMarker({ role }: { role: ChatMessage["role"] }) {
  const { t } = useTranslation();
  if (role !== "user" && role !== "assistant") return null;
  return (
    <p
      aria-hidden="true"
      className={`font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase ${
        role === "user" ? "text-right" : ""
      }`}
    >
      {role === "user" ? `› ${t("chat.you")}` : `● ${t("chat.assistantLabel")}`}
    </p>
  );
}

const actionBar =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    <EnterExit as="li" onExited={onExited} show={!leaving}>
      <div className={messageClasses(message.role)}>
        <RoleMarker role={message.role} />
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
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
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = visibleMessages;
    if (previous === visibleMessages || previous.length === 0) return;
    const currentIds = new Set(visibleMessages.map((message) => message.id));
    const currentContent = new Set(
      visibleMessages.map((message) => `${message.role}:${message.content}`),
    );
    // Remoção real apenas: a reconciliação com o servidor troca ids mas
    // preserva papel+conteúdo — isso não é saída de mensagem.
    const removed = previous.filter(
      (message) =>
        !currentIds.has(message.id) && !currentContent.has(`${message.role}:${message.content}`),
    );
    if (removed.length === 0) return;
    const overlap = previous.length - removed.length;
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

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    setAtBottom(list.scrollHeight - list.scrollTop - list.clientHeight < 48);
  }

  function scrollToBottom() {
    listRef.current?.scrollTo({ behavior: "smooth", top: listRef.current.scrollHeight });
  }

  const showPill = streamingId !== null && !atBottom;

  return (
    <div className="relative min-h-0">
      <ol
        className="flex h-full flex-col gap-6 overflow-y-auto overscroll-contain px-1 pb-7 pt-5 [scrollbar-color:#3d3d43_transparent] [scrollbar-width:thin]"
        onScroll={handleScroll}
        ref={listRef}
      >
        {visibleMessages.map((message) =>
          message.isSummary ? (
            <ConversationSummaryCard content={message.content} key={message.id} />
          ) : (
            <EnterExit
              as="li"
              className={cn(
                messageClasses(message.role),
                message.id === streamingId && "min-h-[1.6em]",
              )}
              key={message.id}
              offsetPx={6}
              show
            >
              {editingMessageId === message.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onEditSubmit(message.id, editingMessageDraft);
                  }}
                >
                  <Textarea
                    aria-label={t("chat.editMessage")}
                    className="min-h-[100px] resize-y"
                    onChange={(event) => onEditChange(event.target.value)}
                    value={editingMessageDraft}
                  />
                  <div className="flex gap-2">
                    <Button onClick={onEditCancel} size="sm" type="button" variant="secondary">
                      {t("chat.cancel")}
                    </Button>
                    <Button size="sm" type="submit">
                      {t("chat.saveAndRegenerate")}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <RoleMarker role={message.role} />
                  {message.content.trim() ? (
                    <SafeMarkdown content={message.content} />
                  ) : (
                    message.id === streamingId && (
                      <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        <span aria-hidden="true">▸</span>
                        {streamingStatus}
                      </p>
                    )
                  )}
                  {message.id === streamingId && (
                    <span
                      aria-hidden="true"
                      className="ml-1 inline-block h-[1em] w-[0.6em] translate-y-[2px] bg-foreground align-middle animate-[motion-caret-blink_900ms_steps(2,jump-none)_infinite]"
                    />
                  )}
                  {message.id !== streamingId && (
                    <div className="mt-2 flex gap-1 opacity-70 transition-opacity duration-[120ms] hover:opacity-100">
                      {message.role === "user" && (
                        <button
                          aria-label={t("chat.editMessage")}
                          className={actionBar}
                          onClick={() => onEditingStart(message)}
                          title={t("chat.edit")}
                          type="button"
                        >
                          <CompactIcon kind="edit" />
                        </button>
                      )}
                      {message.role === "assistant" &&
                        message.id === visibleMessages.at(-1)?.id && (
                          <>
                            <button
                              aria-label={t("chat.copyMessage")}
                              className={actionBar}
                              onClick={() => copyMessage(message)}
                              title={
                                copiedMessageId === message.id ? t("chat.copied") : t("chat.copy")
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
                              aria-label={t("chat.regenerateResponse")}
                              className={actionBar}
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
            onExited={() =>
              setGhosts((current) => current.filter((item) => item.key !== ghost.key))
            }
          />
        ))}
      </ol>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <EnterExit offsetPx={6} show={showPill}>
          <button
            className="pointer-events-auto rounded-full border border-border bg-popover/90 py-1.5 pl-3 pr-3 font-mono text-xs text-muted-foreground shadow-none backdrop-blur transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={scrollToBottom}
            type="button"
          >
            ↓ {t("chat.scrollToBottom")}
          </button>
        </EnterExit>
      </div>
    </div>
  );
}
