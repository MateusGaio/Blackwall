// MIT License — Copyright (c) 2026 Mateus Gaio

import {
  type AppState,
  type ChatMessage,
  editSessionMessage,
  getAppState,
  persistMessage,
  regenerateSession,
  searchAttachments,
  streamMessage,
  type WorkspaceToolApproval,
  type WorkspaceToolDecision,
} from "../../../shared/api/sidecar";

type SidecarChatMessage = ChatMessage;

type SidecarChatLabels = {
  consulting: string;
  continuing: string;
  couldNotEdit: (fallback: string) => string;
  couldNotRegenerate: (fallback: string) => string;
  couldNotSend: (fallback: string) => string;
  generating: string;
  runningTool: (tool: string) => string;
  summarizingContext: string;
  waitingForPermission: string;
};

type SidecarChatRunConfig = {
  model: string;
  profileId?: string | null;
  providerId?: string | null;
  workspaceId?: string | null;
};

type SidecarChatSnapshot = {
  error: string;
  isRunning: boolean;
  messages: readonly SidecarChatMessage[];
  queuedCount: number;
  queuedPreview: string | null;
  status: string;
  streamingId: string | null;
  toolApproval: WorkspaceToolApproval | null;
};

type StoreOverrides = {
  editSessionMessage?: typeof editSessionMessage;
  generateId?: () => string;
  getAppState?: () => Promise<AppState>;
  persistMessage?: typeof persistMessage;
  regenerateSession?: typeof regenerateSession;
  searchAttachments?: typeof searchAttachments;
  streamMessage?: typeof streamMessage;
};

type StoreCallbacks = {
  onAppStateRefreshed?: (state: AppState) => void;
  onProviderUsage?: (
    providerId: string,
    filters: { modelId?: string; profileId?: string | null; sessionId: string },
  ) => void;
  /** Ferramenta que altera arquivos concluiu (ex.: gatilho de refresh do Vault). */
  onVaultFileChanged?: () => void;
};

const FALLBACK_LABELS: SidecarChatLabels = {
  consulting: "Consultando…",
  continuing: "Continuando…",
  couldNotEdit: (fallback) => fallback,
  couldNotRegenerate: (fallback) => fallback,
  couldNotSend: (fallback) => fallback,
  generating: "Gerando…",
  runningTool: (tool) => `${tool}…`,
  summarizingContext: "Resumindo contexto…",
  waitingForPermission: "Aguardando autorização…",
};

/**
 * Ponte entre o protocolo WebSocket do sidecar e um runtime de chat externo
 * (assistant-ui ExternalStoreRuntime). Mantém a visão canônica da conversa
 * (mensagens, streaming, fila FIFO ADR-21, aprovações de ferramentas) sem
 * depender de React.
 *
 * O guard de sessão é obrigatório: deltas, aprovações e conclusões de uma
 * requisição antiga jamais vazam para a sessão em que o usuário já está.
 */
export class SidecarChatStore {
  private readonly api: {
    editSessionMessage: typeof editSessionMessage;
    generateId: () => string;
    getAppState: () => Promise<AppState>;
    persistMessage: typeof persistMessage;
    regenerateSession: typeof regenerateSession;
    searchAttachments: typeof searchAttachments;
    streamMessage: typeof streamMessage;
  };
  private readonly callbacks: StoreCallbacks;

  private activeSessionId: string | null = null;
  private approvalResolver: ((decision: WorkspaceToolDecision) => void) | null = null;
  private dirty = false;
  private error = "";
  private isRunning = false;
  private labels: SidecarChatLabels = FALLBACK_LABELS;
  private listeners = new Set<() => void>();
  private messages: SidecarChatMessage[] = [];
  private queue: string[] = [];
  private runConfig: SidecarChatRunConfig = { model: "" };
  private runLocked = false;
  private runningTool: string | null = null;
  private sessionEpoch = 0;
  private snapshot: SidecarChatSnapshot = {
    error: "",
    isRunning: false,
    messages: [],
    queuedCount: 0,
    queuedPreview: null,
    status: "",
    streamingId: null,
    toolApproval: null,
  };
  private status = "";
  private streamingBuffer = "";
  private streamingId: string | null = null;
  private streamHandle: { stop: () => void } | null = null;
  private toolApproval: WorkspaceToolApproval | null = null;

  constructor(overrides: StoreOverrides = {}, callbacks: StoreCallbacks = {}) {
    this.api = {
      editSessionMessage: overrides.editSessionMessage ?? editSessionMessage,
      generateId: overrides.generateId ?? (() => crypto.randomUUID()),
      getAppState: overrides.getAppState ?? getAppState,
      persistMessage: overrides.persistMessage ?? persistMessage,
      regenerateSession: overrides.regenerateSession ?? regenerateSession,
      searchAttachments: overrides.searchAttachments ?? searchAttachments,
      streamMessage: overrides.streamMessage ?? streamMessage,
    };
    this.callbacks = callbacks;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SidecarChatSnapshot => {
    if (this.dirty) {
      this.dirty = false;
      this.snapshot = {
        error: this.error,
        isRunning: this.isRunning,
        messages: [...this.messages],
        queuedCount: this.queue.length,
        queuedPreview: this.queue[0] ?? null,
        status: this.status,
        streamingId: this.streamingId,
        toolApproval: this.toolApproval,
      };
    }
    return this.snapshot;
  };

  configure = (runConfig: SidecarChatRunConfig, labels?: Partial<SidecarChatLabels>): void => {
    this.runConfig = runConfig;
    if (labels) this.labels = { ...FALLBACK_LABELS, ...labels };
  };

  /**
   * Sincroniza a thread com a verdade do servidor ao trocar de sessão ou ao
   * receber estado atualizado. Durante uma execução ativa na mesma sessão a
   * visão local prevalece (o placeholder de streaming não pode ser apagado por
   * um refresh que ainda não vê a resposta); a reconciliação acontece no fim
   * da execução.
   */
  setActiveSession = (sessionId: string | null, stored: readonly SidecarChatMessage[]): void => {
    const switching = sessionId !== this.activeSessionId;
    if (!switching && this.isRunning) return;
    if (!switching && sameMessages(this.messages, stored)) return;
    this.activeSessionId = sessionId;
    this.messages = [...stored];
    if (switching) {
      this.sessionEpoch += 1;
      this.queue = [];
      this.error = "";
      const pendingResolver = this.approvalResolver;
      this.approvalResolver = null;
      this.toolApproval = null;
      // Aprovação pendente da sessão anterior é negada para o socket não
      // ficar aguardando decisão que nunca chegará.
      pendingResolver?.("deny");
      this.streamingId = null;
      this.status = "";
    }
    this.notify();
  };

  clearError = (): void => {
    if (!this.error) return;
    this.error = "";
    this.notify();
  };

  /**
   * Tira o próximo da fila (ADR-21) para edição no composer, sem disparar —
   * equivalente ao "pending input preview" do bottom pane do Codex TUI.
   */
  pullQueuedDraft = (): string | null => {
    if (this.queue.length === 0) return null;
    const [next, ...rest] = this.queue;
    this.queue = rest;
    this.notify();
    return next;
  };

  send = (content: string): void => {
    const sessionId = this.activeSessionId;
    const trimmed = content.trim();
    if (!sessionId || !trimmed || !this.runConfig.providerId) return;
    if (this.runLocked || this.isRunning) {
      this.queue = [...this.queue, trimmed];
      this.notify();
      return;
    }
    this.runLocked = true;
    void this.dispatchUserMessage(trimmed, sessionId);
  };

  cancel = (): void => {
    this.streamHandle?.stop();
  };

  reload = async (): Promise<void> => {
    const sessionId = this.activeSessionId;
    if (!sessionId || !this.runConfig.providerId) return;
    if (this.runLocked || this.isRunning) return;
    const runEpoch = this.sessionEpoch;
    this.runLocked = true;
    try {
      const next = await this.api.regenerateSession(sessionId);
      if (!this.matchesRun(sessionId, runEpoch)) return;
      this.messages = [...next];
      this.notify();
      await this.generate([...next], sessionId, runEpoch);
    } catch (reason) {
      if (this.matchesRun(sessionId, runEpoch))
        this.setError(
          this.labels.couldNotRegenerate(
            reason instanceof Error ? reason.message : "Não foi possível regenerar a resposta.",
          ),
          reason,
        );
    } finally {
      this.releaseRun(sessionId);
    }
  };

  editMessage = async (messageId: string, content: string): Promise<void> => {
    const sessionId = this.activeSessionId;
    if (!sessionId || !this.runConfig.providerId) return;
    if (this.runLocked || this.isRunning) return;
    const runEpoch = this.sessionEpoch;
    this.runLocked = true;
    try {
      const next = await this.api.editSessionMessage(sessionId, messageId, content);
      if (!this.matchesRun(sessionId, runEpoch)) return;
      this.messages = [...next];
      this.notify();
      const refreshed = await this.refreshAppState(sessionId, runEpoch);
      const prompt = refreshed && this.matchesRun(sessionId, runEpoch) ? refreshed.messages : next;
      await this.generate([...prompt], sessionId, runEpoch);
    } catch (reason) {
      if (this.matchesRun(sessionId, runEpoch))
        this.setError(
          this.labels.couldNotEdit(
            reason instanceof Error ? reason.message : "Não foi possível editar a mensagem.",
          ),
          reason,
        );
    } finally {
      this.releaseRun(sessionId);
    }
  };

  resolveToolDecision = (decision: WorkspaceToolDecision): void => {
    const resolve = this.approvalResolver;
    this.approvalResolver = null;
    this.toolApproval = null;
    resolve?.(decision);
    this.notify();
  };

  private isCurrent(sessionId: string): boolean {
    return this.activeSessionId === sessionId;
  }

  /** Guard completo: sessão ativa E mesma "era" (protege trocas A→B→A). */
  private matchesRun(sessionId: string, epoch: number): boolean {
    return this.activeSessionId === sessionId && this.sessionEpoch === epoch;
  }

  private releaseRun(sessionId: string): void {
    this.runLocked = false;
    this.drainQueue(sessionId);
  }

  private setError(message: string, reason?: unknown): void {
    if (reason) console.error(reason);
    this.error = message;
    this.notify();
  }

  private notify(): void {
    this.dirty = true;
    for (const listener of this.listeners) listener();
  }

  private async refreshAppState(sessionId: string, epoch: number): Promise<AppState | null> {
    const refreshed = await this.api.getAppState().catch(() => null);
    if (!refreshed) return null;
    this.callbacks.onAppStateRefreshed?.(refreshed);
    if (this.matchesRun(sessionId, epoch) && !this.isRunning) {
      this.setActiveSession(sessionId, refreshed.messages);
    }
    return refreshed;
  }

  private async dispatchUserMessage(content: string, sessionId: string): Promise<void> {
    const runEpoch = this.sessionEpoch;
    try {
      const userMessage: ChatMessage = { content, id: this.api.generateId(), role: "user" };
      this.messages = [...this.messages, userMessage];
      this.error = "";
      this.notify();
      await this.api.persistMessage(sessionId, { content, role: "user", status: "complete" });
      await this.refreshAppState(sessionId, runEpoch);
      let contextMessage: ChatMessage | null = null;
      const workspaceId = this.runConfig.workspaceId;
      if (workspaceId) {
        const attachments = await this.api
          .searchAttachments(workspaceId, content.slice(0, 160))
          .catch(() => []);
        contextMessage =
          attachments.length > 0
            ? {
                content: `Trechos relevantes dos anexos locais:\n${attachments
                  .map((item) => `[${item.filename}]\n${item.content}`)
                  .join("\n\n")}`,
                id: this.api.generateId(),
                role: "system",
              }
            : null;
      }
      const prompt = contextMessage ? [...this.messages, contextMessage] : [...this.messages];
      await this.generate(prompt, sessionId, runEpoch);
    } catch (reason) {
      if (this.matchesRun(sessionId, runEpoch))
        this.setError(
          this.labels.couldNotSend(
            reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.",
          ),
          reason,
        );
    } finally {
      this.releaseRun(sessionId);
    }
  }

  /**
   * Executa uma geração assumindo o lock já adquirido pelo fluxo chamador
   * (send/reload/edit). O estado isRunning aqui é apenas o sinal visível de
   * streaming para a UI.
   */
  private async generate(
    promptMessages: ChatMessage[],
    sessionId: string,
    runEpoch: number,
  ): Promise<void> {
    const providerId = this.runConfig.providerId;
    if (!providerId || !this.matchesRun(sessionId, runEpoch)) return;
    const requestModel = this.runConfig.model;
    const requestProfileId = this.runConfig.profileId ?? undefined;
    const requestWorkspaceId = this.runConfig.workspaceId ?? "default";
    const labels = this.labels;
    const placeholderId = `streaming-${this.api.generateId()}`;
    this.error = "";
    this.isRunning = true;
    this.streamingBuffer = "";
    this.streamingId = placeholderId;
    this.status = labels.consulting;
    this.messages = [...this.messages, { content: "", id: placeholderId, role: "assistant" }];
    this.notify();

    const setStatus = (status: string) => {
      this.status = status;
      this.notify();
    };

    try {
      const stream = await this.api.streamMessage(
        providerId,
        promptMessages,
        requestModel || undefined,
        requestWorkspaceId,
        {
          onApproval: (approval, resolveDecision) => {
            if (!this.matchesRun(sessionId, runEpoch)) {
              resolveDecision("deny");
              return;
            }
            this.approvalResolver = resolveDecision;
            this.toolApproval = approval;
            setStatus(labels.waitingForPermission);
          },
          onApprovalResolved: () => {
            // Resolução sem o botão (transição de modo/stop no sidecar):
            // remove o card imediatamente — zero órfãos.
            if (!this.matchesRun(sessionId, runEpoch)) return;
            this.approvalResolver = null;
            this.toolApproval = null;
            this.notify();
          },
          onCompacting: () => {
            if (!this.matchesRun(sessionId, runEpoch)) return;
            setStatus(labels.summarizingContext);
          },
          onDelta: (delta) => {
            // Sem este guard, deltas tardios da sessão anterior contaminam o
            // buffer/status da sessão recém-ativada durante o streaming.
            if (!this.matchesRun(sessionId, runEpoch)) return;
            this.streamingBuffer += delta;
            this.messages = this.messages.map((message) =>
              message.id === placeholderId
                ? { ...message, content: this.streamingBuffer }
                : message,
            );
            setStatus(labels.generating);
          },
          onRetry: (message) => {
            if (!this.matchesRun(sessionId, runEpoch)) return;
            setStatus(message);
          },
          onToolCompleted: () => {
            if (!this.matchesRun(sessionId, runEpoch)) return;
            if (this.runningTool === "create_or_update_file") this.callbacks.onVaultFileChanged?.();
            this.runningTool = null;
            setStatus(labels.continuing);
          },
          onToolFailed: (message) => {
            if (!this.matchesRun(sessionId, runEpoch)) return;
            this.runningTool = null;
            setStatus(message);
          },
          onToolStarted: (tool) => {
            if (!this.matchesRun(sessionId, runEpoch)) return;
            this.runningTool = tool;
            setStatus(labels.runningTool(tool));
          },
          onUsage: () => {
            if (!this.matchesRun(sessionId, runEpoch)) return;
            this.callbacks.onProviderUsage?.(providerId, {
              modelId: requestModel || undefined,
              profileId: requestProfileId ?? null,
              sessionId,
            });
          },
        },
        requestProfileId,
        sessionId,
      );
      this.streamHandle = stream;
      const result = await stream.done;
      const finalContent = result.content.trim();
      if (finalContent && !result.persisted) {
        await this.api.persistMessage(sessionId, {
          content: finalContent,
          model: requestModel,
          providerId,
          role: "assistant",
          status: result.stopped ? "stopped" : "complete",
        });
      }
      this.finishStreamingPlaceholder(finalContent);
      this.isRunning = false;
      this.streamHandle = null;
      await this.refreshAppState(sessionId, runEpoch);
      if (this.matchesRun(sessionId, runEpoch) && result.failed && result.error)
        this.setError(result.error);
    } catch (reason) {
      const partial = this.streamingBuffer.trim();
      if (partial) {
        await this.api
          .persistMessage(sessionId, {
            content: partial,
            model: requestModel,
            providerId,
            role: "assistant",
            status: "failed",
          })
          .catch(() => undefined);
      }
      this.finishStreamingPlaceholder(partial);
      this.isRunning = false;
      this.streamHandle = null;
      if (this.matchesRun(sessionId, runEpoch)) {
        this.setError(
          reason instanceof Error ? reason.message : "A conexão local foi interrompida.",
          reason,
        );
      } else {
        console.error(reason);
      }
    } finally {
      this.streamingBuffer = "";
      this.status = "";
      this.isRunning = false;
      this.streamingId = null;
      this.notify();
    }
  }

  /** Substitui o placeholder de streaming pela mensagem final visível. */
  private finishStreamingPlaceholder(content: string): void {
    const placeholderId = this.streamingId;
    if (!placeholderId) return;
    this.messages = this.messages.flatMap((message) => {
      if (message.id !== placeholderId) return [message];
      const finalContent = content.trim() ? content : message.content.trim();
      // Id preservado: a troca streaming→final não pode remontar o item.
      return finalContent ? [{ ...message, content: finalContent }] : [];
    });
    this.streamingId = null;
    this.notify();
  }

  /** Fila FIFO por workspace/sessão (ADR-21): dispara o próximo da fila. */
  private drainQueue(sessionId: string): void {
    if (this.queue.length === 0) return;
    if (!this.runConfig.providerId) {
      this.queue = [];
      this.notify();
      return;
    }
    const [next, ...rest] = this.queue;
    this.queue = rest;
    if (!this.isCurrent(sessionId)) {
      // Troca de sessão descarta pendências nunca persistidas.
      this.queue = [];
      this.notify();
      return;
    }
    this.notify();
    this.runLocked = true;
    void this.dispatchUserMessage(next, sessionId);
  }
}

function sameMessages(left: readonly SidecarChatMessage[], right: readonly SidecarChatMessage[]) {
  return left === right || (left.length === right.length && left.every((m, i) => m === right[i]));
}
