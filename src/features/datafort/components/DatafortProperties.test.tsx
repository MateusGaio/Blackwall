// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  type DatafortProperty,
  type DatafortPropertyType,
  parseDatafortProperties,
  updateDatafortProperty,
} from "./DatafortProperties";

describe("propriedades YAML do Datafort", () => {
  it("infere tipos e mantém propriedades internas somente leitura", () => {
    const properties: DatafortProperty[] = parseDatafortProperties(
      '---\nid: note-1\ntags: ["one", "two"]\npriority: 2\ndue: 2026-09-01\narchived: false\n---\n# Nota',
    );
    expect(properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "id", readonly: true, type: "text" }),
        expect.objectContaining({ key: "tags", type: "list", value: ["one", "two"] }),
        expect.objectContaining({ key: "priority", type: "number", value: 2 }),
        expect.objectContaining({ key: "due", type: "date" }),
        expect.objectContaining({ key: "archived", type: "checkbox", value: false }),
      ]),
    );
  });

  it("atualiza um campo sem remover campos desconhecidos", () => {
    const before = "---\nid: note-1\ncustom: preserve\npriority: 1\n---\n# Nota\n";
    const type: DatafortPropertyType = "number";
    const after = updateDatafortProperty(before, "priority", type, "3");
    expect(after).toContain("id: note-1");
    expect(after).toContain("custom: preserve");
    expect(after).toContain("priority: 3");
  });

  it("não altera conteúdo quando o frontmatter está ausente ou inválido", () => {
    const malformed = "---\ntitle: [sem fechamento\n---\n# Nota\n";
    expect(parseDatafortProperties(malformed)).toEqual([
      expect.objectContaining({ key: "title", type: "text" }),
    ]);
    expect(updateDatafortProperty("# Sem YAML\n", "title", "text", "Nova")).toBe("# Sem YAML\n");
  });
});
