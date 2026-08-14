// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_CALLS_PER_TURN,
  normalizeToolArguments,
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

  it("rejeita campos desconhecidos", () => {
    expect(() => parseToolArguments("read_file", '{"path":"a.md","command":"cat"}')).toThrow(
      "não é aceito",
    );
  });

  it("repara args ausente, flags misturadas e o alias do workspace", () => {
    expect(
      parseToolArguments(
        "execute_command",
        JSON.stringify({ command: 'ls -la "pasta com espaços"', cwd: "/workspace" }),
      ),
    ).toEqual({ args: ["-la", "pasta com espaços"], command: "ls", cwd: "." });
    expect(parseToolArguments("execute_command", '{"command":"node"}')).toEqual({
      args: [],
      command: "node",
    });
  });

  it("não transforma sintaxe de shell em execução", () => {
    for (const command of ["ls | cat", "echo ok > file", "A=1 node", "git status && pwd"]) {
      expect(() => normalizeToolArguments("execute_command", { command })).toThrow(
        /não são permitidos/,
      );
    }
  });

  it("interrompe na segunda repetição do mesmo erro", () => {
    expect(shouldStopAfterRepeatedToolError(1)).toBe(false);
    expect(shouldStopAfterRepeatedToolError(2)).toBe(true);
    expect(shouldStopAfterRepeatedToolError(3)).toBe(true);
  });

  it("permite exploração longa sem remover o limite de segurança", () => {
    expect(MAX_TOOL_CALLS_PER_TURN).toBe(32);
  });

  it("explica o formato correto dos argumentos de comandos", () => {
    expect(() => parseToolArguments("execute_command", '{"command":"ls","args":"-la"}')).toThrow(
      "lista de textos",
    );
  });
});
