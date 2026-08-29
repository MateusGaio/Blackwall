// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { detectExplicitCaptureIntent, redactMemoryInput } from "./memory-intent.js";

describe("intenção explícita de memória", () => {
  it("reconhece /nota e referente ativo", () => {
    expect(detectExplicitCaptureIntent("/nota usar SQLite como fonte de verdade")).toMatchObject({
      kind: "command",
      reason: "explicit_request",
    });
    expect(detectExplicitCaptureIntent("salve isso", "A decisão é local-first")).toMatchObject({
      content: "A decisão é local-first",
      kind: "request",
    });
  });

  it("falha fechada para negação, pergunta meta e referente ausente", () => {
    expect(detectExplicitCaptureIntent("não salve isso").reason).toBe("negated");
    expect(detectExplicitCaptureIntent("como eu salvo uma nota?").reason).toBe("meta_question");
    expect(detectExplicitCaptureIntent("lembre isso").kind).toBe("ambiguous");
  });

  it("redige segredos antes de qualquer uso externo", () => {
    const redacted = redactMemoryInput("api_key=secret123 e senha: muito-secreta");
    expect(redacted).not.toContain("secret123");
    expect(redacted).not.toContain("muito-secreta");
  });
});
