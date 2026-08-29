// MIT License — Copyright (c) 2026 Mateus Gaio

import {
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import i18next from "i18next";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import type { ChatMessage } from "../../../shared/api/sidecar";
import { ChatThread } from "./ChatThread";

beforeAll(async () => {
  await i18next.init();
});

const baseHandlers = {
  onEditCancel: () => undefined,
  onEditChange: () => undefined,
  onEditSubmit: () => undefined,
  onEditingStart: () => undefined,
  regenerate: () => undefined,
};

/** Runtime externo mínimo para montar as primitivas fora do app. */
function TestRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime({
    convertMessage: (message: ChatMessage): ThreadMessageLike => ({
      content: [{ text: message.content, type: "text" }],
      id: message.id,
      role: message.role === "user" ? "user" : "assistant",
    }),
    messages: [] as ChatMessage[],
    onNew: async () => undefined,
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function renderThread(props: Partial<Parameters<typeof ChatThread>[0]> = {}) {
  return renderToStaticMarkup(
    <TestRuntimeProvider>
      <ChatThread
        copiedMessageId={null}
        copyMessage={() => undefined}
        editingMessageDraft=""
        editingMessageId={null}
        listRef={{ current: null }}
        streamingId={null}
        streamingStatus=""
        visibleMessages={[
          { content: "Pergunta do usuário", id: "m1", role: "user" },
          { content: "**Resposta** do assistente", id: "m2", role: "assistant" },
        ]}
        {...baseHandlers}
        {...props}
      />
    </TestRuntimeProvider>,
  );
}

describe("ChatThread", () => {
  it("renderiza bolhas com contrato de classes e markdown seguro", () => {
    const html = renderThread();
    expect(html).toContain("message-user");
    expect(html).toContain("message-assistant");
    expect(html).toContain("Pergunta do usuário");
    expect(html).toContain("<strong>Resposta</strong>");
    expect(html).toContain("› você");
    expect(html).not.toContain("● Blackwall");
    expect(html).toContain('data-state="entered"');
  });

  it("mensagem em streaming recebe cursor e status quando vazia", () => {
    const html = renderThread({
      streamingId: "stream-1",
      streamingStatus: "Gerando…",
      visibleMessages: [{ content: "", id: "stream-1", role: "assistant" }],
    });
    expect(html).toContain("min-h-[1.6em]");
    expect(html).toContain("motion-caret-blink");
    expect(html).toContain("Gerando…");
  });

  it("cartões de resumo substituem a mensagem marcada como isSummary", () => {
    const html = renderThread({
      visibleMessages: [
        { content: "Resumo da conversa", id: "s1", isSummary: true, role: "assistant" },
      ],
    });
    expect(html).toContain("conversation-summary-card");
    expect(html).toContain("Resumo automático da conversa");
    expect(html).not.toContain("action-bar");
  });

  it("passos de ferramenta ficam no chevron APÓS a resposta, sem rótulos antigos (#218)", () => {
    const html = renderThread({
      visibleMessages: [
        { content: "ok", id: "t1", role: "tool", toolCallId: "call-1", toolName: "read_file" },
        { content: "", id: "a1", role: "assistant" },
      ],
    });
    // Disclosure presente na linha de ações, com tooltip acessível e count.
    expect(html).toContain('data-testid="agent-steps"');
    expect(html).toContain("Mostrar detalhes de 1 ação");
    expect(html).toContain('role="tooltip"');
    // Rótulos antigos eliminados do estado recolhido.
    expect(html).not.toContain("agiu");
    expect(html).not.toContain("ver detalhes");
    expect(html).not.toContain("ocultar");
    // Conteúdo dos passos só aparece quando expandido.
    expect(html).not.toContain("read_file");
  });
});
