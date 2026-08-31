// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import { VaultNoteEditor } from "./VaultNoteEditor";

beforeAll(async () => {
  await i18next.init();
});

describe("VaultNoteEditor", () => {
  it("renderiza formulário seguro, relações e preview sem conteúdo HTML perigoso", () => {
    const html = renderToStaticMarkup(
      <VaultNoteEditor
        onClose={() => undefined}
        onExited={() => undefined}
        onSaved={() => undefined}
        portentId={null}
        relationOptions={[{ id: "project-1", title: "Projeto" }]}
        visible
        workspaceId="workspace-1"
      />,
    );
    expect(html).toContain("Editor seguro do Vault");
    expect(html).toContain("Conteúdo Markdown");
    expect(html).toContain("Pertence a");
    expect(html).toContain("Salvar nota");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });
});
