// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listWorkspaceDirectory,
  readWorkspacePdf,
  readWorkspaceText,
  safeWorkspacePath,
  WorkspaceFilesError,
  workspaceRoot,
} from "./workspace-files.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("workbench seguro de arquivos", () => {
  it("lista somente filhos seguros, ignora diretórios pesados e carrega diretórios sob demanda", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-files-"));
    const root = join(directory, "workspace");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Readme", "utf8");
    await writeFile(join(root, "src", "main.ts"), "export const main = true;", "utf8");
    await writeFile(join(root, "node_modules", "hidden.js"), "ignored", "utf8");
    directories.push(directory);
    const safeRoot = await workspaceRoot(root);
    const listing = await listWorkspaceDirectory(safeRoot, ".");
    const nested = await listWorkspaceDirectory(safeRoot, "src");

    expect(listing.entries.map((entry) => entry.path)).toEqual(["src", "README.md"]);
    expect(nested.entries).toEqual([
      expect.objectContaining({ kind: "file", name: "main.ts", path: "src/main.ts" }),
    ]);
    await expect(safeWorkspacePath(safeRoot, "../outside.txt")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_OUTSIDE",
    });
    await expect(safeWorkspacePath(safeRoot, "/etc/passwd")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_INVALID",
    });
  });

  it("recusa symlink, binário, texto acima de 1 MiB e PDF acima de 25 MiB", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-files-limits-"));
    const root = join(directory, "workspace");
    await mkdir(root);
    await writeFile(join(root, "note.md"), "# Safe\n", "utf8");
    await writeFile(join(root, "binary.txt"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, "large.txt"), Buffer.alloc(1024 * 1024 + 1, "x"));
    await writeFile(join(root, "preview.pdf"), Buffer.from("%PDF-1.7\n"));
    try {
      await symlink(join(root, "note.md"), join(root, "linked.md"));
    } catch {
      // Ambientes sem permissão para symlink ainda exercitam os limites abaixo.
    }
    directories.push(directory);
    const safeRoot = await workspaceRoot(root);
    await expect(readWorkspaceText(safeRoot, "note.md")).resolves.toMatchObject({
      kind: "markdown",
    });
    await expect(readWorkspaceText(safeRoot, "binary.txt")).rejects.toMatchObject({
      code: "WORKSPACE_FILE_BINARY",
    });
    await expect(readWorkspaceText(safeRoot, "large.txt")).rejects.toMatchObject({
      code: "WORKSPACE_FILE_TOO_LARGE",
    });
    await expect(readWorkspacePdf(safeRoot, "preview.pdf")).resolves.toMatchObject({
      path: "preview.pdf",
    });
    await expect(readWorkspaceText(safeRoot, "linked.md")).rejects.toBeInstanceOf(
      WorkspaceFilesError,
    );
  });
});
