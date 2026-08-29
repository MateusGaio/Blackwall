// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../i18n";
import type { SessionSummary, Workspace } from "../../shared/api/sidecar";
import { SessionsSidebar } from "./SessionsSidebar";

const workspace = {
  id: "w1",
  name: "Projeto Alfa",
  permissionMode: "ask",
} as unknown as Workspace;

type Props = Parameters<typeof SessionsSidebar>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    activeProfile: undefined,
    activeSessionId: undefined,
    collapsed: false,
    cursorAvoidanceEnabled: false,
    hasActiveProfile: true,
    isCreatingSession: false,
    name: "Mateus",
    newSession: () => undefined,
    newWorkspace: () => undefined,
    onDeleteRequest: () => undefined,
    onRenameRequest: () => undefined,
    onTogglePalette: () => undefined,
    openSession: () => undefined,
    openWorkspace: () => undefined,
    recentSessions: [],
    recentSessionsRef: { current: null },
    settingsButtonRef: { current: null },
    openSettings: () => undefined,
    setCursorAvoidanceEnabled: () => undefined,
    workspace,
    workspaces: [workspace],
    ...overrides,
  };
}

beforeAll(async () => {
  await i18next.init();
});

describe("alinhamento do projeto na sidebar", () => {
  it("botão do projeto alinha o nome à esquerda", () => {
    // Causa confirmada do comentário 3: o estilo UA de <button> centraliza o
    // texto; sem text-left no próprio item interativo a herança do pai perde.
    const html = renderToStaticMarkup(<SessionsSidebar {...baseProps()} />);
    // Pega o botão cujo CONTEÚDO é o nome do projeto (não o toggle de chevron).
    const chunks = html.split(/(<button[\s\S]*?<\/button>)/g).filter(Boolean);
    for (const chunk of chunks) {
      if (!chunk.startsWith("<button")) continue;
      if (!/>Projeto Alfa</.test(chunk)) continue;
      expect(chunk).toContain("text-left");
      return;
    }
    throw new Error(`botão do projeto não encontrado no markup: ${html.slice(0, 400)}`);
  });

  it("mantém renomear e excluir como ações diretas da conversa", () => {
    const session = {
      createdAt: 1,
      id: "s1",
      profileId: "p1",
      selectedModel: null,
      selectedProviderId: null,
      title: "Nova conversa",
      updatedAt: 2,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    } as SessionSummary;
    const html = renderToStaticMarkup(
      <SessionsSidebar {...baseProps({ recentSessions: [session] })} />,
    );

    expect(html).toContain('aria-label="Renomear Nova conversa"');
    expect(html).toContain('aria-label="Excluir Nova conversa"');
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain("…");
  });

  it("abre configurações ao clicar em toda a linha do perfil", () => {
    const html = renderToStaticMarkup(<SessionsSidebar {...baseProps()} />);

    expect(html).toContain('aria-label="Abrir configurações"');
    expect(html).not.toContain('data-testid="settings-tabs"');
  });
});
