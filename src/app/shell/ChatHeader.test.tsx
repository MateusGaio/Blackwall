// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../i18n";
import { ChatHeader } from "./ChatHeader";

const noop = () => undefined;

beforeAll(async () => {
  await i18next.init();
});

describe("controle único do Vault no topo (#218)", () => {
  const base = {
    onToggleSidebar: noop,
    onToggleVault: noop,
    sessionTitle: "Sessão",
    sidebarCollapsed: false,
    vaultBlocked: false,
  };

  it("exatamente UM controle global, com aria-controls/expanded e test id", () => {
    const html = renderToStaticMarkup(<ChatHeader {...base} vaultMode="expanded" />);
    expect(html.split('data-testid="vault-toggle"').length - 1).toBe(1);
    expect(html).toContain('aria-controls="bw-vault-panel"');
    expect(html).toContain('aria-expanded="true"');
    // Ícone herdado do antigo botão interno (painel dividido + chevron).
    expect(html).toContain("M4 5h16v14H4V5Zm5 0v14M15 9l-3 3 3 3");
  });

  it("rail espelha o chevron para indicar reabertura", () => {
    const html = renderToStaticMarkup(<ChatHeader {...base} vaultMode="rail" />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("-scale-x-100");
  });

  it("sem segundo botão de recolher dentro do painel (guarda de regressão)", () => {
    // A guarda real do VaultPanel vive no E2E; aqui garantimos que o header
    // não renderiza nenhum botão com o rótulo interno antigo.
    const html = renderToStaticMarkup(<ChatHeader {...base} vaultMode="expanded" />);
    expect(html).not.toContain("collapseVault");
  });
});
