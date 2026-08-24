// MIT License — Copyright (c) 2026 Mateus Gaio
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactIcon } from "./CompactIcon";

describe("CompactIcon", () => {
  it("é autocontido: sem fill preto padrão e com tamanho definido", () => {
    // Sem esses atributos o SVG usa fill preto do navegador e some no tema
    // OLED (e sem dimensão renderiza 300×150). Guarda de regressão do fix.
    const html = renderToStaticMarkup(<CompactIcon kind="send" />);
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain("size-4");
  });
});
