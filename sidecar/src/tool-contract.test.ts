// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  parseCompatibilityToolCall,
  parseToolArguments,
  shouldStopAfterRepeatedToolError,
} from "./tool-contract.js";

describe("contrato de ferramentas", () => {
  it("aceita somente o envelope JSON de compatibilidade", () => {
    const call = parseCompatibilityToolCall('{"tool":"read_file","args":{"path":"PRODUCT.md"}}');
    expect(call?.name).toBe("read_file");
    expect(call?.arguments).toBe('{"path":"PRODUCT.md"}');
    expect(parseCompatibilityToolCall("Vou executar cat PRODUCT.md")).toBeNull();
  });

  it("rejeita campos desconhecidos e argumentos incompletos", () => {
    expect(() => parseToolArguments("read_file", '{"path":"a.md","command":"cat"}')).toThrow(
      "não é aceito",
    );
    expect(() => parseToolArguments("execute_command", '{"command":"cat"}')).toThrow("obrigatório");
  });

  it("interrompe somente depois de três erros iguais consecutivos", () => {
    expect(shouldStopAfterRepeatedToolError(1)).toBe(false);
    expect(shouldStopAfterRepeatedToolError(2)).toBe(false);
    expect(shouldStopAfterRepeatedToolError(3)).toBe(true);
  });
});
