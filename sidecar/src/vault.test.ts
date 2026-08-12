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
});
