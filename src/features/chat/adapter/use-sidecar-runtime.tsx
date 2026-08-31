// MIT License — Copyright (c) 2026 Mateus Gaio

import {
  type AppendMessage,
  type AssistantRuntime,
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, ChatMessage, StoredMessage } from "../../../shared/api/sidecar";
import { SidecarChatStore } from "./sidecar-chat-store";

type UseSidecarChatOptions = {
  model: string;
  onAppStateRefreshed?: (state: AppState) => void;
  onProviderUsage?: (
    providerId: string,
    filters: { modelId?: string; profileId?: string | null; sessionId: string },
  ) => void;
  /** Ferramenta que altera arquivos concluiu (ex.: gatilho de refresh do Vault). */
  onVaultFileChanged?: () => void;
  onVaultNoteCreated?: (note: { path: string; revisionId: string; title: string }) => void;
  profileId?: string | null;
  providerId?: string | null;
  sessionId: string | null;
  storedMessages: readonly StoredMessage[];
  workspaceId?: string | null;
};

function extractText(message: AppendMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * Conecta o SidecarChatStore ao assistant-ui (ExternalStoreRuntime) e expõe o
 * estado derivado que a tela de chat consome (erro, status de streaming, fila,
 * aprovação de ferramentas). O runtime fica disponível para primitivas
 * Thread/Composer dentro do AssistantRuntimeProvider.
 */
export function useSidecarChat(options: UseSidecarChatOptions) {
  const { t } = useTranslation();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const store = useMemo(
    () =>
      new SidecarChatStore(
        {},
        {
          onAppStateRefreshed: (state) => optionsRef.current.onAppStateRefreshed?.(state),
          onProviderUsage: (providerId, filters) =>
            optionsRef.current.onProviderUsage?.(providerId, filters),
          onVaultFileChanged: () => optionsRef.current.onVaultFileChanged?.(),
          onVaultNoteCreated: (note) => optionsRef.current.onVaultNoteCreated?.(note),
        },
      ),
    [],
  );

  const labels = useMemo(
    () => ({
      consulting: t("chat.consulting"),
      consultingVault: t("chat.consultingVault"),
      continuing: t("errors.continuing"),
      couldNotEdit: (fallback: string) => fallback || t("chat.couldNotEditTheMessage"),
      couldNotRegenerate: (fallback: string) => fallback || t("chat.couldNotRegenerateTheResponse"),
      couldNotSend: (fallback: string) => fallback || t("chat.couldNotSendTheMessage"),
      generating: t("chat.generating"),
      runningTool: (tool: string) => `${t("errors.running")} ${tool}…`,
      summarizingContext: t("errors.summarizingContext"),
      waitingForPermission: t("errors.waitingForPermission"),
    }),
    [t],
  );

  useEffect(() => {
    store.configure(
      {
        model: options.model,
        profileId: options.profileId ?? null,
        providerId: options.providerId ?? null,
        workspaceId: options.workspaceId ?? null,
      },
      labels,
    );
  }, [store, labels, options.model, options.profileId, options.providerId, options.workspaceId]);

  useEffect(() => {
    store.setActiveSession(options.sessionId, options.storedMessages);
  }, [store, options.sessionId, options.storedMessages]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // A thread do runtime espelha a visão renderizável (sem mensagens de
  // ferramenta nem placeholders vazios de tool-call).
  const threadMessages = useMemo(
    () =>
      snapshot.messages.filter(
        (message) =>
          message.role !== "tool" &&
          !(message.role === "assistant" && !message.content.trim() && message.toolCalls?.length),
      ),
    [snapshot.messages],
  );

  const convertMessage = useCallback((message: ChatMessage): ThreadMessageLike => {
    return {
      content: [{ text: message.content, type: "text" }],
      id: message.id,
      role:
        message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "system",
    };
  }, []);

  const runtime: AssistantRuntime = useExternalStoreRuntime({
    convertMessage,
    isDisabled: !options.providerId || !options.sessionId,
    messages: threadMessages,
    onCancel: async () => store.cancel(),
    onEdit: async (message) => {
      const targetId = message.sourceId ?? message.parentId;
      if (!targetId) return;
      await store.editMessage(targetId, extractText(message));
    },
    onNew: async (message) => {
      store.send(extractText(message));
    },
    onReload: async () => {
      await store.reload();
    },
  });

  return {
    cancel: store.cancel,
    clearError: store.clearError,
    editMessage: (messageId: string, content: string) => store.editMessage(messageId, content),
    error: snapshot.error,
    isRunning: snapshot.isRunning,
    messages: snapshot.messages,
    pullQueuedDraft: store.pullQueuedDraft,
    queuedCount: snapshot.queuedCount,
    queuedPreview: snapshot.queuedPreview,
    runningTool: snapshot.runningTool,
    regenerate: () => store.reload(),
    resolveToolDecision: store.resolveToolDecision,
    runtime,
    sendMessage: (content: string) => store.send(content),
    streamingId: snapshot.streamingId,
    streamingStatus: snapshot.status,
    toolApproval: snapshot.toolApproval,
  };
}

export function ChatRuntimeProvider({
  runtime,
  children,
}: {
  children: ReactNode;
  runtime: AssistantRuntime;
}) {
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
