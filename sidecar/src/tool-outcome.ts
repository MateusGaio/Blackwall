// MIT License — Copyright (c) 2026 Mateus Gaio

/**
 * Contrato de resultado de ferramenta (#210).
 *
 * `sideEffect` classifica o que o mundo externo pode ter sofrido:
 * - "none": leitura pura falhou/ok sem tocar nada;
 * - "confirmed": mutação concluída (arquivo escrito, patch aplicado);
 * - "possible": comando iniciado que pode ter alterado algo antes de falhar
 *   (exit ≠ 0, timeout, spawn error). SEMPRE invalida cache e proíbe retry
 *   automático sem idempotência.
 */
type SideEffect = "none" | "confirmed" | "possible";

type ToolErrorCategory = "validation" | "policy" | "execution" | "timeout" | "cancelled";

type ToolOutcomeOk = {
  ok: true;
  data: unknown;
  sideEffect: SideEffect;
  truncated: boolean;
};

type ToolOutcomeError = {
  ok: false;
  error: {
    category: ToolErrorCategory;
    code: string;
    message: string;
    retryableWithChangedInput: boolean;
    hint?: string;
  };
  sideEffect: "none" | "possible";
  truncated: boolean;
};

// O envelope ToolOutcome completa a adoção no loop/eventos quando os itens
// restantes de #210 (máquina de estados e contratos de streaming) pousarem;
// os tipos ficam internos até existir consumidor real.
type ToolOutcome = ToolOutcomeOk | ToolOutcomeError;
void (undefined as unknown as ToolOutcome);

/** Chaves em ordem canônica — fingerprint independe da ordem recebida. */
export function canonicalArgsString(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const parts: string[] = [];
  for (const key of keys) parts.push(`${key}:${String(args[key])}`);
  return parts.join("|");
}

/** Extrai o código estável de um payload de erro estruturado ou legado. */
export function extractErrorCode(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error.slice(0, 120);
    if (typeof error === "object" && error !== null) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string") return code;
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message.slice(0, 120);
    }
  }
  return "tool_execution_failed";
}

/**
 * Fingerprint canônico (#210): ferramenta + args canônicos + código do erro.
 * Erros DIFERENTES da mesma ferramenta nunca compartilham contador — corrige
 * o hard stop prematuro que agrupava tudo como "[object Object]".
 */
export function errorFingerprint(
  toolName: string,
  args: Record<string, unknown>,
  errorCode: string,
): string {
  return `${toolName}(${canonicalArgsString(args)})#${errorCode}`;
}
