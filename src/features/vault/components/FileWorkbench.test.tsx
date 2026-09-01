// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import { FileWorkbench } from "./FileWorkbench";

beforeAll(async () => {
  await i18next.init();
});

describe("FileWorkbench", () => {
  it("expõe busca, explorador, preview e o grupo de artefatos da sessão", () => {
    const html = renderToStaticMarkup(
      <FileWorkbench
        cursorAvoidanceEnabled={false}
        graph={{ edges: [], files: [], nodes: [] }}
        memory={{ fileListScrollTop: 0, noteScrollTop: 0, noteScrollTops: {} }}
        onMemoryChange={() => undefined}
        onSelectPath={() => undefined}
        refreshKey={0}
        selectedPath={null}
        sessionId="session-1"
        workspaceId="workspace-1"
      />,
    );
    expect(html).toContain("Arquivos do workspace");
    expect(html).toContain("Buscar arquivos e anexos");
    expect(html).toContain("Gerados pelo agente");
    expect(html).toContain("Preview do arquivo");
    expect(html).toContain('type="search"');
    expect(html).not.toContain("Nova nota");
    expect(html).not.toContain("Editar");
  });
});
