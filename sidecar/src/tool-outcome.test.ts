// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { canonicalArgsString, errorFingerprint, extractErrorCode } from "./tool-outcome.js";

describe("fingerprints estruturados (#210)", () => {
  it("erros diferentes da mesma ferramenta não compartilham assinatura", () => {
    const a = errorFingerprint("read_file", { path: "a.md" }, "O caminho não existe.");
    const b = errorFingerprint(
      "read_file",
      { path: "b.md" },
      "O trecho original não foi encontrado.",
    );
    expect(a).not.toBe(b);
  });

  it("mesma falha com os mesmos args produz a mesma assinatura", () => {
    expect(errorFingerprint("apply_patch", { path: "x.ts" }, "PATH_NOT_FOUND")).toBe(
      errorFingerprint("apply_patch", { path: "x.ts" }, "PATH_NOT_FOUND"),
    );
  });

  it("ordem das chaves dos args é irrelevante", () => {
    expect(canonicalArgsString({ b: 2, a: 1 })).toBe(canonicalArgsString({ a: 1, b: 2 }));
  });

  it("extrai código de payload estruturado e de string legada", () => {
    expect(extractErrorCode({ error: { code: "COMMAND_EXIT_CODE", message: "x" } })).toBe(
      "COMMAND_EXIT_CODE",
    );
    expect(extractErrorCode({ error: { message: "sem código" } })).toBe("sem código");
    expect(extractErrorCode({ error: "falha legada" })).toBe("falha legada");
    expect(extractErrorCode(undefined)).toBe("tool_execution_failed");
  });
});
