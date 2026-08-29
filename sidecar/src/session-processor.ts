// MIT License — Copyright (c) 2026 Mateus Gaio

export type SessionRunState =
  | "idle"
  | "busy"
  | "retrying"
  | "waiting_permission"
  | "compacting"
  | "stopping";

export type RequestTerminal = "completed" | "blocked" | "failed" | "cancelled";

type FinishReason =
  | "stop"
  | "tool-calls"
  | "length"
  | "content-filter"
  | "error"
  | "cancelled"
  | "unknown";

export type SessionRunSnapshot = {
  requestId: string;
  state: SessionRunState;
  terminal: RequestTerminal | null;
};

export function createSessionRun(requestId: string): SessionRunSnapshot {
  if (!requestId.trim()) throw new Error("requestId é obrigatório para iniciar uma run.");
  return { requestId, state: "busy", terminal: null };
}

export function transitionSessionRun(
  snapshot: SessionRunSnapshot,
  next: SessionRunState,
): SessionRunSnapshot {
  if (snapshot.terminal) return snapshot;
  return { ...snapshot, state: next };
}

/** Marca o terminal uma única vez; replay/reconnects não podem duplicá-lo. */
export function finishSessionRun(
  snapshot: SessionRunSnapshot,
  terminal: RequestTerminal,
): { accepted: boolean; snapshot: SessionRunSnapshot } {
  if (snapshot.terminal) return { accepted: false, snapshot };
  return {
    accepted: true,
    snapshot: { ...snapshot, state: terminal === "cancelled" ? "stopping" : "idle", terminal },
  };
}

export function normalizeSessionFinishReason(value: unknown): FinishReason {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLocaleLowerCase().replaceAll("_", "-");
  if (["stop", "end", "completed"].includes(normalized)) return "stop";
  if (["tool-call", "tool-calls", "function-call"].includes(normalized)) return "tool-calls";
  if (["length", "max-tokens", "max-output"].includes(normalized)) return "length";
  if (["content-filter", "content-filtered"].includes(normalized)) return "content-filter";
  if (normalized === "error") return "error";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  return "unknown";
}
