// MIT License — Copyright (c) 2026 Mateus Gaio

/** Abas disponíveis no painel completo do Vault. */
export type VaultTab = "files" | "graph";

/**
 * Único estado visual do Vault: painel completo ou trilho recolhido.
 * Substitui os dois booleanos concorrentes (`showVault` + `vaultCollapsed`)
 * que permitiam combinações impossíveis e dois controles disputando estados.
 */
export type VaultViewMode = "expanded" | "rail";

export type VaultViewState = {
  mode: VaultViewMode;
  tab: VaultTab;
};

type VaultViewEvent =
  | { type: "toggle-requested"; hasWorkspace: boolean }
  | { type: "shortcut-activated"; tab: VaultTab }
  | { type: "tab-changed"; tab: VaultTab }
  | { type: "workspace-changed"; hasWorkspace: boolean };

export const initialVaultViewState = (hasWorkspace: boolean): VaultViewState => ({
  mode: hasWorkspace ? "expanded" : "rail",
  tab: "files",
});

export function reduceVaultView(state: VaultViewState, event: VaultViewEvent): VaultViewState {
  switch (event.type) {
    case "toggle-requested":
      // Sem workspace não há o que expandir; a orientação fica na UI.
      if (!event.hasWorkspace) return state;
      return { ...state, mode: state.mode === "expanded" ? "rail" : "expanded" };
    case "shortcut-activated":
      return { mode: "expanded", tab: event.tab };
    case "tab-changed":
      return { ...state, tab: event.tab };
    case "workspace-changed":
      if (event.hasWorkspace) return { ...state, mode: "expanded" };
      return initialVaultViewState(false);
    default:
      return state;
  }
}

/** Chave da preferência persistida do modo do Vault. */
export const vaultModePreference = "blackwall:vault-mode";
