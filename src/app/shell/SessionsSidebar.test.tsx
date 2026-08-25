// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../i18n";
import type { Workspace } from "../../shared/api/sidecar";
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
    hasActiveProfile: true,
    isCreatingSession: false,
    name: "Mateus",
    newSession: () => undefined,
    newWorkspace: () => undefined,
    onDeleteRequest: () => undefined,
    onRenameRequest: () => undefined,
    onRequestCloseMenu: () => undefined,
    onToggleSessionMenu: () => undefined,
    onTogglePalette: () => undefined,
    openSession: () => undefined,
    openSessionMenuId: null,
    openWorkspace: () => undefined,
    recentSessions: [],
    recentSessionsRef: { current: null },
    sessionMenuPosition: null,
    settingsButtonRef: { current: null },
    setShowSettings: () => undefined,
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
});
