// MIT License — Copyright (c) 2026 Mateus Gaio
export const sidebarCollapsedPreference = "blackwall:sidebar-collapsed";
export const vaultCollapsedPreference = "blackwall:vault-collapsed";

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
