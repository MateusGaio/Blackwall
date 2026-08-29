// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { initialVaultViewState, reduceVaultView, type VaultViewState } from "./vault-view";

describe("estado único do Vault", () => {
  it("nasce expandido com workspace e recolhido sem", () => {
    expect(initialVaultViewState(true)).toEqual({ mode: "expanded", tab: "files" });
    expect(initialVaultViewState(false)).toEqual({ mode: "rail", tab: "files" });
  });

  it("toggle alterna expanded ↔ rail e preserva a aba", () => {
    let state = initialVaultViewState(true);
    state = reduceVaultView(state, { type: "shortcut-activated", tab: "graph" });
    expect(state).toEqual({ mode: "expanded", tab: "graph" });
    state = reduceVaultView(state, { type: "toggle-requested", hasWorkspace: true });
    expect(state).toEqual({ mode: "rail", tab: "graph" });
    state = reduceVaultView(state, { type: "toggle-requested", hasWorkspace: true });
    // A aba previamente ativa é preservada quando o usuário só recolheu.
    expect(state).toEqual({ mode: "expanded", tab: "graph" });
  });

  it("atalho do trilho reabre na aba correspondente", () => {
    let state: VaultViewState = initialVaultViewState(true);
    state = reduceVaultView(state, { type: "toggle-requested", hasWorkspace: true });
    expect(state.mode).toBe("rail");
    state = reduceVaultView(state, { type: "shortcut-activated", tab: "files" });
    expect(state).toEqual({ mode: "expanded", tab: "files" });
  });

  it("toggle sem workspace não produz combinação impossível", () => {
    const state = initialVaultViewState(false);
    const next = reduceVaultView(state, { type: "toggle-requested", hasWorkspace: false });
    expect(next).toEqual(initialVaultViewState(false));
  });

  it("troca de workspace reinicia coerentemente", () => {
    let state = reduceVaultView(initialVaultViewState(true), {
      type: "toggle-requested",
      hasWorkspace: true,
    });
    expect(state.mode).toBe("rail");
    state = reduceVaultView(state, { type: "workspace-changed", hasWorkspace: false });
    expect(state).toEqual({ mode: "rail", tab: "files" });
    state = reduceVaultView(state, { type: "workspace-changed", hasWorkspace: true });
    expect(state.mode).toBe("expanded");
  });

  it("nunca existe modo rail com painel expandido simultaneamente (invariante)", () => {
    let state = initialVaultViewState(true);
    for (let step = 0; step < 6; step += 1) {
      state = reduceVaultView(state, { type: "toggle-requested", hasWorkspace: true });
      expect(["expanded", "rail"]).toContain(state.mode);
      expect(["files", "graph"]).toContain(state.tab);
    }
  });
});
