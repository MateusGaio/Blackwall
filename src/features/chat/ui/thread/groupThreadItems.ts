// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChatMessage } from "../../../../shared/api/sidecar";

type ThreadItem =
  | { kind: "message"; message: ChatMessage; steps: ChatMessage[] }
  | { kind: "orphan-steps"; steps: ChatMessage[] };

/**
 * Agrupa eventos de ferramenta na RESPOSTA SEGUINTE do assistente (decisão
 * do owner, #218): o disclosure vive depois da resposta, não como bloco
 * solto. Passos que não são seguidos por resposta — falha terminal ou fim
 * de transcript — viram bloco órfão preservado (fallback no fim). Passos
 * seguidos por mensagem do usuário também não podem desaparecer: saem como
 * bloco órfão antes dela, mantendo a cronologia.
 */
export function groupThreadItems(messages: readonly ChatMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  let pending: ChatMessage[] = [];
  const flushOrphan = () => {
    if (pending.length > 0) {
      items.push({ kind: "orphan-steps", steps: pending });
      pending = [];
    }
  };
  for (const message of messages) {
    if (message.role === "tool") {
      pending.push(message);
      continue;
    }
    if (message.role === "assistant") {
      // A resposta herda os passos que a precederam.
      items.push({ kind: "message", message, steps: pending });
      pending = [];
      continue;
    }
    // Usuário/sistema: passos pendentes ficam órfãos ANTES da mensagem.
    flushOrphan();
    items.push({ kind: "message", message, steps: [] });
  }
  flushOrphan();
  return items;
}
