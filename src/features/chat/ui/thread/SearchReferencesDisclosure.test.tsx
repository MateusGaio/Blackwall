// MIT License — Copyright (c) 2026 Mateus Gaio

import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../../shared/api/sidecar";
import "../../../../i18n";
import {
  SearchReferencesDisclosure,
  searchReferencesFromToolMessages,
} from "./SearchReferencesDisclosure";

beforeAll(async () => {
  await i18next.init();
});

const vaultCitation = {
  chunkIndex: 0,
  contentHash: "hash-vault",
  excerpt: "Trecho verificado da nota.",
  objectId: "vault-1",
  path: "docs/nota.md",
  source: "vault",
  title: "Nota técnica",
} as const;

const attachmentCitation = {
  attachmentId: "attachment-1",
  chunkIndex: 2,
  contentHash: "hash-attachment",
  excerpt: "Trecho verificado do anexo.",
  filename: "contrato.txt",
  source: "attachment",
} as const;

function tool(content: unknown, id: string, toolName = "search_workspace"): ChatMessage {
  return { content: JSON.stringify(content), id, role: "tool", toolName };
}

describe("referências da busca no chat (#243)", () => {
  it("usa somente mensagens persistidas da busca, deduplica e preserva a ordem", () => {
    const references = searchReferencesFromToolMessages([
      tool({ results: [{ citation: vaultCitation }, { citation: vaultCitation }] }, "search-1"),
      tool(
        { results: [{ citation: attachmentCitation }, { citation: vaultCitation }] },
        "search-2",
      ),
      tool({ results: [{ citation: { ...vaultCitation, path: "/private/secret.md" } }] }, "bad"),
      tool({ results: [{ citation: vaultCitation }] }, "other", "read_file"),
    ]);
    expect(references).toEqual([vaultCitation, attachmentCitation]);
  });

  it("não cria referências depois de uma resposta sem search_workspace", () => {
    expect(
      searchReferencesFromToolMessages([
        { content: "resposta sem busca", id: "assistant-1", role: "assistant" },
        tool({ results: [{ citation: vaultCitation }] }, "not-search", "read_file"),
      ]),
    ).toEqual([]);
  });

  it("renderiza disclosure recolhido e carrega a transição de até 180 ms", () => {
    const html = renderToStaticMarkup(
      <SearchReferencesDisclosure
        steps={[tool({ results: [{ citation: vaultCitation }] }, "search-1")]}
      />,
    );
    expect(html).toContain('data-testid="search-references"');
    expect(html).toContain("Mostrar 1 referência");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).not.toContain(vaultCitation.excerpt);
  });
});
