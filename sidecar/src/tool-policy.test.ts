// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { classifyTool, evaluateToolPolicy, type PermissionMode } from "./tool-policy.js";

const modes: PermissionMode[] = ["ask", "automatic", "read-only"];

describe("matriz de política de ferramentas (#209)", () => {
  it("cobre os três modos × três classes de ferramenta", () => {
    expect(evaluateToolPolicy("ask", "read")).toEqual({
      kind: "prompt",
      reasonCode: "ASK_MODE",
    });
    expect(evaluateToolPolicy("ask", "mutate")).toEqual({
      kind: "prompt",
      reasonCode: "ASK_MODE",
    });
    expect(evaluateToolPolicy("ask", "command")).toEqual({
      kind: "prompt",
      reasonCode: "ASK_MODE",
    });

    expect(evaluateToolPolicy("automatic", "read")).toEqual({ kind: "allow" });
    expect(evaluateToolPolicy("automatic", "mutate")).toEqual({ kind: "allow" });
    expect(evaluateToolPolicy("automatic", "command")).toMatchObject({
      kind: "deny",
      reasonCode: "AUTOMATIC_COMMAND_NOT_CONFINED",
    });

    expect(evaluateToolPolicy("read-only", "read")).toEqual({ kind: "allow" });
    expect(evaluateToolPolicy("read-only", "mutate").kind).toBe("deny");
    expect(evaluateToolPolicy("read-only", "command").kind).toBe("deny");
  });

  it("automático nunca converte deny de segurança em prompt", () => {
    for (let round = 0; round < modes.length; round += 1) {
      const decision = evaluateToolPolicy(modes[round] as PermissionMode, "command");
      if (modes[round] === "automatic") {
        expect(decision).toMatchObject({
          kind: "deny",
          reasonCode: "AUTOMATIC_COMMAND_NOT_CONFINED",
        });
      }
    }
  });

  it("classifica todas as ferramentas suportadas e trata desconhecidas como comando", () => {
    expect(classifyTool("list_directory")).toBe("read");
    expect(classifyTool("read_file")).toBe("read");
    expect(classifyTool("search_text")).toBe("read");
    expect(classifyTool("create_or_update_file")).toBe("mutate");
    expect(classifyTool("apply_patch")).toBe("mutate");
    expect(classifyTool("execute_command")).toBe("command");
    expect(classifyTool("ferramenta_inventada")).toBe("command");
  });

  it("negativas carregam mensagem útil para o usuário", () => {
    const readOnly = evaluateToolPolicy("read-only", "mutate");
    expect(readOnly.kind === "deny" && readOnly.userMessage).toContain("somente leitura");
    const unconfined = evaluateToolPolicy("automatic", "command");
    expect(unconfined.kind === "deny" && unconfined.userMessage).toContain("confinamento");
  });
});
