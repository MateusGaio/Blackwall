// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { modalityForKey } from "./input-modality";

describe("modalidade de entrada", () => {
  it("classifica qualquer tecla como interação de teclado", () => {
    expect(modalityForKey({ key: "Tab" })).toBe("keyboard");
    expect(modalityForKey({ key: "Enter" })).toBe("keyboard");
  });

  it("mantém um evento sem tecla como pointer fallback", () => {
    expect(modalityForKey({ key: "" })).toBe("pointer");
  });
});
