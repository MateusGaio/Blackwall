// MIT License — Copyright (c) 2026 Mateus Gaio

type QaLatencyTarget = "indexing" | "loading" | "streaming";

const latencyMs: Record<QaLatencyTarget, number> = {
  indexing: 800,
  loading: 500,
  streaming: 650,
};

export function qaLatencyMs(target: QaLatencyTarget) {
  if (typeof document === "undefined") return 0;
  return document.documentElement.dataset.qaLatency === "slow" ? latencyMs[target] : 0;
}

export function notifyQaMotionChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("blackwall:qa-motion-change"));
}
