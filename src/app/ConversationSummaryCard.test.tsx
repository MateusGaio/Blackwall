// MIT License — Copyright (c) 2026 Mateus Gaio

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationSummaryCard } from "./ConversationSummaryCard";

describe("ConversationSummaryCard", () => {
  it("fica recolhido por padrão e localiza o rótulo", () => {
    const markup = renderToStaticMarkup(<ConversationSummaryCard content="# Resumo" />);
    expect(markup).toContain("Resumo automático da conversa");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<h1>Resumo</h1>");
  });

  it("renderiza o resumo expandido e a localização em inglês", () => {
    const markup = renderToStaticMarkup(
      <ConversationSummaryCard content="# Summary" defaultExpanded isEnglish />,
    );
    expect(markup).toContain("Automatic conversation summary");
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("<h1>Summary</h1>");
  });
});
