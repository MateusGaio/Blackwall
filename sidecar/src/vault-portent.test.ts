// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import {
  parseMarkdownObject,
  relationReferences,
  serializePortentMarkdown,
} from "./vault-portent.js";

describe("contrato Portent", () => {
  it("parseia objeto gerenciado sem transformar datas em tipos executáveis", () => {
    const parsed = parseMarkdownObject(
      `---\nid: bw_note\ntitle: Nota\ntype: Note\nstatus: organized\ncreated_at: 2026-08-26T12:00:00.000Z\nupdated_at: 2026-08-26T12:01:00.000Z\nsource: blackwall\nsource_kind: explicit\nrelated_to:\n  - '[[topics/local|Local]]'\n---\n\n# Nota\n\n[[outra-nota]]`,
      "notes/nota.md",
    );
    expect(parsed.managed).toBe(true);
    expect(parsed.object.typeSupport).toBe("builtin");
    expect(parsed.object.createdAt).toBe("2026-08-26T12:00:00.000Z");
    expect(relationReferences(parsed)).toEqual([
      { kind: "related_to", targetRef: "[[topics/local|Local]]" },
      { kind: "body_link", targetRef: "outra-nota" },
    ]);
  });

  it("preserva tipo externo e campos desconhecidos sem alegar suporte nativo", () => {
    const parsed = parseMarkdownObject(
      `---\nid: external-1\ntype: Person\ncustom_field:\n  nested: true\n---\nPessoa`,
      "people/alguem.md",
    );
    expect(parsed.managed).toBe(false);
    expect(parsed.object.typeSupport).toBe("external");
    expect(parsed.frontmatter.custom_field).toEqual({ nested: true });
    expect(serializePortentMarkdown(parsed.frontmatter, parsed.body)).toContain("custom_field:");
  });

  it("trata Markdown legado como não gerenciado", () => {
    const parsed = parseMarkdownObject("# Legado\n\nConteúdo", "legado.md");
    expect(parsed.managed).toBe(false);
    expect(parsed.object.typeSupport).toBe("unknown");
    expect(parsed.diagnostics).toEqual([]);
  });
});
