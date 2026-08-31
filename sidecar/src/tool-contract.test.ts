// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import type { McpToolDefinition } from "./mcp.js";
import {
  DEFAULT_SEARCH_WORKSPACE_LIMIT,
  DEFAULT_TOOL_CALL_BUDGET,
  MAX_IDENTICAL_TOOL_CALLS_WITHOUT_PROGRESS,
  MAX_SEARCH_WORKSPACE_CALLS_PER_TURN,
  MAX_SEARCH_WORKSPACE_LIMIT,
  MAX_TOOL_CALL_BUDGET,
  normalizeCommandArgs,
  normalizeToolArguments,
  parseCompatibilityToolCall,
  parseToolArguments,
  resolveToolCallBudget,
  shouldStopAfterNoProgress,
  shouldStopAfterRepeatedToolError,
  ToolValidationFailure,
  toOllamaTools,
  toOpenAIChatTools,
  toOpenAIResponsesTools,
  vaultNoteToolDefinition,
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

  it("normaliza o alias histórico para o contrato canônico de Bash", () => {
    expect(
      parseToolArguments(
        "execute_command",
        JSON.stringify({ command: 'ls -la "pasta com espaços"', cwd: "/workspace" }),
      ),
    ).toEqual({ command: 'ls -la "pasta com espaços"', workdir: "." });
    expect(parseToolArguments("execute_command", '{"command":"node"}')).toEqual({
      command: "node",
    });
  });

  it("aceita a sintaxe normal de shell no Bash canônico", () => {
    for (const command of ["ls | cat", "echo ok > file", "A=1 node", "git status && pwd"]) {
      expect(normalizeToolArguments("bash", { command })).toMatchObject({ command });
    }
  });

  it("normaliza search_workspace com limite padrão, teto e consulta compatível", () => {
    expect(parseToolArguments("search_workspace", '{"query":"  contexto local  "}')).toEqual({
      limit: DEFAULT_SEARCH_WORKSPACE_LIMIT,
      query: "contexto local",
    });
    expect(
      parseCompatibilityToolCall('{"tool":"search_workspace","args":{"query":"Vault"}}')?.name,
    ).toBe("search_workspace");
    expect(MAX_SEARCH_WORKSPACE_LIMIT).toBe(8);
    expect(MAX_SEARCH_WORKSPACE_CALLS_PER_TURN).toBe(3);
    for (const limit of [0, 1.5, 9, "6"]) {
      expect(() =>
        parseToolArguments("search_workspace", JSON.stringify({ limit, query: "x" })),
      ).toThrow("limit");
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
      /LISTA de textos/,
    );
  });

  it("anuncia somente bash ao modelo e mantém o alias fora das definições", () => {
    expect(workspaceToolDefinitions.map((tool) => tool.function.name)).toContain("bash");
    expect(workspaceToolDefinitions.map((tool) => tool.function.name)).not.toContain(
      "execute_command",
    );
  });

  it("valida os cinco campos estritos de create_vault_note", () => {
    expect(
      parseToolArguments(
        "create_vault_note",
        JSON.stringify({
          belongsTo: null,
          body: "Conteúdo",
          relatedTo: [],
          title: "Título",
          type: "Note",
        }),
      ),
    ).toMatchObject({ belongsTo: null, relatedTo: [], type: "Note" });
    expect(vaultNoteToolDefinition.function.parameters.additionalProperties).toBe(false);
    expect(() =>
      parseToolArguments(
        "create_vault_note",
        JSON.stringify({
          belongsTo: null,
          body: "Conteúdo",
          extra: true,
          relatedTo: [],
          title: "Título",
          type: "Note",
        }),
      ),
    ).toThrow("não é aceito");
  });

  it("serializa o mesmo contrato para Chat, Responses e Ollama", () => {
    for (const tool of workspaceToolDefinitions) {
      const properties = tool.function.parameters.properties as Record<string, unknown>;
      const required = tool.function.parameters.required as string[];
      expect(tool.function.parameters.additionalProperties).toBe(false);
      expect(required.every((field) => field in properties)).toBe(true);
      expect(Object.keys(properties).length).toBeGreaterThanOrEqual(required.length);
    }
    expect(toOpenAIChatTools(workspaceToolDefinitions)[0]?.function.strict).toBe(true);
    expect(toOllamaTools(workspaceToolDefinitions)[0]?.function.strict).toBe(true);
    expect(toOpenAIResponsesTools(workspaceToolDefinitions)[0]).toMatchObject({
      name: "list_directory",
      strict: true,
      type: "function",
    });
  });

  it("preserva schemas MCP não estritos sem forçar additionalProperties", () => {
    const mcpTool: McpToolDefinition = {
      function: {
        description: "Schema remoto",
        name: "mcp__filesystem__read",
        parameters: { properties: { path: { type: "string" } }, type: "object" },
        strict: false,
      },
      type: "function",
    };
    expect(toOpenAIChatTools([mcpTool])[0]?.function).toMatchObject({
      parameters: { properties: { path: { type: "string" } }, type: "object" },
      strict: false,
    });
    expect(toOpenAIResponsesTools([mcpTool])[0]).toMatchObject({ strict: false });
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
