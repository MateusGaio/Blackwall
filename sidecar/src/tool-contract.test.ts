// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_CALL_BUDGET,
  MAX_IDENTICAL_TOOL_CALLS_WITHOUT_PROGRESS,
  MAX_TOOL_CALL_BUDGET,
  normalizeCommandArgs,
  normalizeToolArguments,
  parseCompatibilityToolCall,
  parseToolArguments,
  resolveToolCallBudget,
  shouldStopAfterNoProgress,
  shouldStopAfterRepeatedToolError,
  toOllamaTools,
  ToolValidationFailure,
  toOpenAIChatTools,
  toOpenAIResponsesTools,
  workspaceToolDefinitions,
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
      cwd: ".",
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

  it("usa um orçamento generoso e configurável com teto de segurança", () => {
    expect(DEFAULT_TOOL_CALL_BUDGET).toBe(128);
    expect(resolveToolCallBudget(200)).toBe(200);
    expect(resolveToolCallBudget(9999)).toBe(MAX_TOOL_CALL_BUDGET);
    expect(resolveToolCallBudget("invalido")).toBe(DEFAULT_TOOL_CALL_BUDGET);
  });

  it("interrompe chamadas idênticas que não produzem progresso", () => {
    expect(shouldStopAfterNoProgress(1)).toBe(false);
    expect(shouldStopAfterNoProgress(MAX_IDENTICAL_TOOL_CALLS_WITHOUT_PROGRESS)).toBe(true);
  });

  it("explica o formato correto dos argumentos de comandos", () => {
    expect(() => parseToolArguments("execute_command", '{"command":"ls","args":"-la"}')).toThrow(
      "lista de textos",
    );
  });

  it("serializa o mesmo contrato para Chat, Responses e Ollama", () => {
    for (const tool of workspaceToolDefinitions) {
      const properties = tool.function.parameters.properties as Record<string, unknown>;
      const required = tool.function.parameters.required as string[];
      expect(tool.function.parameters.additionalProperties).toBe(false);
      expect(required.slice().sort()).toEqual(Object.keys(properties).sort());
    }
    expect(toOpenAIChatTools(workspaceToolDefinitions)[0]?.function.strict).toBe(true);
    expect(toOllamaTools(workspaceToolDefinitions)[0]?.function.strict).toBe(true);
    expect(toOpenAIResponsesTools(workspaceToolDefinitions)[0]).toMatchObject({
      name: "list_directory",
      strict: true,
      type: "function",
    });
  });
});

describe("normalizeCommandArgs (#210)", () => {
  it("ausente ou null significa lista vazia", () => {
    expect(normalizeCommandArgs(undefined)).toEqual([]);
    expect(normalizeCommandArgs(null)).toEqual([]);
  });

  it("array válido é normalizado para textos", () => {
    expect(normalizeCommandArgs(["status", "--short"])).toEqual(["status", "--short"]);
    expect(normalizeCommandArgs([])).toEqual([]);
    expect(normalizeCommandArgs([7, true])).toEqual(["7", "true"]);
  });

  it("string e objeto produzem falha estruturada invalid_tool_arguments", () => {
    for (const bad of ["-e process.exit(0)", { cmd: "x" }]) {
      try {
        normalizeCommandArgs(bad);
        throw new Error("deveria ter rejeitado");
      } catch (error) {
        expect(error).toBeInstanceOf(ToolValidationFailure);
        if (error instanceof ToolValidationFailure) {
          expect(error.code).toBe("invalid_tool_arguments");
          expect(error.retryable).toBe(true);
          expect(error.message).toContain("LISTA");
        }
      }
    }
  });
});
