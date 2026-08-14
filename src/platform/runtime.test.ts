// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { browserFilesToFolderSelection } from "./runtime";

function workspaceFile(path: string, content: string) {
  const file = new File([content], path.split("/").at(-1) ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("seleção de workspace no navegador", () => {
  it("inclui documentação, código e testes e ignora dependências e builds", async () => {
    const selection = await browserFilesToFolderSelection([
      workspaceFile("project/README.md", "# Projeto"),
      workspaceFile("project/src/index.ts", "export const main = true"),
      workspaceFile("project/tests/index.test.ts", "test('main', () => {})"),
      workspaceFile("project/package.json", '{"name":"project"}'),
      workspaceFile("project/node_modules/pkg/index.js", "generated"),
      workspaceFile("project/dist/index.js", "generated"),
      workspaceFile("project/logo.png", "binary"),
    ]);

    expect(selection?.files.map((file) => file.relativePath)).toEqual([
      "README.md",
      "src/index.ts",
      "tests/index.test.ts",
      "package.json",
    ]);
  });
});
