// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash } from "node:crypto";

const E2E_SCENARIOS = [
  "default",
  "invalid_paths",
  "pending_mutation",
  "hybrid_search",
  "search_turn_limit",
  "mcp",
  "memory",
  "memory_fail_once",
  "pdf_citation",
  "citation_review",
  "embedding_unavailable",
] as const;

type E2EScenario = (typeof E2E_SCENARIOS)[number];

type E2EState = {
  embeddingAttempts: number;
  memoryAttempts: number;
  mcpReads: number;
  mcpWrites: number;
  scenario: E2EScenario;
};

const initialState = (): E2EState => ({
  embeddingAttempts: 0,
  memoryAttempts: 0,
  mcpReads: 0,
  mcpWrites: 0,
  scenario: "default",
});

let state = initialState();

export function e2eControlsEnabled() {
  return process.env.BLACKWALL_E2E === "1";
}

export function getE2EState(): E2EState {
  return { ...state };
}

export function setE2EState(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("O estado E2E precisa ser um objeto.");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "scenario"))
    throw new Error("O estado E2E aceita somente o cenário enum.");
  if (!E2E_SCENARIOS.includes(record.scenario as E2EScenario))
    throw new Error("O cenário E2E informado é inválido.");
  state = { ...initialState(), scenario: record.scenario as E2EScenario };
  return getE2EState();
}

export function e2eMcpCall(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("O pedido MCP E2E precisa ser um objeto.");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "operation"))
    throw new Error("O MCP E2E aceita somente a operação enum.");
  if (record.operation !== "read_marker" && record.operation !== "write_marker")
    throw new Error("A operação MCP E2E é inválida.");
  if (record.operation === "read_marker") state.mcpReads += 1;
  else state.mcpWrites += 1;
  return {
    counters: { reads: state.mcpReads, writes: state.mcpWrites },
    marker: "blackwall-e2e-marker",
    operation: record.operation,
  };
}

export function nextMemoryAttempt() {
  state.memoryAttempts += 1;
  return state.memoryAttempts;
}

export function nextEmbeddingAttempt() {
  state.embeddingAttempts += 1;
  return state.embeddingAttempts;
}

export function deterministicEmbedding(text: string, dimension: number) {
  const vector: number[] = [];
  for (let index = 0; index < dimension; index += 1) {
    const digest = createHash("sha256").update(`${index}\0${text}`).digest();
    vector.push((digest.readUInt16BE(0) / 65_535) * 2 - 1);
  }
  return vector;
}
