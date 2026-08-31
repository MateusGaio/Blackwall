// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import type { AppState, StreamHandlers, StreamResult } from "../../../shared/api/sidecar";
import { SidecarChatStore } from "./sidecar-chat-store";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await tick();
  if (!check()) throw new Error("Condição não satisfeita dentro do prazo.");
}

type FakeStream = {
  complete: (result: Partial<StreamResult>) => void;
  delta: (text: string) => void;
  done: Promise<StreamResult>;
  fail: (reason: Error) => void;
  handlers: StreamHandlers;
  sessionId: string;
  stop: () => void;
  stopped: boolean;
};

type HarnessOverrides = {
  editedMessages?: unknown[];
  regenerateMessages?: unknown[];
  workspaceId?: string | null;
};

function createHarness(overrides: HarnessOverrides = {}) {
  const streams: FakeStream[] = [];
  const persisted: Array<{ message: Record<string, unknown>; sessionId: string }> = [];
  const streamInputs: unknown[][] = [];
  const stateRefreshes: number[] = [];
  let serverMessages: Record<string, unknown>[] = [];

  const appState: AppState = {
    activeProfileId: "p",
    activeSessionId: "s1",
    activeWorkspaceId: overrides.workspaceId ?? null,
    get messages() {
      return serverMessages as AppState["messages"];
    },
    profiles: [],
    recentSessions: [],
    sessions: [],
    workspaces: [],
  };

  const store = new SidecarChatStore(
    {
      editSessionMessage: async () => {
        serverMessages = (overrides.editedMessages ?? []) as never;
        return serverMessages as never;
      },
      generateId: (() => {
        let counter = 0;
        return () => {
          counter += 1;
          return `id-${counter}`;
        };
      })(),
      getAppState: async () => appState,
      persistMessage: async (sessionId: string, message) => {
        persisted.push({ message: { ...message }, sessionId });
        const stored = {
          ...message,
          createdAt: 0,
          id: `stored-${persisted.length}`,
          isSummary: false,
          sequence: persisted.length,
        };
        serverMessages = [...serverMessages, stored];
        return stored as never;
      },
      regenerateSession: async () => {
        serverMessages = (overrides.regenerateMessages ?? []) as never;
        return serverMessages as never;
      },
      streamMessage: async (
        _providerId: string,
        messages: unknown[],
        _model: string | undefined,
        _workspaceId: string,
        handlers: StreamHandlers,
        _profileId?: string,
        sessionId?: string,
      ) => {
        streamInputs.push(messages);
        let resolveDone: (result: StreamResult) => void = () => undefined;
        let rejectDone: (reason: Error) => void = () => undefined;
        const done = new Promise<StreamResult>((resolve, reject) => {
          resolveDone = resolve;
          rejectDone = reject;
        });
        let buffer = "";
        const stream: FakeStream = {
          complete: (result) =>
            resolveDone({
              content: result.content ?? "",
              error: result.error,
              failed: result.failed,
              persisted: result.persisted,
              provider: null,
              stopped: result.stopped,
            }),
          delta: (text) => {
            buffer += text;
            handlers.onDelta?.(text);
          },
          done,
          fail: (reason) => rejectDone(reason),
          handlers,
          sessionId: sessionId ?? "",
          stop: () => {
            stream.stopped = true;
            resolveDone({ content: buffer, persisted: false, provider: null, stopped: true });
          },
          stopped: false,
        };
        streams.push(stream);
        return { done, stop: stream.stop };
      },
    },
    { onAppStateRefreshed: () => stateRefreshes.push(stateRefreshes.length + 1) },
  );

  store.configure({
    model: "mock-model",
    profileId: null,
    providerId: "provider-1",
    workspaceId: null,
  });

  return {
    persisted,
    serverMessages: () => serverMessages,
    stateRefreshes,
    store,
    streamInputs,
    streams,
  };
}

describe("SidecarChatStore", () => {
  it("fluxo feliz: mensagem do usuário otimista, streaming e conclusão persistida", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("Olá");

    await until(() => harness.streams.length === 1);
    expect(harness.store.getSnapshot().isRunning).toBe(true);
    expect(harness.store.getSnapshot().messages.at(-2)?.role).toBe("user");
    expect(harness.persisted[0]).toMatchObject({
      message: { content: "Olá", role: "user" },
      sessionId: "s1",
    });

    harness.streams[0].delta("Res");
    harness.streams[0].delta("posta");
    expect(harness.store.getSnapshot().messages.at(-1)?.content).toBe("Resposta");
    expect(harness.store.getSnapshot().streamingId).toBe(
      harness.store.getSnapshot().messages.at(-1)?.id,
    );

    harness.streams[0].complete({ content: "Resposta.", persisted: false });
    await until(() => !harness.store.getSnapshot().isRunning);
    expect(harness.persisted[1]).toMatchObject({
      message: { content: "Resposta.", role: "assistant", status: "complete" },
    });
    expect(harness.store.getSnapshot().streamingId).toBeNull();
    expect(harness.stateRefreshes.length).toBeGreaterThan(0);
  });

  it("guard anti-vazamento: deltas de sessão antiga não entram na sessão nova", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("Pergunta antiga");

    await until(() => harness.streams.length === 1);
    harness.streams[0].delta("parcial ");
    harness.store.setActiveSession("s2", [
      { content: "outra conversa", id: "other-1", role: "user" },
    ]);
    expect(harness.store.getSnapshot().messages).toHaveLength(1);
    expect(harness.store.getSnapshot().messages[0]?.id).toBe("other-1");

    harness.streams[0].delta("que não deve vazar");
    expect(harness.store.getSnapshot().messages).toHaveLength(1);

    harness.streams[0].complete({ content: "parcial resposta", persisted: false });
    await until(() => harness.persisted.some((item) => item.sessionId === "s1"));
    expect(harness.persisted.at(-1)).toMatchObject({ sessionId: "s1" });
    expect(harness.store.getSnapshot().messages[0]?.id).toBe("other-1");
  });

  it("eventos tardios de run antigo não alteram status da sessão ativa", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("pergunta antiga");
    await until(() => harness.streams.length === 1);

    harness.streams[0].delta("parcial ");
    harness.store.setActiveSession("s2", [
      { content: "outra conversa", id: "other-1", role: "user" },
    ]);
    expect(harness.store.getSnapshot().status).toBe("");

    // Sem os guards matchesRun, esses eventos colocariam a sessão nova em
    // "Gerando…"/"Executando…" fantasma.
    harness.streams[0].handlers.onToolStarted?.("read_file", {}, "call-1");
    harness.streams[0].handlers.onCompacting?.();
    harness.streams[0].handlers.onRetry?.("Tentando novamente…");
    expect(harness.store.getSnapshot().status).toBe("");

    // Conclui o run antigo (a fila FIFO só libera o envio seguinte depois).
    harness.streams[0].complete({ content: "parcial resposta", persisted: false });
    await until(() => !harness.store.getSnapshot().isRunning);
    await until(() => harness.persisted.some((item) => item.sessionId === "s1"));

    // Run novo na sessão atual continua plenamente funcional.
    harness.store.send("nova pergunta");
    await until(() => harness.streams.length === 2);
    harness.streams[1].delta("novo ");
    expect(harness.store.getSnapshot().messages.at(-1)?.content).toBe("novo ");
  });

  it("tool.failed limpa o status de execução e mostra a falha", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("use ferramenta");
    await until(() => harness.streams.length === 1);

    harness.streams[0].handlers.onToolStarted?.("list_directory", {}, "call-1");
    expect(harness.store.getSnapshot().status).toContain("list_directory");

    // Antes deste handler o status ficava preso em "executando…" para sempre.
    harness.streams[0].handlers.onToolFailed?.("A ferramenta falhou: permissão negada.", "call-1");
    expect(harness.store.getSnapshot().status).toBe("A ferramenta falhou: permissão negada.");
  });

  it("não injeta busca automática de anexos e mostra o estado da busca explícita", async () => {
    const harness = createHarness({ workspaceId: "workspace-1" });
    harness.store.setActiveSession("s1", []);
    harness.store.send("fato do Vault");
    await until(() => harness.streams.length === 1);

    expect(harness.streamInputs[0]).toEqual([
      expect.objectContaining({ content: "fato do Vault", role: "user" }),
    ]);
    harness.streams[0].handlers.onToolStarted?.("search_workspace", { query: "fato" }, "call-1");
    expect(harness.store.getSnapshot()).toMatchObject({
      runningTool: "search_workspace",
      status: "Consultando o Vault…",
    });
    harness.streams[0].handlers.onToolCompleted?.({}, "call-1");
    expect(harness.store.getSnapshot().runningTool).toBeNull();
  });

  it("fila FIFO (ADR-21): envio durante execução enfileira e dispara na sequência", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("primeira");
    await until(() => harness.streams.length === 1);

    harness.store.send("segunda");
    expect(harness.store.getSnapshot().queuedCount).toBe(1);

    harness.streams[0].complete({ content: "r1", persisted: true });
    await until(
      () => harness.persisted.filter((item) => item.message.role === "user").length === 2,
    );
    await until(() => harness.streams.length === 2);
    expect(harness.store.getSnapshot().queuedCount).toBe(0);
    expect(harness.persisted[1]).toMatchObject({ message: { content: "segunda" } });

    harness.streams[1].complete({ content: "r2", persisted: true });
    await until(() => !harness.store.getSnapshot().isRunning);
  });

  it("cancelamento preserva o parcial como mensagem stopped", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("escreva");
    await until(() => harness.streams.length === 1);

    harness.streams[0].delta("texto parcial ");
    harness.store.cancel();
    expect(harness.streams[0].stopped).toBe(true);

    await until(() => !harness.store.getSnapshot().isRunning);
    expect(harness.persisted.at(-1)).toMatchObject({
      message: { content: "texto parcial", role: "assistant", status: "stopped" },
    });
  });

  it("falha de conexão preserva o parcial com status failed e expõe erro acionável", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("pergunta");
    await until(() => harness.streams.length === 1);

    harness.streams[0].delta("resposta incompleta");
    harness.streams[0].fail(new Error("A conexão local foi interrompida."));

    await until(() => Boolean(harness.store.getSnapshot().error));
    expect(harness.store.getSnapshot().error).toContain("conexão");
    expect(harness.persisted.at(-1)).toMatchObject({
      message: { content: "resposta incompleta", role: "assistant", status: "failed" },
    });
  });

  it("erro do roteador (ADR-16) vira banner acionável, nunca exceção", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("pergunta");
    await until(() => harness.streams.length === 1);

    harness.streams[0].complete({
      content: "",
      error: "Não foi possível obter resposta — todos os provedores configurados falharam.",
      failed: true,
    });

    await until(() => Boolean(harness.store.getSnapshot().error));
    expect(harness.store.getSnapshot().error).toContain("todos os provedores");
    expect(harness.store.getSnapshot().isRunning).toBe(false);
  });

  it("aprovação que chega após troca de sessão é negada automaticamente", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("use ferramenta");
    await until(() => harness.streams.length === 1);

    const decisions: string[] = [];
    harness.streams[0].handlers.onApproval?.(
      {
        args: {},
        id: "a1",
        requestId: "r1",
        sessionId: "s1",
        tool: "read_file",
        workspaceId: "w1",
      },
      (decision) => decisions.push(decision),
    );

    harness.store.setActiveSession("s2", []);
    await until(() => decisions.length === 1);
    expect(decisions[0]).toBe("deny");
  });

  it("aprovação resolvida pelo usuário segue para o socket", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("use ferramenta");
    await until(() => harness.streams.length === 1);

    const decisions: string[] = [];
    harness.streams[0].handlers.onApproval?.(
      {
        args: {},
        id: "a2",
        requestId: "r2",
        sessionId: "s1",
        tool: "list_directory",
        workspaceId: "w1",
      },
      (decision) => decisions.push(decision),
    );
    await until(() => harness.store.getSnapshot().toolApproval !== null);

    harness.store.resolveToolDecision("allow_once");
    expect(decisions).toEqual(["allow_once"]);
    expect(harness.store.getSnapshot().toolApproval).toBeNull();
  });

  it("reload regenera via sidecar e dispara nova geração", async () => {
    const harness = createHarness({
      regenerateMessages: [{ content: "histórico regenerado", id: "m1", role: "user" }],
    });
    harness.store.setActiveSession("s1", []);
    harness.store.send("inicial");
    await until(() => harness.streams.length === 1);
    harness.streams[0].complete({ content: "primeira", persisted: true });
    await until(() => !harness.store.getSnapshot().isRunning);

    void harness.store.reload();
    await until(() => harness.streams.length === 2);
    expect(harness.store.getSnapshot().messages.map((message) => message.id)).toContain("m1");
    harness.streams[1].complete({ content: "regenerada", persisted: true });
    await until(() => !harness.store.getSnapshot().isRunning);
  });

  it("editMessage reescreve a mensagem e regenera a partir do estado do servidor", async () => {
    const harness = createHarness({
      editedMessages: [{ content: "editada", id: "e1", role: "user" }],
    });
    harness.store.setActiveSession("s1", [{ content: "original", id: "old-user", role: "user" }]);
    void harness.store.editMessage("old-user", "editada");
    await until(() => harness.streams.length === 1);
    harness.streams[0].complete({ content: "nova resposta", persisted: true });
    await until(() => !harness.store.getSnapshot().isRunning);
  });

  it("sync da mesma sessão durante execução não apaga o placeholder de streaming", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("mensagem");
    await until(() => harness.streams.length === 1);
    harness.streams[0].delta("streaming…");

    harness.store.setActiveSession("s1", [{ content: "mensagem", id: "u1", role: "user" }]);
    expect(harness.store.getSnapshot().messages.at(-1)?.content).toBe("streaming…");

    harness.streams[0].complete({ content: "streaming… final", persisted: true });
    await until(() => !harness.store.getSnapshot().isRunning);
  });

  it("pullQueuedDraft devolve o primeiro da fila para edição sem disparar execução", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("primeira");
    await until(() => harness.streams.length === 1);
    harness.store.send("segunda");
    harness.store.send("terceira");

    expect(harness.store.getSnapshot().queuedCount).toBe(2);
    expect(harness.store.getSnapshot().queuedPreview).toBe("segunda");

    expect(harness.store.pullQueuedDraft()).toBe("segunda");
    expect(harness.store.pullQueuedDraft()).toBe("terceira");
    expect(harness.store.pullQueuedDraft()).toBeNull();
    expect(harness.store.getSnapshot().queuedCount).toBe(0);
    expect(harness.store.getSnapshot().queuedPreview).toBeNull();

    // Nada novo disparou: a fila foi consumida para edição, não execução.
    await tick();
    expect(harness.streams.length).toBe(1);
  });
});

describe("isolamento de tentativas de fallback (#210)", () => {
  it("delta do substituto não concatena com o parcial do candidato anterior", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("Explore");

    await until(() => harness.streams.length === 1);
    const stream = harness.streams[0];

    // Tentativa 1 emite parcial e falha no provedor…
    stream.delta("parcial do candidato A");
    // …o sidecar anuncia o SUBSTITUTO (novo candidato começou)…
    stream.handlers.onAttemptStarted?.();
    // …e a tentativa 2 entrega o texto final dela.
    stream.complete({ content: "resposta do candidato B", persisted: false });

    await until(() => !harness.store.getSnapshot().isRunning);
    const assistant = harness.persisted.find((entry) => entry.message.role === "assistant");
    expect(assistant?.message.content).toBe("resposta do candidato B");
    expect(String(assistant?.message.content)).not.toContain("parcial");
    // Nenhum texto da tentativa A sobreviveu na thread.
    for (const message of harness.store.getSnapshot().messages) {
      expect(message.content).not.toContain("parcial do candidato");
    }
  });

  it("sem substituto vencedor, o último parcial permanece marcado como incompleto", async () => {
    const harness = createHarness();
    harness.store.setActiveSession("s1", []);
    harness.store.send("Explore");

    await until(() => harness.streams.length === 1);
    const stream = harness.streams[0];
    stream.delta("parcial preservado");
    stream.fail(new Error("boom"));
    await expect(stream.done).rejects.toThrow("boom");

    await until(() => !harness.store.getSnapshot().isRunning);
    // Parcial NÃO é promovido a resposta completa: persiste como failed.
    expect(harness.persisted.at(-1)?.message).toMatchObject({
      content: "parcial preservado",
      role: "assistant",
      status: "failed",
    });
  });
});
