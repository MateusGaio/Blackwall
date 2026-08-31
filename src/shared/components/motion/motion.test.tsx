// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import { EnterExit } from "./EnterExit";
import { ProgressIndicator } from "./ProgressIndicator";
import { Skeleton } from "./Skeleton";

beforeAll(async () => {
  await i18next.init();
});

describe("EnterExit", () => {
  it("renderiza o conteúdo no estado entered quando show=true", () => {
    const html = renderToStaticMarkup(
      <EnterExit show>
        <p>Conteúdo animado</p>
      </EnterExit>,
    );
    expect(html).toContain("Conteúdo animado");
    expect(html).toContain('data-state="entered"');
    expect(html).toContain("opacity:1");
  });

  it("não renderiza nada quando show=false (ainda não montado)", () => {
    const html = renderToStaticMarkup(
      <EnterExit show={false}>
        <p>Conteúdo animado</p>
      </EnterExit>,
    );
    expect(html).toBe("");
  });

  it("usa os tokens --motion-* na transição", () => {
    const html = renderToStaticMarkup(
      <EnterExit show duration="slow">
        <p>x</p>
      </EnterExit>,
    );
    expect(html).toContain("var(--motion-slow)");
    expect(html).toContain("var(--ease-out-quart)");
  });

  it("permite uma abertura instantânea iniciada pelo teclado", () => {
    const html = renderToStaticMarkup(
      <EnterExit instant show>
        <p>x</p>
      </EnterExit>,
    );
    expect(html).toContain('data-state="entered"');
    expect(html).not.toContain("var(--motion-base)");
  });
});

describe("Skeleton", () => {
  it("expõe status acessível com rótulo padrão via t()", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Carregando…");
    expect(html).toContain('data-slot="skeleton"');
  });

  it("aceita rótulo explícito", () => {
    const html = renderToStaticMarkup(<Skeleton label="Buscando modelos…" />);
    expect(html).toContain("Buscando modelos…");
  });
});

describe("ProgressIndicator", () => {
  it("modo determinado posiciona o indicador conforme o valor", () => {
    const html = renderToStaticMarkup(<ProgressIndicator value={40} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("translateX(-60%)");
    expect(html).toContain("Progresso da operação");
  });

  it("modo indeterminado usa barra animada e aria-busy", () => {
    const html = renderToStaticMarkup(<ProgressIndicator />);
    expect(html).toContain("progress-indeterminate");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Processando…");
  });

  it("aceita rótulo explícito", () => {
    const html = renderToStaticMarkup(<ProgressIndicator value={80} label="Indexando Vault" />);
    expect(html).toContain("Indexando Vault");
  });
});
