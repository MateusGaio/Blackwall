// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../../i18n";
import { VaultNoteIndex } from "./VaultNoteIndex";

beforeAll(async () => {
  await i18next.init();
});

describe("VaultNoteIndex", () => {
  it("expõe filtros, Inbox e ação de nova nota com skeleton inicial", () => {
    const html = renderToStaticMarkup(
      <VaultNoteIndex
        onNewNote={() => undefined}
        onOpenNote={() => undefined}
        onSelectPath={() => undefined}
        refreshKey={0}
        workspaceId="workspace-1"
      />,
    );
    expect(html).toContain("Notas gerenciadas");
    expect(html).toContain("Inbox");
    expect(html).toContain("Nova nota");
    expect(html).toContain("motion-skeleton");
  });
});
