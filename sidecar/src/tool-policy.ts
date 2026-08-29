// MIT License — Copyright (c) 2026 Mateus Gaio

/**
 * Política canônica de ferramentas (Issue #209).
 *
 * Fonte ÚNICA da matriz modo × classe de ferramenta. Nenhum condicional de
 * modo pode ser espalhado por UI, store ou executor: todos os caminhos
 * chamam `evaluateToolPolicy`.
 *
 * Matriz:
 * | modo       | ler/listar/buscar | criar/editar/patch   | executar comando      |
 * | ask        | prompt            | prompt               | prompt                |
 * | automatic  | allow             | allow após validações| allow                 |
 * | read-only  | allow             | deny                 | deny                  |
 */

export type PermissionMode = "ask" | "automatic" | "read-only";

/** Classe de risco da ferramenta, independente do nome. */
type PolicyToolClass = "read" | "mutate" | "command";

export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "prompt"; reasonCode: "ASK_MODE" }
  | {
      kind: "deny";
      reasonCode: "READ_ONLY_MUTATION" | "READ_ONLY_COMMAND";
      userMessage: string;
    };

const USER_MESSAGES = {
  READ_ONLY_COMMAND: "O workspace está em modo somente leitura; executar comandos foi bloqueado.",
  READ_ONLY_MUTATION: "O workspace está em modo somente leitura; esta ação foi bloqueada.",
} as const;

/** Classe de risco por ferramenta suportada. */
export function classifyTool(tool: string): PolicyToolClass {
  switch (tool) {
    case "apply_patch":
    case "create_or_update_file":
    case "create_vault_note":
      return "mutate";
    case "bash":
    case "execute_command": // alias de histórico; chamadas novas usam bash
      return "command";
    case "list_directory":
    case "read_file":
    case "search_text":
      return "read";
    default:
      // Ferramenta desconhecida é tratada no nível mais restritivo.
      return "command";
  }
}

/**
 * Decisão PURA — sem I/O, sem relógio, sem banco. O executor é responsável
 * por: validar caminho/schema ANTES do efeito, reler o modo imediatamente
 * antes do efeito e serializar mudanças de modo (commit point).
 */
export function evaluateToolPolicy(
  mode: PermissionMode,
  toolClass: PolicyToolClass,
): PolicyDecision {
  if (mode === "ask") return { kind: "prompt", reasonCode: "ASK_MODE" };
  if (mode === "read-only") {
    if (toolClass === "mutate")
      return {
        kind: "deny",
        reasonCode: "READ_ONLY_MUTATION",
        userMessage: USER_MESSAGES.READ_ONLY_MUTATION,
      };
    if (toolClass === "command")
      return {
        kind: "deny",
        reasonCode: "READ_ONLY_COMMAND",
        userMessage: USER_MESSAGES.READ_ONLY_COMMAND,
      };
    return { kind: "allow" };
  }
  // automatic: Bash roda com a autoridade normal do usuário host. Timeouts,
  // cancelamento, ambiente deliberado e output limitado dão previsibilidade,
  // mas não são sandbox.
  return { kind: "allow" };
}
