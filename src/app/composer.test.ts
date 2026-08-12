// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { isSubmitShortcut } from "./composer";

describe("composer shortcut", () => {
  it("envia com Enter", () => {
    expect(isSubmitShortcut({ isComposing: false, key: "Enter", shiftKey: false })).toBe(true);
  });

  it("mantém quebra de linha com Shift+Enter", () => {
    expect(isSubmitShortcut({ isComposing: false, key: "Enter", shiftKey: true })).toBe(false);
  });

  it("não interrompe composição de texto", () => {
    expect(isSubmitShortcut({ isComposing: true, key: "Enter", shiftKey: false })).toBe(false);
  });
});
