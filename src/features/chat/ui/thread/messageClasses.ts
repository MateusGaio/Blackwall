// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChatMessage } from "../../../../shared/api/sidecar";
import { cn } from "../../../../shared/lib/utils";

/** Mensagens flat do §3: usuário à direita, agente à esquerda, sem bolha. */
export function messageClasses(role: ChatMessage["role"]) {
  return cn(
    "max-w-[min(85%,640px)] leading-relaxed",
    role === "user" && "message-user flex flex-col items-end gap-1 self-end text-right",
    role === "assistant" &&
      "message-assistant flex flex-col items-start gap-1 self-start px-1 text-foreground/90",
    role === "system" &&
      "self-start border-l-2 border-border px-3 font-mono text-xs text-muted-foreground",
  );
}

export const streamingMinHeight = "min-h-[1.6em]";
