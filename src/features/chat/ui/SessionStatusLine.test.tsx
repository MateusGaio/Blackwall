// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import type { ConnectedProvider, UsageSummary } from "../../../shared/api/sidecar";
import { SessionStatusLine } from "./SessionStatusLine";

beforeAll(async () => {
  await i18next.init();
});

const provider: ConnectedProvider = {
  baseUrl: "",
  id: "p1",
  model: "mock-model",
  name: "Mock Provider",
  type: "openai-compatible",
};

function renderLine(summary: UsageSummary | null, props: Partial<Parameters<typeof SessionStatusLine>[0]> = {}) {
  return renderToStaticMarkup(
    <SessionStatusLine
      activeProvider={provider}
      modelName="mock-model"
      onOpenDetails={() => undefined}
      queuedCount={0}
      streamingStatus=""
      summary={summary}
      {...props}
    />,
  );
}

describe("SessionStatusLine", () => {
  it("mostra provedor›modelo e some sem provedor", () => {
    const html = renderLine(null);
    expect(html).toContain("Mock Provider › mock-model");
    expect(
      renderToStaticMarkup(
        <SessionStatusLine
          activeProvider={null}
          modelName="m"
          onOpenDetails={() => undefined}
          queuedCount={0}
          streamingStatus=""
          summary={null}
        />,
      ),
    ).not.toContain("data-testid=\"session-statusline\"");
  });

  it("contexto consumido sem denominador (UX_SPEC §6): tokens sem barra", () => {
    const html = renderLine({
      totals: { requests: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 1200 },
      lastRequest: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 1200 },
      windows: [],
      daily: [],
    });
    expect(html).toContain("ctx");
    expect(html).toContain("1.2");
    expect(html).not.toContain("[▓");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("contexto com limite mostra porcentagem, barra de blocos e usado/limite", () => {
    const html = renderLine({
      totals: { requests: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 68000 },
      lastRequest: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 68000, contextLimit: 200000 },
      windows: [],
      daily: [],
    });
    expect(html).toContain("34%");
    expect(html).toContain("[▓▓▓░░░░░░░]");
    expect(html).toContain("68K/200K");
  });

  it("janela mais restritiva do roteador e fila FIFO aparecem quando existem", () => {
    const html = renderLine(
      {
        totals: { requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
        windows: [
          { label: "dia", metric: "requests", remainingPercent: 80, source: "manual" },
          { label: "hora", metric: "requests", remainingPercent: 25, source: "provider" },
        ],
        daily: [],
      },
      { queuedCount: 2 },
    );
    expect(html).toContain("25%");
    expect(html).toContain("restante");
    expect(html).toContain("fila 2");
  });
});
