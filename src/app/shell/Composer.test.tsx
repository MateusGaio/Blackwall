// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../i18n";
import type { ConnectedProvider } from "../../shared/api/sidecar";
import { Composer } from "./Composer";

const provider = {
  id: "p1",
  name: "Mock provider",
  model: "mock-model",
} as unknown as ConnectedProvider;

type Props = Parameters<typeof Composer>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    activeProvider: provider,
    activeSessionId: "s1",
    changeModel: () => Promise.resolve(),
    changePermissionMode: () => undefined,
    composerRef: { current: null },
    draft: "",
    isSending: false,
    modelName: "Mock Model",
    models: [{ capabilities: [], id: "mock-model", name: "Mock Model" }],
    onAttachFile: () => undefined,
    onOpenUsage: () => undefined,
    onSubmit: () => undefined,
    permissionError: "",
    selectedModel: "mock-model",
    setDraft: () => undefined,
    stopGeneration: () => undefined,
    streamingStatus: "",
    usageSummary: null,
    workspace: undefined,
    ...overrides,
  };
}

beforeAll(async () => {
  await i18next.init();
});

describe("trigger do seletor de modelo", () => {
  it("exibe somente o modelo — sem nome do provedor e sem separador ›", () => {
    // Causa confirmada do comentário 6: o trigger renderizava
    // `provedor › modelo`. O provedor permanece interno (roteamento/filtro)
    // mas não pode aparecer no trigger nem no aria-label/title.
    const html = renderToStaticMarkup(<Composer {...baseProps()} />);
    const chipIndex = html.indexOf('data-testid="model-trigger"');
    expect(chipIndex).toBeGreaterThan(0);
    const buttonClose = html.indexOf("</button>", chipIndex);
    const trigger = html.slice(chipIndex, buttonClose);
    expect(trigger).not.toContain("Mock provider");
    expect(trigger).not.toContain("›");
    expect(trigger).toContain("Mock Model");
  });

  it("aria-label e title do trigger não repetem o provedor", () => {
    const html = renderToStaticMarkup(<Composer {...baseProps()} />);
    const chipIndex = html.indexOf('data-testid="model-trigger"');
    const tagEnd = html.indexOf(">", chipIndex);
    const openTag = html.slice(chipIndex, tagEnd);
    expect(openTag).not.toContain("Mock provider");
  });
});
