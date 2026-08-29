// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { detectExplicitCaptureIntent, redactMemoryInput } from "./memory-intent.js";

describe("intenção explícita de memória", () => {
  it("reconhece somente o comando /nota", () => {
    expect(detectExplicitCaptureIntent("/nota usar SQLite como fonte de verdade")).toMatchObject({
      kind: "command",
      reason: "explicit_request",
    });
    expect(detectExplicitCaptureIntent("/nota")).toMatchObject({
      kind: "ambiguous",
      reason: "missing_referent",
    });
  });

  it("não cria intenção para linguagem natural, prefixos ou blocos", () => {
    expect(detectExplicitCaptureIntent("salve isso").kind).toBe("none");
    expect(detectExplicitCaptureIntent("/notas salvar").kind).toBe("none");
    expect(detectExplicitCaptureIntent("texto /nota salvar").kind).toBe("none");
    expect(detectExplicitCaptureIntent("```\n/nota salvar\n```").kind).toBe("none");
  });

  it("redige segredos antes de qualquer uso externo", () => {
    const redacted = redactMemoryInput("api_key=secret123 e senha: muito-secreta");
    expect(redacted).not.toContain("secret123");
    expect(redacted).not.toContain("muito-secreta");
  });
});
