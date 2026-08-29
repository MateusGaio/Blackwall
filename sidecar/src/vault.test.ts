// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanVault } from "./vault.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Vault Markdown", () => {
  it("lista notas e resolve links Wiki entre arquivos", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-vault-"));
    directories.push(root);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "inicio.md"), "# Início\n\n[[arquitetura]]", "utf8");
    await writeFile(join(root, "docs", "arquitetura.md"), "# Arquitetura", "utf8");
    await writeFile(join(root, "ignore.txt"), "não é Markdown", "utf8");

    const graph = await scanVault(root);
    expect(graph.files.map((file) => file.path)).toEqual(["docs/arquitetura.md", "docs/inicio.md"]);
    expect(graph.files.find((file) => file.path === "docs/inicio.md")?.title).toBe("Início");
    expect(graph.edges).toEqual([{ source: "docs/inicio.md", target: "docs/arquitetura.md" }]);
  });

  it("ignora diretórios internos de VCS, cache, ambiente virtual e build", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-vault-filter-"));
    directories.push(root);
    const ignored = [
      ".git",
      ".blackwall",
      ".venv",
      "venv",
      ".pytest_cache",
      ".mypy_cache",
      ".ruff_cache",
      ".tox",
      "__pycache__",
      "node_modules",
      "dist",
      "build",
      "out",
      "target",
      "coverage",
    ];
    for (const directory of ignored) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(
        join(root, directory, "nota-interna.md"),
        `# ${directory}\n\nNão deveria aparecer.`,
        "utf8",
      );
    }
    await mkdir(join(root, "notas"));
    await writeFile(join(root, "notas", "visivel.md"), "# Visível", "utf8");

    const graph = await scanVault(root);
    expect(graph.files.map((file) => file.path)).toEqual(["notas/visivel.md"]);
  });

  it("não conecta basename ambíguo e expõe o diagnóstico", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-vault-ambiguous-"));
    directories.push(root);
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    await writeFile(join(root, "a", "nota.md"), "# A", "utf8");
    await writeFile(join(root, "b", "nota.md"), "# B", "utf8");
    await writeFile(join(root, "indice.md"), "# Índice\n\n[[nota]]", "utf8");

    const graph = await scanVault(root);
    expect(graph.edges).toEqual([]);
    expect(graph.relations).toContainEqual({
      kind: "body_link",
      resolution: "ambiguous",
      source: "indice.md",
      targetRef: "nota",
    });
    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({ code: "relation-ambiguous", path: "indice.md" }),
    );
  });

  it("resolve primeiro por ID e oculta arquivados do grafo padrão", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-vault-portent-"));
    directories.push(root);
    await writeFile(
      join(root, "projeto.md"),
      "---\nid: project-1\ntitle: Projeto\ntype: Project\nstatus: organized\ncreated_at: 2026-08-26T12:00:00.000Z\nupdated_at: 2026-08-26T12:00:00.000Z\nsource: blackwall\n---\nProjeto",
      "utf8",
    );
    await writeFile(
      join(root, "nota.md"),
      "---\ntitle: Nota\ntype: Note\nstatus: archived\n---\n[[id:project-1]]",
      "utf8",
    );
    const graph = await scanVault(root);
    expect(graph.nodes.map((node) => node.path)).toEqual(["projeto.md"]);
    expect(graph.edges).toEqual([]);
    expect((await scanVault(root, { includeArchived: true })).edges).toEqual([
      { source: "nota.md", target: "projeto.md" },
    ]);
  });
});
