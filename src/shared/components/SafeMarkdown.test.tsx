// MIT License — Copyright (c) 2026 Mateus Gaio
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renderiza hierarquia Markdown e reserva a caixa apenas para código", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdown content={"# Título\n\nTexto **forte**.\n\n```ts\nconst answer = 42;\n```"} />,
    );

    expect(markup).toContain("<h1>Título</h1>");
    expect(markup).toContain("Texto <strong>forte</strong>.");
    expect(markup).toContain('class="code-block"');
    expect(markup).toContain("const answer = 42;");
  });

  it("não transforma uma nota local desconhecida em link externo", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdown
        content="[Nota ausente](missing.md)"
        currentPath="docs/index.md"
        files={[
          { content: "# Índice", headings: ["Índice"], path: "docs/index.md", title: "Índice" },
        ]}
        onLocalLink={() => undefined}
      />,
    );

    expect(markup).toContain('class="markdown-broken-link"');
    expect(markup).not.toContain('target="_blank"');
  });

  it("localiza ações do Markdown quando o perfil está em inglês", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdown
        content={"[Missing note](missing.md)\n\n```ts\nconst value = 1;\n```"}
        currentPath="index.md"
        files={[{ content: "# Index", headings: ["Index"], path: "index.md", title: "Index" }]}
        locale="en"
        onLocalLink={() => undefined}
      />,
    );

    expect(markup).toContain('title="Note not found in the Vault"');
    expect(markup).toContain(">Copy</button>");
  });
});
