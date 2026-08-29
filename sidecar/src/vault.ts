// MIT License — Copyright (c) 2026 Mateus Gaio

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  type ParsedMarkdownObject,
  parseMarkdownObject,
  type RelationResolution,
  relationReferences,
  type VaultDiagnostic,
} from "./vault-portent.js";

type VaultFile = {
  content: string;
  headings: string[];
  managed: boolean;
  object: ParsedMarkdownObject["object"];
  path: string;
  title: string;
};

type VaultRelation = {
  kind: "belongs_to" | "related_to" | "body_link" | "markdown_link";
  resolution: RelationResolution;
  source: string;
  target?: string;
  targetRef: string;
};

type VaultGraph = {
  diagnostics: VaultDiagnostic[];
  edges: Array<{ label?: string; source: string; target: string }>;
  files: VaultFile[];
  nodes: Array<{ id: string; label: string; path: string }>;
  relations: VaultRelation[];
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
    const parsed = parseMarkdownObject(content, path);
    result.push({
      content,
      headings: markdownHeadings(parsed.body),
      managed: parsed.managed,
      object: parsed.object,
      path,
      title: parsed.object.title,
    });
  }
  return result;
}

function normalizeReference(reference: string) {
  return reference
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/^\.\//, "")
    .split("\\")
    .join("/");
}

function graphForFiles(files: VaultFile[], includeArchived: boolean): VaultGraph {
  const visibleFiles = includeArchived
    ? files
    : files.filter((file) => file.object.status !== "archived");
  const byPath = new Map(files.map((file) => [file.path, file]));
  const byId = new Map(
    files.filter((file) => file.object.id).map((file) => [file.object.id, file]),
  );
  const byStem = new Map(files.map((file) => [file.path.replace(/\.(md|markdown)$/i, ""), file]));
  const byBasename = new Map<string, VaultFile[]>();
  for (const file of files) {
    const key = basename(file.path, extname(file.path));
    byBasename.set(key, [...(byBasename.get(key) ?? []), file]);
  }
  const diagnostics: VaultDiagnostic[] = [];
  const relations: VaultRelation[] = [];
  const edges: VaultGraph["edges"] = [];
  const seenEdges = new Set<string>();

  const resolveReference = (targetRef: string) => {
    const normalized = normalizeReference(targetRef);
    const exactPath = byPath.get(normalized);
    const exactId = byId.get(normalized.replace(/^id:/, ""));
    const exactStem = byStem.get(normalized.replace(/\.(md|markdown)$/i, ""));
    if (exactId || exactPath || exactStem)
      return { resolution: "resolved" as const, target: exactId ?? exactPath ?? exactStem };
    const basenameMatches = byBasename.get(normalized.replace(/\.(md|markdown)$/i, "")) ?? [];
    if (basenameMatches.length === 1)
      return { resolution: "resolved" as const, target: basenameMatches[0] };
    if (basenameMatches.length > 1) return { resolution: "ambiguous" as const };
    return { resolution: "broken" as const };
  };

  for (const source of files) {
    for (const reference of relationReferences(parseMarkdownObject(source.content, source.path))) {
      const result = resolveReference(reference.targetRef);
      const relation: VaultRelation = {
        kind: reference.kind,
        resolution: result.resolution,
        source: source.path,
        target: result.target?.path,
        targetRef: reference.targetRef,
      };
      relations.push(relation);
      if (result.resolution !== "resolved") {
        const code = result.resolution === "ambiguous" ? "relation-ambiguous" : "relation-broken";
        const message =
          result.resolution === "ambiguous"
            ? "Referência ambígua; não foi conectada."
            : "Referência não encontrada.";
        diagnostics.push({ code, message, path: source.path, target: reference.targetRef });
      }
      if (!result.target || !visibleFiles.includes(source) || !visibleFiles.includes(result.target))
        continue;
      const edgeKey = `${source.path}\0${result.target.path}\0${reference.kind}`;
      if (source.path !== result.target.path && !seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        edges.push({ source: source.path, target: result.target.path });
      }
    }
  }

  const nodes = visibleFiles.map((file) => ({ id: file.path, label: file.title, path: file.path }));
  return { diagnostics, edges, files, nodes, relations };
}

export async function scanVault(rootPath: string, options?: { includeArchived?: boolean }) {
  const absoluteRoot = resolve(rootPath);
  const files = await collectMarkdown(absoluteRoot);
  return graphForFiles(files, options?.includeArchived ?? false);
}
