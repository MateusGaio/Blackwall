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

  it("BLOQUEADO: sem aria-controls/aria-expanded, rótulo acessível mantido", () => {
    const html = renderToStaticMarkup(<ChatHeader {...base} vaultBlocked vaultMode="rail" />);
    const start = html.indexOf('data-testid="vault-toggle"');
    expect(start).toBeGreaterThan(0);
    // Escopo: apenas a tag do toggle do Vault (a sidebar usa aria-expanded).
    const openTag = html.slice(html.lastIndexOf("<button", start), html.indexOf(">", start) + 1);
    expect(openTag).not.toContain("aria-controls");
    expect(openTag).not.toContain("aria-expanded");
    expect(html.split('data-testid="vault-toggle"').length - 1).toBe(1);
    // Rótulo continua explicando a ação bloqueada.
    expect(html).toContain("Abrir painel do Vault");
    expect(html).toContain("opacity-50");
  });

  it("sem segundo botão de recolher dentro do painel (guarda de regressão)", () => {
    // A guarda real do VaultPanel vive no E2E; aqui garantimos que o header
    // não renderiza nenhum botão com o rótulo interno antigo.
    const html = renderToStaticMarkup(<ChatHeader {...base} vaultMode="expanded" />);
    expect(html).not.toContain("collapseVault");
  });
});
