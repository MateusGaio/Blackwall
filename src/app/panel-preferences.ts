// MIT License — Copyright (c) 2026 Mateus Gaio
export const sidebarCollapsedPreference = "blackwall:sidebar-collapsed";
export const sidebarPanelWidthPreference = "blackwall:sidebar-panel-width";
export const vaultPanelWidthPreference = "blackwall:vault-panel-width";
export const skipSessionDeleteConfirmationPreference = "blackwall:skip-session-delete-confirmation";
export const cursorTextAvoidancePreference = "blackwall:cursor-text-avoidance";

export function readBooleanPreference(key: string) {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function writeBooleanPreference(key: string, value: boolean) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // The interface remains usable when browser storage is unavailable.
  }
}

export function readNumberPreference(key: string, fallback: number) {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function writeNumberPreference(key: string, value: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // The interface remains usable when browser storage is unavailable.
  }
}
