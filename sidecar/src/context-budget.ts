// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChatMessage } from "./chat.js";

export const TAIL_TURNS_PROTECTED = 2;
const COMPACTION_BUFFER_RATIO = 0.15;
export const CURRENT_TURN_TOOL_RESULTS_PROTECTED = 2;

// Fixed ceilings, deliberately NOT proportional to the model's context_limit —
// mirrors OpenCode's PRUNE_PROTECT/PRUNE_MINIMUM. Without this, a model with a
// huge context window (200k+) never prunes mid-conversation because it never
// gets close to its own ceiling, so every tool call's full output keeps getting
// resent on every subsequent round-trip for the entire session. Capping how
// much old tool output is worth keeping around — independent of how much room
// the model technically has — is what keeps ordinary sessions cheap.
const TOOL_OUTPUT_BUDGET_TOKENS = 40_000;
const TOOL_OUTPUT_PRUNE_MINIMUM_TOKENS = 20_000;

type ModelContextBudget = {
  contextLimit: number;
  outputReserve?: number;
};

type ContextMessage = ChatMessage & {
  id?: string;
  sequence?: number;
  toolName?: string;
};

type HistoryPruneOptions = {
  currentTurnStart?: number;
  currentTurnToolResultsToProtect?: number;
};

function estimateContentTokens(content: string): number {
  return Math.ceil(Buffer.byteLength(content) / 4);
}

export function estimateTranscriptTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateContentTokens(message.content), 0);
}

export function compactionBufferTokens(budget: ModelContextBudget): number {
  const proportional = Math.max(1, Math.round(budget.contextLimit * COMPACTION_BUFFER_RATIO));
  return Math.max(proportional, budget.outputReserve ?? 0);
}

export function availableContextTokens(budget: ModelContextBudget): number {
  return Math.max(0, budget.contextLimit - compactionBufferTokens(budget));
}

function protectedTailStart(messages: ChatMessage[]): number {
  let turns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    turns += 1;
    if (turns === TAIL_TURNS_PROTECTED) return index;
  }
  return 0;
}

/**
 * Reconstructs a session after compaction without deleting the original rows:
 * latest summary, the current tail, and all messages written after the summary.
 */
export function selectMessagesForContext(messages: ContextMessage[]): ContextMessage[] {
  const latestSummaryIndex = messages.reduce(
    (latest, message, index) => (message.isSummary ? index : latest),
    -1,
  );
  if (latestSummaryIndex < 0) return messages.map((message) => ({ ...message }));

  const summary = messages[latestSummaryIndex];
  if (!summary) return messages.map((message) => ({ ...message }));
  const beforeSummary = messages
    .slice(0, latestSummaryIndex)
    .filter((message) => !message.isSummary);
  const afterSummary = messages
    .slice(latestSummaryIndex + 1)
    .filter((message) => !message.isSummary);
  const tail = beforeSummary.slice(protectedTailStart(beforeSummary));
  const selected = [summary, ...tail, ...afterSummary];
  const seen = new Set<string>();
  return selected.filter((message, index) => {
    const key = message.id ?? `position:${latestSummaryIndex}:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prunedToolContent(message: ChatMessage): string {
  return JSON.stringify({
    pruned: true,
    summary: `conteúdo de ${Buffer.byteLength(message.content)} bytes processado anteriormente nesta sessão`,
    tool: message.name ?? "tool",
  });
}

type EligibleEntry = { index: number; message: ChatMessage };

function replacementsFor(items: EligibleEntry[]) {
  const list = items.map(({ index, message }) => ({
    content: prunedToolContent(message),
    index,
    originalTokens: estimateContentTokens(message.content),
  }));
  const savings = list.reduce(
    (total, replacement) =>
      total + Math.max(0, replacement.originalTokens - estimateContentTokens(replacement.content)),
    0,
  );
  return { list, savings };
}

/**
 * Shrinks only old tool results in memory. Tool-call ids and surrounding
 * assistant messages remain untouched so provider protocol pairing survives.
 *
 * Two independent triggers decide what gets pruned:
 *  1. A fixed budget (TOOL_OUTPUT_BUDGET_TOKENS), independent of the model's
 *     context window, keeps only the most recent chunk of tool output around.
 *     This is what keeps large-context models from silently accumulating and
 *     resending unlimited history turn after turn.
 *  2. A safety net tied to the model's actual context_limit: if trigger 1
 *     isn't enough to fit the model's real ceiling (small-context models),
 *     fall back to pruning every eligible tool result.
 */
export function pruneHistoryForModel(
  messages: ChatMessage[],
  budget: ModelContextBudget,
  options: HistoryPruneOptions = {},
): ChatMessage[] {
  const copy = messages.map((message) => ({ ...message }));
  const tailStart = protectedTailStart(copy);
  const eligibleBetweenTurns = copy
    .map((message, index) => ({ index, message }))
    .filter(({ index, message }) => index < tailStart && message.role === "tool");
  const currentTurnStart = Math.max(
    0,
    Math.min(copy.length, options.currentTurnStart ?? copy.length),
  );
  const currentTurnToolIndexes = copy
    .map((message, index) => ({ index, message }))
    .filter(({ index, message }) => index >= currentTurnStart && message.role === "tool")
    .map(({ index }) => index);
  const protectedCurrentToolCount = Math.max(
    0,
    options.currentTurnToolResultsToProtect ?? CURRENT_TURN_TOOL_RESULTS_PROTECTED,
  );
  const protectedCurrentToolIndexes = new Set(
    currentTurnToolIndexes.slice(-protectedCurrentToolCount),
  );
  const eligible: EligibleEntry[] = [
    ...eligibleBetweenTurns,
    ...currentTurnToolIndexes
      .filter((index) => !protectedCurrentToolIndexes.has(index))
      .map((index) => ({ index, message: copy[index] as ChatMessage })),
  ];

  // Trigger 1: walk from the newest eligible tool result backwards, keeping
  // whatever fits in TOOL_OUTPUT_BUDGET_TOKENS; anything older is a candidate.
  let cumulative = 0;
  const beyondFixedBudget: EligibleEntry[] = [];
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const entry = eligible[index] as EligibleEntry;
    const tokens = estimateContentTokens(entry.message.content);
    if (cumulative + tokens <= TOOL_OUTPUT_BUDGET_TOKENS) {
      cumulative += tokens;
      continue;
    }
    beyondFixedBudget.push(entry);
  }
  const fixed = replacementsFor(beyondFixedBudget);
  let replacements = fixed.savings > TOOL_OUTPUT_PRUNE_MINIMUM_TOKENS ? fixed.list : [];

  // Trigger 2: safety net against the model's real context_limit.
  const availableTokens = availableContextTokens(budget);
  const totalTokens = estimateTranscriptTokens(copy);
  const appliedSavings = replacements.reduce(
    (total, replacement) =>
      total + Math.max(0, replacement.originalTokens - estimateContentTokens(replacement.content)),
    0,
  );
  if (totalTokens - appliedSavings > availableTokens) {
    const all = replacementsFor(eligible);
    if (all.savings > 0) replacements = all.list;
  }

  if (replacements.length === 0) return copy;

  for (const replacement of replacements) {
    copy[replacement.index] = { ...copy[replacement.index], content: replacement.content };
  }
  return copy;
}

type CompactTranscriptOptions = {
  budget: ModelContextBudget;
  summarize: (messages: ContextMessage[]) => Promise<string>;
};

/**
 * Replaces old conversational history with one model-generated summary while
 * keeping fixed system instructions and the protected tail intact.
 */
export async function compactTranscript(
  messages: ContextMessage[],
  options: CompactTranscriptOptions,
): Promise<ContextMessage[]> {
  const systemPrefixLength = messages.findIndex(
    (message) => message.role !== "system" || message.isSummary,
  );
  const prefixLength = systemPrefixLength < 0 ? messages.length : systemPrefixLength;
  const systemPrefix = messages.slice(0, prefixLength);
  const conversation = messages.slice(prefixLength);
  const tailStart = protectedTailStart(conversation);
  const oldHistory = conversation.slice(0, tailStart);
  const protectedTail = conversation.slice(tailStart);
  if (!oldHistory.length) {
    throw new Error(
      "Esta conversa ficou grande demais para este modelo; comece uma nova sessão ou troque para um modelo com janela maior.",
    );
  }
  const summary = (await options.summarize(oldHistory)).trim();
  if (!summary) {
    throw new Error(
      "Esta conversa ficou grande demais para este modelo; comece uma nova sessão ou troque para um modelo com janela maior.",
    );
  }
  return [...systemPrefix, { content: summary, isSummary: true, role: "system" }, ...protectedTail];
}
