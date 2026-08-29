// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { normalizeSettingsSection, settingsSections } from "./settings-sections";

describe("settings sections", () => {
  it("keeps the direct Codex-like tab order", () => {
    expect(settingsSections).toEqual(["usage", "profile", "workspaces", "providers"]);
  });

  it("opens unknown or missing sections in Usage", () => {
    expect(normalizeSettingsSection(undefined)).toBe("usage");
    expect(normalizeSettingsSection("legacy")).toBe("usage");
    expect(normalizeSettingsSection("providers")).toBe("providers");
  });
});
