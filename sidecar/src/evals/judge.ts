// MIT License — Copyright (c) 2026 Mateus Gaio

/**
 * Julgamento PURO das expectativas do corpus (#211). Regra conjunta:
 * quando DOIS critérios são especificados (ex.: code + messageIncludes),
 * AMBOS devem valer — não basta um. Usado também por testes negativos que
 * provam que expectativa errada NÃO passa.
 */
export type TaskExpect =
  | { kind: "ok"; field?: string; value?: unknown }
  | { kind: "deny"; code: string }
  | { kind: "error"; code?: string; messageIncludes?: string };

type JudgedOutcome =
  | { ok: true; data?: unknown }
  | { ok: false; errorCode?: string; message?: string };

export function judge(
  expectation: TaskExpect,
  outcome: JudgedOutcome,
): { passed: boolean; detail: string } {
  if (expectation.kind === "ok") {
    if (!outcome.ok) return { passed: false, detail: `esperava sucesso, veio erro` };
    if (expectation.field === undefined) return { passed: true, detail: "" };
    const data = outcome.data;
    if (typeof data !== "object" || data === null)
      return { passed: false, detail: "sem objeto para campo" };
    const actual = (data as Record<string, unknown>)[expectation.field];
    const passed = actual === expectation.value;
    return {
      passed,
      detail: passed
        ? ""
        : `campo ${expectation.field}: ${String(actual)} ≠ ${String(expectation.value)}`,
    };
  }
  if (outcome.ok) return { passed: false, detail: "esperava negação/erro, veio sucesso" };
  if (expectation.kind === "deny") {
    const passed = outcome.errorCode === expectation.code;
    return { passed, detail: passed ? "" : `código ${outcome.errorCode} ≠ ${expectation.code}` };
  }
  // kind === "error": conjunção — cada critério definido precisa bater.
  if (expectation.code !== undefined && outcome.errorCode !== expectation.code)
    return { passed: false, detail: `código ${outcome.errorCode} ≠ ${expectation.code}` };
  if (
    expectation.messageIncludes !== undefined &&
    !(outcome.message ?? "").includes(expectation.messageIncludes)
  )
    return { passed: false, detail: `mensagem sem "${expectation.messageIncludes}"` };
  if (expectation.code === undefined && expectation.messageIncludes === undefined)
    return { passed: false, detail: "expectativa de erro sem critério" };
  return { passed: true, detail: "" };
}
