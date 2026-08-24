// MIT License — Copyright (c) 2026 Mateus Gaio
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

type VaultFile = {
  content: string;
  headings: string[];
  path: string;
  title: string;
};

type VaultGraph = {
  edges: Array<{ label?: string; source: string; target: string }>;
  files: VaultFile[];
  nodes: Array<{ id: string; label: string; path: string }>;
};

/**
 * Diretórios internos ignorados no scan: VCS, caches, ambientes virtuais,
 * dependências e artefatos de build. Nada de usuário (notas .md) vive aí.
 */
const ignoredDirectories = new Set([
  ".blackwall",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);
const maxFiles = 5000;
const maxFileSize = 2_000_000;

function markdownTitle(content: string, filePath: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || basename(filePath, extname(filePath));
}

function markdownHeadings(content: string) {
  return Array.from(content.matchAll(/^#{1,6}\s+(.+)$/gm), (match) => match[1].trim()).slice(
    0,
    100,
  );
}

async function collectMarkdown(rootPath: string, currentPath = rootPath, result: VaultFile[] = []) {
  if (result.length >= maxFiles) return result;
  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (result.length >= maxFiles) break;
    if (entry.isSymbolicLink()) continue;
    const entryPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collectMarkdown(rootPath, entryPath, result);
      continue;
    }
    if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
    const info = await stat(entryPath).catch(() => null);
    if (!info || info.size > maxFileSize) continue;
    const content = await readFile(entryPath, "utf8");
    const path = relative(rootPath, entryPath).split("\\").join("/");
    result.push({
      content,
      headings: markdownHeadings(content),
      path,
      title: markdownTitle(content, path),
    });
  }
  return result;
}

function graphForFiles(files: VaultFile[]): VaultGraph {
  const nodes = files.map((file) => ({ id: file.path, label: file.title, path: file.path }));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const byStem = new Map(files.map((file) => [file.path.replace(/\.(md|markdown)$/i, ""), file]));
  const byName = new Map(
    files.map((file) => [
      file.path
        .split("/")
        .at(-1)
        ?.replace(/\.(md|markdown)$/i, ""),
      file,
    ]),
  );
  const edges: VaultGraph["edges"] = [];
  for (const file of files) {
    const links = [
      ...Array.from(file.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g), (match) =>
        match[1].trim(),
      ),
      ...Array.from(file.content.matchAll(/\[[^\]]+\]\(([^)#]+\.(?:md|markdown))\)/gi), (match) =>
        match[1].trim(),
      ),
    ];
    for (const link of links) {
      const normalized = link.replace(/^\.\//, "").split("\\").join("/");
      const target =
        byPath.get(normalized) ??
        byStem.get(normalized.replace(/\.(md|markdown)$/i, "")) ??
        byName.get(normalized.replace(/\.(md|markdown)$/i, ""));
      if (target && target.path !== file.path)
        edges.push({ source: file.path, target: target.path });
    }
  }
  return { edges, files, nodes };
}

export async function scanVault(rootPath: string): Promise<VaultGraph> {
  const absoluteRoot = resolve(rootPath);
  return graphForFiles(await collectMarkdown(absoluteRoot));
}
