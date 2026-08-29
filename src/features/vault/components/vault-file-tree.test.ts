// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { buildFileTree } from "./VaultPanel";

describe("árvore de arquivos do Vault", () => {
  it("aninha pastas, ordena pastas antes de arquivos e usa o título na nota", () => {
    const tree = buildFileTree([
      { path: "raiz.md", title: "Raiz" },
      { path: "03 - MLOps/Prompt Text/Gate.md", title: "Gate Prompt (Raw)" },
      { path: "03 - MLOps/Bug - Tax Assembly.md", title: "Bug - Tax Assembly" },
      { path: "01 - Core/Conceitos.md", title: "Conceitos" },
    ]);

    expect(tree.map((node) => node.name)).toEqual(["01 - Core", "03 - MLOps", "Raiz"]);

    const mlops = tree[1];
    if (mlops.kind !== "folder") throw new Error("esperava pasta 03 - MLOps");
    expect(mlops.children.map((node) => node.name)).toEqual(["Prompt Text", "Bug - Tax Assembly"]);

    const promptText = mlops.children[0];
    if (promptText.kind !== "folder") throw new Error("esperava pasta Prompt Text");
    expect(promptText.children).toEqual([
      { kind: "file", name: "Gate Prompt (Raw)", path: "03 - MLOps/Prompt Text/Gate.md" },
    ]);
  });

  it("agrupa arquivos soltos na mesma pasta sem duplicar nós", () => {
    const tree = buildFileTree([
      { path: "docs/a.md", title: "A" },
      { path: "docs/b.md", title: "B" },
    ]);
    expect(tree).toHaveLength(1);
    const docs = tree[0];
    if (docs.kind !== "folder") throw new Error("esperava pasta docs");
    expect(docs.children).toEqual([
      { kind: "file", name: "A", path: "docs/a.md" },
      { kind: "file", name: "B", path: "docs/b.md" },
    ]);
  });

  it("lida com profundidade profunda sem perder nenhum nível", () => {
    const deepPath = ["n1", "n2", "n3", "n4", "n5", "nota-profunda.md"].join("/");
    const tree = buildFileTree([
      { path: deepPath, title: "Profunda" },
      { path: "raiz.md", title: "Raiz" },
    ]);

    let nodes = tree;
    let depth = 0;
    while (nodes.length > 0 && nodes[0].kind === "folder") {
      const folder = nodes.find((node) => node.kind === "folder");
      if (folder?.kind !== "folder") break;
      expect(folder.name).toBe(`n${depth + 1}`);
      nodes = folder.children;
      depth += 1;
    }
    expect(depth).toBe(5);
    expect(nodes).toEqual([{ kind: "file", name: "Profunda", path: deepPath }]);
  });
});
