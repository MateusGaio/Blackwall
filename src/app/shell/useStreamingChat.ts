// MIT License — Copyright (c) 2026 Mateus Gaio
import {
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import {
  type AppState,
  type ChatMessage,
  type ConnectedProvider,
  editSessionMessage,
  getAppState,
  getProviderUsage,
  persistMessage,
  regenerateSession,
  searchAttachments,
  streamMessage,
  type UsageSummary,
  type WorkspaceToolApproval,
  type WorkspaceToolDecision,
  type WorkspaceToolName,
} from "../../shared/api/sidecar";

type UseStreamingChatOptions = {
  activeProvider: ConnectedProvider | null;
  activeSessionIdRef: RefObject<string | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  isEnglish: boolean;
  messages: ChatMessage[];
  selectedModel: string;
  setActiveSessionId: (sessionId: string) => void;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setResourceNotice: Dispatch<SetStateAction<string>>;
  setState: Dispatch<SetStateAction<AppState | null>>;
  setUsageSummary: Dispatch<SetStateAction<UsageSummary | null>>;
  setVaultRefreshKey: Dispatch<SetStateAction<number>>;
  state: AppState | null;
  workspaceId: string | undefined;
};

/**
 * Streaming chat engine extracted verbatim from WorkspaceShell. Owns the
 * request lifecycle state (sending, streaming buffers, pending tool approval)
 * while delegating durable data (messages, app state, errors) to the caller.
 * The activeSessionIdRef guard must be kept: it prevents deltas and approvals
 * from a stale request from leaking into a session the user already left.
 */
export function useStreamingChat({
  activeProvider,
  activeSessionIdRef,
  composerRef,
  draft,
  isEnglish,
  messages,
  selectedModel,
  setActiveSessionId,
  setDraft,
  setError,
  setMessages,
  setResourceNotice,
  setState,
  setUsageSummary,
  setVaultRefreshKey,
  state,
  workspaceId,
}: UseStreamingChatOptions) {
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingStatus, setStreamingStatus] = useState("");
  const [toolApproval, setToolApproval] = useState<WorkspaceToolApproval | null>(null);
  const activeStream = useRef<{ stop: () => void } | null>(null);
  const pendingToolDecision = useRef<((decision: WorkspaceToolDecision) => void) | null>(null);
  const streamingContentRef = useRef("");
  const runningToolRef = useRef<WorkspaceToolName | null>(null);

  function resolveToolDecision(decision: WorkspaceToolDecision) {
    const resolveDecision = pendingToolDecision.current;
    pendingToolDecision.current = null;
    setToolApproval(null);
    resolveDecision?.(decision);
  }

  async function generateResponse(promptMessages: ChatMessage[], sessionId: string) {
    if (!activeProvider || isSending) return;
    setError("");
    setIsSending(true);
    setStreamingContent("");
    streamingContentRef.current = "";
    setStreamingStatus("Consultando…");
    const requestProvider = activeProvider;
    const requestModel = selectedModel;
    const requestWorkspaceId = workspaceId ?? "default";
    const requestProfileId = state?.activeProfileId;
    try {
      const stream = await streamMessage(
        requestProvider.id,
        promptMessages,
        requestModel,
        requestWorkspaceId,
        {
          onDelta: (delta) => {
            if (activeSessionIdRef.current !== sessionId) return;
            streamingContentRef.current += delta;
            setStreamingContent(streamingContentRef.current);
            setStreamingStatus("Gerando…");
          },
          onCompacting: () => {
            if (activeSessionIdRef.current === sessionId)
              setStreamingStatus(isEnglish ? "Summarizing context…" : "Resumindo contexto…");
          },
          onUsage: () => {
            void getProviderUsage(requestProvider.id, {
              modelId: requestModel || undefined,
              profileId: requestProfileId,
              sessionId,
            })
              .then(setUsageSummary)
              .catch(() => undefined);
          },
          onRetry: (message) => {
            if (activeSessionIdRef.current === sessionId) setStreamingStatus(message);
          },
          onApproval: (approval, resolveDecision) => {
            if (activeSessionIdRef.current !== sessionId) {
              resolveDecision("deny");
              return;
            }
            pendingToolDecision.current = resolveDecision;
            setToolApproval(approval);
            setStreamingStatus(isEnglish ? "Waiting for permission…" : "Aguardando autorização…");
          },
          onToolStarted: (tool) => {
            runningToolRef.current = tool;
            if (activeSessionIdRef.current === sessionId)
              setStreamingStatus(`${isEnglish ? "Running" : "Executando"} ${tool}…`);
          },
          onToolCompleted: () => {
            if (runningToolRef.current === "create_or_update_file")
              setVaultRefreshKey((key) => key + 1);
            runningToolRef.current = null;
            if (activeSessionIdRef.current === sessionId)
              setStreamingStatus(isEnglish ? "Continuing…" : "Continuando…");
          },
        },
        requestProfileId ?? undefined,
        sessionId,
      );
      activeStream.current = stream;
      const result = await stream.done;
      const assistantContent = result.content.trim();
      if (assistantContent && !result.persisted) {
        await persistMessage(sessionId, {
          content: assistantContent,
          model: result.provider?.model ?? requestModel,
          providerId: result.provider?.id ?? requestProvider.id,
          role: "assistant",
          status: result.stopped ? "stopped" : "complete",
        });
      }
      const refreshed = await getAppState();
      setState(refreshed);
      if (activeSessionIdRef.current === sessionId) setMessages(refreshed.messages);
      if (result.failed && result.error) setError(result.error);
    } catch (reason) {
      const partial = streamingContentRef.current.trim();
      if (partial) {
        await persistMessage(sessionId, {
          content: partial,
          model: requestModel,
          providerId: requestProvider.id,
          role: "assistant",
          status: "failed",
        }).catch(() => undefined);
        const refreshed = await getAppState().catch(() => null);
        if (refreshed) {
          setState(refreshed);
          if (activeSessionIdRef.current === sessionId) setMessages(refreshed.messages);
        }
      }
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally {
      activeStream.current = null;
      setStreamingContent("");
      streamingContentRef.current = "";
      setStreamingStatus("");
      setIsSending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    const sessionId = state?.activeSessionId;
    if (!content || !activeProvider || !sessionId || isSending) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { content, id: crypto.randomUUID(), role: "user" },
    ];
    setMessages(nextMessages);
    setActiveSessionId(sessionId);
    setDraft("");
    composerRef.current?.style.removeProperty("height");
    setResourceNotice("");
    await persistMessage(sessionId, { content, role: "user", status: "complete" });
    // Atualiza a lista de Recentes assim que a conversa recebe atividade,
    // antes mesmo de a resposta do modelo terminar de chegar.
    setState(await getAppState());
    const relevantAttachments = workspaceId
      ? await searchAttachments(workspaceId, content.slice(0, 160)).catch(() => [])
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
    await generateResponse(
      contextMessage ? [...nextMessages, contextMessage] : nextMessages,
      sessionId,
    );
  }

  async function editMessage(messageId: string, content: string) {
    const sessionId = state?.activeSessionId;
    if (!sessionId || isSending) return;
    try {
      const next = await editSessionMessage(sessionId, messageId, content);
      setMessages(next as ChatMessage[]);
      const refreshed = await getAppState();
      setState(refreshed);
      setMessages(refreshed.messages);
      await generateResponse(refreshed.messages as ChatMessage[], sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível editar a mensagem.");
    }
  }

  async function regenerate() {
    const sessionId = state?.activeSessionId;
    if (!sessionId || isSending) return;
    try {
      const next = await regenerateSession(sessionId);
      setMessages(next as ChatMessage[]);
      await generateResponse(next as ChatMessage[], sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível regenerar a resposta.");
    }
  }

  function stopGeneration() {
    activeStream.current?.stop();
  }

  return {
    editMessage,
    isSending,
    regenerate,
    resolveToolDecision,
    stopGeneration,
    streamingContent,
    streamingStatus,
    submit,
    toolApproval,
  };
}
