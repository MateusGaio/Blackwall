// MIT License — Copyright (c) 2026 Mateus Gaio
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBooleanPreference,
  readNumberPreference,
  sidebarCollapsedPreference,
  vaultPanelWidthPreference,
  writeBooleanPreference,
  writeNumberPreference,
} from "./panel-preferences";

describe("panel preferences", () => {
  let values = new Map<string, string>();

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists the collapsed sidebar preference", () => {
    writeBooleanPreference(sidebarCollapsedPreference, true);

    expect(readBooleanPreference(sidebarCollapsedPreference)).toBe(true);
  });

  it("falls back to expanded when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage blocked");
      },
    });

    expect(readBooleanPreference(sidebarCollapsedPreference)).toBe(false);
  });

  it("persists the preferred Vault panel width", () => {
    writeNumberPreference(vaultPanelWidthPreference, 420);

    expect(readNumberPreference(vaultPanelWidthPreference, 360)).toBe(420);
  });

  it("uses the fallback for an invalid stored width", () => {
    values.set(vaultPanelWidthPreference, "not-a-number");

    expect(readNumberPreference(vaultPanelWidthPreference, 360)).toBe(360);
  });
});
