// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import {
  createSessionRun,
  finishSessionRun,
  normalizeSessionFinishReason,
  transitionSessionRun,
} from "./session-processor.js";

describe("session processor", () => {
  it("mantém waiting_permission não terminal e aceita exatamente um terminal", () => {
    const waiting = transitionSessionRun(createSessionRun("req-1"), "waiting_permission");
    expect(waiting.terminal).toBeNull();
    const completed = finishSessionRun(waiting, "completed");
    expect(completed.accepted).toBe(true);
    expect(finishSessionRun(completed.snapshot, "failed").accepted).toBe(false);
  });

  it("normaliza finish reasons de providers diferentes", () => {
    expect(normalizeSessionFinishReason("tool_calls")).toBe("tool-calls");
    expect(normalizeSessionFinishReason("max_tokens")).toBe("length");
    expect(normalizeSessionFinishReason("content_filter")).toBe("content-filter");
    expect(normalizeSessionFinishReason("wat")).toBe("unknown");
  });
});
