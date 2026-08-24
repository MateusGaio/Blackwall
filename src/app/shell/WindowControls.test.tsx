// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import "../../i18n";
import { WindowControls } from "./WindowControls";

function stubDesktop(desktop: boolean) {
  (globalThis as { isTauri?: boolean }).isTauri = desktop;
}

afterEach(() => {
  delete (globalThis as { isTauri?: boolean }).isTauri;
});

beforeAll(async () => {
  await i18next.init();
});

describe("controles de janela frameless", () => {
  it("renderiza minimizar, maximizar e fechar em runtime desktop", () => {
    stubDesktop(true);
    const markup = renderToStaticMarkup(<WindowControls />);
    expect(markup).toContain("window-controls");
    for (const label of ["Minimizar", "Maximizar/Restaurar", "Fechar"]) {
      expect(markup).toContain(label);
    }
  });

  it("não renderiza nada fora do runtime desktop (web/e2e)", () => {
    stubDesktop(false);
    expect(renderToStaticMarkup(<WindowControls />)).toBe("");
  });
});
