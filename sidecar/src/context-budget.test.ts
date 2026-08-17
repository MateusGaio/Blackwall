// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat.js";
import {
  availableContextTokens,
  CURRENT_TURN_TOOL_RESULTS_PROTECTED,
  compactionBufferTokens,
  compactTranscript,
  estimateTranscriptTokens,
  pruneHistoryForModel,
  selectMessagesForContext,
  TAIL_TURNS_PROTECTED,
} from "./context-budget.js";

function estimatedTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + Math.ceil(Buffer.byteLength(message.content) / 4),
    0,
  );
}

function longSession(exchangeCount = 20): ChatMessage[] {
  return Array.from({ length: exchangeCount }, (_, index) => {
    const callId = `call-${index}`;
    return [
      { content: `Analise o arquivo ${index}`, role: "user" as const },
      {
        content: "",
        role: "assistant" as const,
        toolCalls: [{ arguments: `{"path":"src/${index}.ts"}`, id: callId, name: "read_file" }],
      },
      {
        content: `resultado-${index}:`.padEnd(8_000, "x"),
        name: "read_file",
        role: "tool" as const,
        toolCallId: callId,
      },
    ];
  }).flat();
}

describe("orçamento de contexto", () => {
  it("mantém as duas trocas finais e poda resultados antigos sem órfãos", () => {
    const messages = longSession();
    const tailLength = TAIL_TURNS_PROTECTED * 3;
    const originalTail = messages.slice(-tailLength);
    const before = estimatedTokens(messages);
    const pruned = pruneHistoryForModel(messages, {
      contextLimit: 16_000,
      outputReserve: 4_000,
    });
    const after = estimatedTokens(pruned);

    expect(pruned).not.toBe(messages);
    expect(pruned.slice(-tailLength)).toEqual(originalTail);
    expect(after).toBeLessThanOrEqual(12_000);
    expect(after).toBeLessThan(before);
    expect(messages.some((message) => message.content.includes('"pruned":true'))).toBe(false);

    const assistantCallIds = new Set(
      pruned
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.toolCalls ?? [])
        .map((call) => call.id),
    );
    const toolMessages = pruned.filter((message) => message.role === "tool");
    expect(toolMessages.every((message) => assistantCallIds.has(message.toolCallId ?? ""))).toBe(
      true,
    );
  });

  it("não poda quando o histórico já cabe no orçamento", () => {
    const messages = longSession(3);
    const pruned = pruneHistoryForModel(messages, {
      contextLimit: 64_000,
      outputReserve: 4_000,
    });
    expect(pruned).toEqual(messages);
    expect(pruned).not.toBe(messages);
  });

  it("poda o transcript intra-turno antes da oitava chamada de ferramenta", () => {
    const budget = { contextLimit: 16_000, outputReserve: 4_000 };
    const initial: ChatMessage[] = [
      { content: "turno antigo 1", role: "user" },
      { content: "", role: "assistant", toolCalls: [] },
      { content: "resultado antigo 1".padEnd(12_000, "x"), role: "tool", toolCallId: "old-1" },
      { content: "turno antigo 2", role: "user" },
      { content: "", role: "assistant", toolCalls: [] },
      { content: "resultado antigo 2".padEnd(12_000, "x"), role: "tool", toolCallId: "old-2" },
      { content: "Explore este workspace", role: "user" },
    ];
    let transcriptWithPruning = initial;
    let transcriptWithoutPruning = initial;
    const sentWithPruning: number[] = [];
    const sentWithoutPruning: number[] = [];

    const currentTurnStart = initial.length;
    for (let index = 0; index < 8; index += 1) {
      transcriptWithPruning = pruneHistoryForModel(transcriptWithPruning, budget, {
        currentTurnStart,
        currentTurnToolResultsToProtect: CURRENT_TURN_TOOL_RESULTS_PROTECTED,
      });
      sentWithPruning.push(estimatedTokens(transcriptWithPruning));
      sentWithoutPruning.push(estimatedTokens(transcriptWithoutPruning));

      const callId = `turn-call-${index}`;
      const exchange: ChatMessage[] = [
        {
          content: "",
          role: "assistant",
          toolCalls: [{ arguments: `{"path":"src/${index}.ts"}`, id: callId, name: "read_file" }],
        },
        {
          content: `resultado-${index}`.padEnd(12_000, "x"),
          name: "read_file",
          role: "tool",
          toolCallId: callId,
        },
      ];
      transcriptWithPruning = [...transcriptWithPruning, ...exchange];
      transcriptWithoutPruning = [...transcriptWithoutPruning, ...exchange];
    }

    expect(sentWithPruning[7]).toBeLessThan(sentWithoutPruning[7]);
    expect(sentWithPruning[7]).toBeLessThanOrEqual(availableContextTokens(budget));
  });

  it("poda dezenas de resultados pequenos no turno atual mesmo com histórico anterior", () => {
    const budget = { contextLimit: 16_000, outputReserve: 4_000 };
    const history: ChatMessage[] = [
      { content: "turno completo anterior 1".padEnd(5_000, "a"), role: "user" },
      { content: "resposta anterior 1".padEnd(5_000, "b"), role: "assistant" },
      { content: "resultado anterior 1".padEnd(300, "c"), role: "tool", toolCallId: "old-1" },
      { content: "turno completo anterior 2".padEnd(5_000, "d"), role: "user" },
      { content: "resposta anterior 2".padEnd(5_000, "e"), role: "assistant" },
      { content: "resultado anterior 2".padEnd(300, "f"), role: "tool", toolCallId: "old-2" },
      { content: "explore o projeto atual", role: "user" },
    ];
    const currentTurnStart = history.length;
    let transcript = history;
    let transcriptWithoutPruning = history;
    let sentAtFinalIteration = 0;

    for (let index = 0; index < 35; index += 1) {
      transcript = pruneHistoryForModel(transcript, budget, {
        currentTurnStart,
        currentTurnToolResultsToProtect: CURRENT_TURN_TOOL_RESULTS_PROTECTED,
      });
      if (index === 34) sentAtFinalIteration = estimatedTokens(transcript);

      const callId = `small-call-${index}`;
      const exchange: ChatMessage[] = [
        {
          content: "",
          role: "assistant",
          toolCalls: [
            { arguments: `{"path":"src/module-${index}.ts"}`, id: callId, name: "read_file" },
          ],
        },
        {
          content: `resultado pequeno ${index}`.padEnd(900, "x"),
          name: "read_file",
          role: "tool",
          toolCallId: callId,
        },
      ];
      transcript = [...transcript, ...exchange];
      transcriptWithoutPruning = [...transcriptWithoutPruning, ...exchange];
    }

    const availableTokens = availableContextTokens(budget);
    expect(sentAtFinalIteration).toBeLessThanOrEqual(availableTokens);
    expect(sentAtFinalIteration).toBeLessThan(estimatedTokens(transcriptWithoutPruning));
    expect(transcript.some((message) => message.content.includes('"pruned":true'))).toBe(true);
  });

  it("poda saída de ferramentas antigas por um teto fixo, mesmo com folga enorme no limite do modelo", () => {
    const messages = longSession(40);
    const before = estimatedTokens(messages);
    const budget = { contextLimit: 262_144 }; // janela grande — nunca perto do limite
    const available = availableContextTokens(budget);
    expect(before).toBeLessThan(available); // garante que não é o teto do modelo disparando a poda

    const pruned = pruneHistoryForModel(messages, budget);
    const after = estimatedTokens(pruned);

    expect(after).toBeLessThan(before);
    const tailLength = TAIL_TURNS_PROTECTED * 3;
    expect(pruned.slice(-tailLength)).toEqual(messages.slice(-tailLength));
    expect(pruned.some((message) => message.content.includes('"pruned":true'))).toBe(true);
  });

  it("não aplica o teto fixo quando o histórico elegível ainda cabe nele", () => {
    const messages = longSession(3);
    const pruned = pruneHistoryForModel(messages, { contextLimit: 262_144 });
    expect(pruned).toEqual(messages);
  });

  it("escala o buffer pela janela do modelo", () => {
    expect(compactionBufferTokens({ contextLimit: 32_000 })).toBe(4_800);
    expect(compactionBufferTokens({ contextLimit: 200_000 })).toBe(30_000);
    expect(compactionBufferTokens({ contextLimit: 32_000, outputReserve: 6_000 })).toBe(6_000);
  });

  it("compacta só o histórico antigo e preserva o prefixo e a cauda", async () => {
    const messages = [
      { content: "Soul fixa", role: "system" as const },
      ...longSession(3),
      { content: "pedido atual", role: "user" as const },
    ];
    const originalTail = messages.slice(-4);
    const compacted = await compactTranscript(messages, {
      budget: { contextLimit: 32_000 },
      summarize: async (oldHistory) => {
        expect(oldHistory.some((message) => message.content === "Soul fixa")).toBe(false);
        return "## Objetivo\n\nResumo denso.";
      },
    });

    expect(compacted[0]).toEqual(messages[0]);
    expect(compacted.find((message) => message.isSummary)?.content).toContain("Resumo denso");
    expect(compacted.slice(-originalTail.length)).toEqual(originalTail);
    expect(estimateTranscriptTokens(compacted)).toBeLessThan(estimateTranscriptTokens(messages));
  });

  it("reconstrói a sessão com o resumo mais recente e a cauda sem duplicatas", () => {
    const messages = [
      { content: "antes", id: "old", role: "user" as const, sequence: 1 },
      {
        content: "Resumo 1",
        id: "summary-1",
        isSummary: true,
        role: "system" as const,
        sequence: 2,
      },
      { content: "turno protegido", id: "tail", role: "user" as const, sequence: 3 },
      {
        content: "Resumo 2",
        id: "summary-2",
        isSummary: true,
        role: "system" as const,
        sequence: 4,
      },
      { content: "novo", id: "new", role: "user" as const, sequence: 5 },
    ];
    const selected = selectMessagesForContext(messages);
    expect(selected.map((message) => message.id)).toEqual(["summary-2", "old", "tail", "new"]);
    expect(new Set(selected.map((message) => message.id)).size).toBe(selected.length);
  });
});
