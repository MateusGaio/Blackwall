// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import "../../i18n";
import { ProfileChooser } from "./ProfileChooser";

const profiles = [
  { id: "p1", name: "Perfil Um", soul: "Soul um" },
  { id: "p2", name: "Perfil Dois", soul: "Soul dois" },
] as unknown as Parameters<typeof ProfileChooser>[0]["profiles"];

beforeAll(async () => {
  await i18next.init();
});

describe("exclusão de perfil na tela de seleção", () => {
  it("expõe botão de exclusão por perfil com rótulo acessível", () => {
    const html = renderToStaticMarkup(
      <ProfileChooser
        isSelecting={false}
        onCreate={() => undefined}
        onDelete={() => Promise.resolve()}
        onSelect={() => undefined}
        profiles={profiles}
      />,
    );
    expect(html).toContain("Perfil Um");
    expect(html).toContain("Excluir perfil: Perfil Um");
    expect(html).toContain("Excluir perfil: Perfil Dois");
    expect(html).not.toContain("Excluir Perfil Um?");
  });

  it("não oferece exclusão quando nenhum handler é fornecido", () => {
    const html = renderToStaticMarkup(
      <ProfileChooser
        isSelecting={false}
        onCreate={() => undefined}
        onSelect={() => undefined}
        profiles={profiles}
      />,
    );
    expect(html).not.toContain("Excluir perfil:");
  });

  it("não abre o diálogo de confirmação por padrão", () => {
    const html = renderToStaticMarkup(
      <ProfileChooser
        isSelecting={false}
        onCreate={() => undefined}
        onDelete={() => Promise.resolve()}
        onSelect={() => undefined}
        profiles={profiles}
      />,
    );
    expect(html).not.toContain("dialog");
  });
});
