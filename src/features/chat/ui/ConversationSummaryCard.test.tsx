// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import { ConversationSummaryCard } from "./ConversationSummaryCard";

describe("ConversationSummaryCard", () => {
  beforeAll(async () => {
    await i18next.init();
  });

  it("fica recolhido por padrão e localiza o rótulo", async () => {
    await i18next.changeLanguage("pt-BR");
    const markup = renderToStaticMarkup(<ConversationSummaryCard content="# Resumo" />);
    expect(markup).toContain("Resumo automático da conversa");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<h1>Resumo</h1>");
  });

  it("localiza o rótulo em inglês", async () => {
    await i18next.changeLanguage("en");
    const markup = renderToStaticMarkup(<ConversationSummaryCard content="# Summary" />);
    expect(markup).toContain("Automatic conversation summary");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<h1>Summary</h1>");
  });
});
