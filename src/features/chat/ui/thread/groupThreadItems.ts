// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChatMessage } from "../../../../shared/api/sidecar";

type ThreadItem =
  | { kind: "message"; message: ChatMessage }
  | { kind: "steps"; steps: ChatMessage[] };

/** Agrupa mensagens de ferramenta consecutivas em um bloco colapsável. */
export function groupThreadItems(messages: readonly ChatMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  let steps: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      steps.push(message);
      continue;
    }
    if (steps.length > 0) {
      items.push({ kind: "steps", steps });
      steps = [];
    }
    items.push({ kind: "message", message });
  }
  if (steps.length > 0) items.push({ kind: "steps", steps });
  return items;
}
