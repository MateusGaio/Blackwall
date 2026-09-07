// MIT License — Copyright (c) 2026 Mateus Gaio

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deterministicEmbedding,
  e2eControlsEnabled,
  e2eMcpCall,
  getE2EState,
  setE2EState,
} from "./e2e-controls.js";

afterEach(() => {
  vi.unstubAllEnvs();
  setE2EState({ scenario: "default" });
});

describe("controles determinísticos do harness E2E", () => {
  it("só habilita controles quando o modo E2E explícito está ativo", () => {
    expect(e2eControlsEnabled()).toBe(false);
    vi.stubEnv("BLACKWALL_E2E", "1");
    expect(e2eControlsEnabled()).toBe(true);
  });

  it("aceita somente cenários enum e reinicia contadores", () => {
    expect(setE2EState({ scenario: "mcp" })).toMatchObject({
      mcpReads: 0,
      mcpWrites: 0,
      scenario: "mcp",
    });
    expect(() => setE2EState({ scenario: "mcp", path: "/tmp" })).toThrow();
    expect(() => setE2EState({ scenario: "custom", path: "/tmp" })).toThrow();
  });

  it("mantém MCP sintético limitado a marcadores e contadores", () => {
    setE2EState({ scenario: "mcp" });
    expect(e2eMcpCall({ operation: "read_marker" })).toEqual({
      counters: { reads: 1, writes: 0 },
      marker: "blackwall-e2e-marker",
      operation: "read_marker",
    });
    expect(e2eMcpCall({ operation: "write_marker" })).toMatchObject({
      counters: { reads: 1, writes: 1 },
    });
    expect(() => e2eMcpCall({ operation: "write_marker", path: "/tmp" })).toThrow();
    expect(getE2EState()).toMatchObject({ mcpReads: 1, mcpWrites: 1 });
  });

  it("gera embeddings estáveis e limitados à dimensão solicitada", () => {
    const first = deterministicEmbedding("nota E2E", 8);
    expect(first).toHaveLength(8);
    expect(first).toEqual(deterministicEmbedding("nota E2E", 8));
    expect(first.every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(first).not.toEqual(deterministicEmbedding("outra nota", 8));
  });
});
