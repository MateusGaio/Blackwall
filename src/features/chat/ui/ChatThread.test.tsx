// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
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

function renderThread(props: Partial<Parameters<typeof ChatThread>[0]> = {}) {
  return renderToStaticMarkup(
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
    />,
  );
}

describe("ChatThread", () => {
  it("renderiza bolhas com contrato de classes e markdown seguro", () => {
    const html = renderThread();
    expect(html).toContain("message-user");
    expect(html).toContain("message-assistant");
    expect(html).toContain("Pergunta do usuário");
    expect(html).toContain("<strong>Resposta</strong>");
    expect(html).toContain('data-state="entered"');
  });

  it("mensagem em streaming recebe cursor e status quando vazia", () => {
    const html = renderThread({
      streamingId: "stream-1",
      streamingStatus: "Gerando…",
      visibleMessages: [{ content: "", id: "stream-1", role: "assistant" }],
    });
    expect(html).toContain("message-streaming");
    expect(html).toContain("streaming-cursor");
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
});
