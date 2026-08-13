// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { formatWorkspaceToolResult, modelRequestsWorkspaceAccess } from "./workspace-access";

describe("workspace access detection", () => {
  it("detects an English filesystem access refusal", () => {
    expect(
      modelRequestsWorkspaceAccess(
        "I don't have direct filesystem access to this project directory.",
      ),
    ).toBe(true);
  });

  it("detects a Portuguese folder access refusal", () => {
    expect(modelRequestsWorkspaceAccess("Não consigo acessar a pasta do workspace.")).toBe(true);
  });

  it("does not interrupt ordinary answers", () => {
    expect(modelRequestsWorkspaceAccess("I can explain how to read a file safely.")).toBe(false);
    expect(modelRequestsWorkspaceAccess("Não tenho certeza sobre esse conceito.")).toBe(false);
  });

  it("formats local context without leaking a prompt", () => {
    expect(formatWorkspaceToolResult({ entries: [{ name: "README.md" }] }, true)).toContain(
      "Workspace access granted. Local context:",
    );
    expect(formatWorkspaceToolResult({ entries: [] }, false)).toContain(
      "Acesso ao workspace permitido. Contexto local:",
    );
  });
});
