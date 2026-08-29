// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionSummary } from "../../shared/api/sidecar";
import "../../i18n";
import { CommandSurface } from "./Dialogs";

const noop = () => undefined;

const sessions = [
  { id: "s1", title: "Sessão um" },
  { id: "s2", title: "Sessão dois" },
] as unknown as SessionSummary[];

beforeAll(async () => {
  await i18next.init();
});

describe("paleta de comandos", () => {
  it("superfície monta input e lista de comandos no mesmo componente", () => {
    // Causa confirmada do comentário 2: CommandInput e CommandList precisam
    // viver sob uma raiz <Command>; a superfície é o corpo extraível que a
    // paleta montada persistentemente renderiza dentro dela.
    const html = renderToStaticMarkup(
      <CommandSurface
        onClose={noop}
        onNewSession={noop}
        onOpenSession={noop}
        onOpenProviders={noop}
        onOpenSettings={noop}
        query=""
        recentSessions={sessions}
        setQuery={noop}
      />,
    );
    const inputIndex = html.indexOf('data-slot="command-input"');
    const listIndex = html.indexOf('data-slot="command-list"');
    expect(inputIndex).toBeGreaterThanOrEqual(0);
    expect(listIndex).toBeGreaterThan(inputIndex);
    expect(html).toContain("Abrir configurações");
    expect(html).toContain("Sessão um");
    expect(html).toContain("Sessão dois");
  });

  it("sem sessões recentes não renderiza o grupo de conversas", () => {
    const html = renderToStaticMarkup(
      <CommandSurface
        onClose={noop}
        onNewSession={noop}
        onOpenSession={noop}
        onOpenProviders={noop}
        onOpenSettings={noop}
        query=""
        recentSessions={[]}
        setQuery={noop}
      />,
    );
    expect(html).not.toContain("Conversas");
  });
});
