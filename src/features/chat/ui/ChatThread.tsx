// MIT License — Copyright (c) 2026 Mateus Gaio

import { ThreadPrimitive } from "@assistant-ui/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../../shared/api/sidecar";
import { EnterExit } from "../../../shared/components/motion/EnterExit";
import { SafeMarkdown } from "../../../shared/components/SafeMarkdown";
import { Button } from "../../../shared/components/ui/button";
import { Textarea } from "../../../shared/components/ui/textarea";
import { cn } from "../../../shared/lib/utils";
import { ConversationSummaryCard } from "./ConversationSummaryCard";
import { ExitingMessage } from "./thread/ExitingMessage";
import { groupThreadItems } from "./thread/groupThreadItems";
import { MessageActions } from "./thread/MessageActions";
import { messageClasses, streamingMinHeight } from "./thread/messageClasses";
import { RoleMarker } from "./thread/RoleMarker";
import { ToolStepsCard } from "./thread/ToolStepsCard";

type ChatThreadProps = {
  copiedMessageId: string | null;
  copyMessage: (message: ChatMessage) => void;
  editingMessageDraft: string;
  editingMessageId: string | null;
  listRef: RefObject<HTMLDivElement | null>;
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

function EditMessageForm({
  draft,
  onCancel,
  onChange,
  onSubmit,
}: {
  draft: string;
  onCancel: () => void;
  onChange: (draft: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Textarea
        aria-label={t("chat.editMessage")}
        className="min-h-[100px] resize-y"
        onChange={(event) => onChange(event.target.value)}
        value={draft}
      />
      <div className="flex gap-2">
        <Button onClick={onCancel} size="sm" type="button" variant="secondary">
          {t("chat.cancel")}
        </Button>
        <Button size="sm" type="submit">
          {t("chat.saveAndRegenerate")}
        </Button>
      </div>
    </form>
  );
}

/** Pílula de rolar para o final — aparece ao rolar para cima durante streaming. */
function ScrollBottomPill({
  atBottom,
  listRef,
  streaming,
}: {
  atBottom: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  streaming: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <EnterExit offsetPx={6} show={streaming && !atBottom}>
        <button
          className="pointer-events-auto rounded-full border border-border bg-popover/90 py-1.5 pl-3 pr-3 font-mono text-xs text-muted-foreground shadow-none backdrop-blur transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            const viewport = listRef.current;
            viewport?.scrollTo({ behavior: "smooth", top: viewport.scrollHeight });
          }}
          type="button"
        >
          ↓ {t("chat.scrollToBottom")}
        </button>
      </EnterExit>
    </div>
  );
}

/**
 * Transcript sobre as primitivas do assistant-ui: ThreadPrimitive.Root/Viewport
 * dão auto-scroll/follow-bottom nativos; a lista em si continua alimentada pela
 * visão canônica da store (passos de ferramenta agrupados, resumo, edição).
 */
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
    const viewport = listRef.current;
    if (!viewport) return;
    setAtBottom(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48);
  }

  const lastAssistantId = [...visibleMessages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <ThreadPrimitive.Root className="relative min-h-0">
      <div className="relative h-full min-h-0">
        <ThreadPrimitive.Viewport
          autoScroll
          className="h-full overflow-y-auto overscroll-contain [scrollbar-color:#3d3d43_transparent] [scrollbar-width:thin]"
          onScroll={handleScroll}
          ref={listRef}
        >
          <ol className="flex flex-col gap-6 px-1 pb-7 pt-5">
            {groupThreadItems(visibleMessages).map((item) => {
              if (item.kind === "steps") {
                return (
                  <ToolStepsCard key={`steps-${item.steps[0]?.id ?? "empty"}`} steps={item.steps} />
                );
              }
              if (item.message.isSummary) {
                return (
                  <ConversationSummaryCard content={item.message.content} key={item.message.id} />
                );
              }
              const message = item.message;
              const isStreaming = message.id === streamingId;
              return (
                <EnterExit
                  as="li"
                  className={cn(messageClasses(message.role), isStreaming && streamingMinHeight)}
                  key={message.id}
                  offsetPx={6}
                  show
                >
                  {editingMessageId === message.id ? (
                    <EditMessageForm
                      draft={editingMessageDraft}
                      onCancel={onEditCancel}
                      onChange={onEditChange}
                      onSubmit={() => onEditSubmit(message.id, editingMessageDraft)}
                    />
                  ) : (
                    <>
                      <RoleMarker role={message.role} />
                      {message.content.trim() ? (
                        <SafeMarkdown content={message.content} />
                      ) : (
                        isStreaming && (
                          <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            <span aria-hidden="true">▸</span>
                            {streamingStatus}
                          </p>
                        )
                      )}
                      {isStreaming && (
                        <span
                          aria-hidden="true"
                          className="ml-1 inline-block h-[1em] w-[0.6em] translate-y-[2px] bg-foreground align-middle animate-[motion-caret-blink_900ms_steps(2,jump-none)_infinite]"
                        />
                      )}
                      {!isStreaming && (
                        <MessageActions
                          copiedMessageId={copiedMessageId}
                          copyMessage={copyMessage}
                          isLastAssistant={
                            message.role === "assistant" && message.id === lastAssistantId
                          }
                          message={message}
                          onEditingStart={onEditingStart}
                          regenerate={regenerate}
                        />
                      )}
                    </>
                  )}
                </EnterExit>
              );
            })}
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
        </ThreadPrimitive.Viewport>
        <ScrollBottomPill atBottom={atBottom} listRef={listRef} streaming={streamingId !== null} />
      </div>
    </ThreadPrimitive.Root>
  );
}
