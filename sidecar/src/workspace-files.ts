// MIT License — Copyright (c) 2026 Mateus Gaio

import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const MAX_WORKSPACE_ENTRIES = 5_000;
const MAX_TEXT_PREVIEW_BYTES = 1 * 1024 * 1024;
const MAX_PDF_PREVIEW_BYTES = 25 * 1024 * 1024;

const ignoredDirectoryNames = new Set([
  ".blackwall",
  ".cache",
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "tmp",
  "vendor",
  "venv",
]);

const textExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".markdown",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const textNames = new Set([
  "cargo.lock",
  "dockerfile",
  "license",
  "makefile",
  "package-lock.json",
  "pnpm-lock.yaml",
  "readme",
  "yarn.lock",
]);

type WorkspaceFileKind = "code" | "markdown" | "text";

export class WorkspaceFilesError extends Error {
  constructor(
    readonly code:
      | "WORKSPACE_ROOT_UNAVAILABLE"
      | "WORKSPACE_PATH_INVALID"
      | "WORKSPACE_PATH_OUTSIDE"
      | "WORKSPACE_PATH_SYMLINK"
      | "WORKSPACE_PATH_NOT_FOUND"
      | "WORKSPACE_NOT_DIRECTORY"
      | "WORKSPACE_NOT_FILE"
      | "WORKSPACE_FILE_UNSUPPORTED"
      | "WORKSPACE_FILE_TOO_LARGE"
      | "WORKSPACE_FILE_BINARY"
      | "WORKSPACE_PDF_INVALID"
      | "WORKSPACE_PDF_TOO_LARGE",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WorkspaceFilesError";
  }
}

function isInside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function hasWindowsAbsolutePrefix(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

function requestedSegments(requested: string) {
  return requested.replaceAll("\\", "/").split("/").filter(Boolean);
}

async function assertNoSymlinkPath(root: string, candidate: string, allowMissing: boolean) {
  const path = relative(root, candidate).split("\\").join("/");
  if (!path) return;
  let current = root;
  const segments = path.split("/").filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      if (allowMissing && index === segments.length - 1) return;
      throw new WorkspaceFilesError(
        "WORKSPACE_PATH_NOT_FOUND",
        "O caminho solicitado não existe no workspace.",
        404,
      );
    }
    if (info.isSymbolicLink()) {
      throw new WorkspaceFilesError(
        "WORKSPACE_PATH_SYMLINK",
        "Links simbólicos não podem ser acessados pelo workbench.",
        403,
      );
    }
  }
}

export async function workspaceRoot(rootPath: string) {
  const root = await realpath(resolve(rootPath)).catch(() => null);
  if (!root) {
    throw new WorkspaceFilesError(
      "WORKSPACE_ROOT_UNAVAILABLE",
      "A pasta do workspace não está disponível.",
      404,
    );
  }
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new WorkspaceFilesError(
      "WORKSPACE_ROOT_UNAVAILABLE",
      "A pasta do workspace não está disponível.",
      404,
    );
  }
  return root;
}

export async function safeWorkspacePath(root: string, requested: string, allowMissing = false) {
  const value = typeof requested === "string" ? requested.trim() : "";
  if (!value || isAbsolute(value) || hasWindowsAbsolutePrefix(value)) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PATH_INVALID",
      "Informe um caminho relativo dentro do workspace.",
      400,
    );
  }
  if (requestedSegments(value).some((segment) => segment === "..")) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PATH_OUTSIDE",
      "O caminho solicitado está fora da pasta do workspace.",
      403,
    );
  }
  const candidate = resolve(root, value);
  if (!isInside(root, candidate)) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PATH_OUTSIDE",
      "O caminho solicitado está fora da pasta do workspace.",
      403,
    );
  }
  await assertNoSymlinkPath(root, candidate, allowMissing);
  return candidate;
}

function relativeWorkspacePath(root: string, candidate: string) {
  return relative(root, candidate).split("\\").join("/") || ".";
}

function workspaceFileKind(path: string): WorkspaceFileKind | null {
  const name = path.split("/").at(-1)?.toLocaleLowerCase() ?? "";
  const extension = extname(name);
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (textExtensions.has(extension) || textNames.has(name)) return "code";
  if (name === "readme" || name === "license" || name === "makefile" || name === "dockerfile")
    return "text";
  return null;
}

export async function listWorkspaceDirectory(root: string, requestedPath: string) {
  const directory = await safeWorkspacePath(root, requestedPath || ".");
  const info = await stat(directory).catch(() => null);
  if (!info) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PATH_NOT_FOUND",
      "O diretório solicitado não existe no workspace.",
      404,
    );
  }
  if (!info.isDirectory()) {
    throw new WorkspaceFilesError(
      "WORKSPACE_NOT_DIRECTORY",
      "O caminho solicitado não é um diretório.",
      400,
    );
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const visible = entries
    .filter(
      (entry) =>
        !entry.isSymbolicLink() &&
        !(entry.isDirectory() && ignoredDirectoryNames.has(entry.name.toLocaleLowerCase())),
    )
    .sort((left, right) => {
      const kind = Number(right.isDirectory()) - Number(left.isDirectory());
      return kind || left.name.localeCompare(right.name);
    });
  const limited = visible.length > MAX_WORKSPACE_ENTRIES;
  const result = [];
  for (const entry of visible.slice(0, MAX_WORKSPACE_ENTRIES)) {
    const child = join(directory, entry.name);
    const childInfo = entry.isFile() ? await stat(child).catch(() => null) : null;
    result.push({
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      name: entry.name,
      path: relativeWorkspacePath(root, child),
      size: childInfo?.size ?? null,
    });
  }
  return {
    entries: result,
    limited,
    path: relativeWorkspacePath(root, directory),
  };
}

type WorkspaceInventoryEntry = {
  mtimeMs: number;
  path: string;
  size: number;
};

export async function inventoryWorkspace(root: string) {
  const entries = new Map<string, WorkspaceInventoryEntry>();
  let visitedEntries = 0;
  let limited = false;

  async function walk(directory: string) {
    if (limited) return;
    const children = await readdir(directory, { withFileTypes: true });
    for (const entry of children) {
      if (limited) return;
      if (entry.isSymbolicLink()) continue;
      visitedEntries += 1;
      if (visitedEntries > MAX_WORKSPACE_ENTRIES) {
        limited = true;
        return;
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name.toLocaleLowerCase()))
          await walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const child = join(directory, entry.name);
      const info = await stat(child).catch(() => null);
      if (!info?.isFile()) continue;
      entries.set(relativeWorkspacePath(root, child), {
        mtimeMs: info.mtimeMs,
        path: relativeWorkspacePath(root, child),
        size: info.size,
      });
    }
  }

  await walk(root);
  return { entries, limited };
}

export async function readWorkspaceText(root: string, requestedPath: string) {
  const path = await safeWorkspacePath(root, requestedPath);
  const info = await stat(path).catch(() => null);
  if (!info) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PATH_NOT_FOUND",
      "O arquivo solicitado não existe no workspace.",
      404,
    );
  }
  if (!info.isFile()) {
    throw new WorkspaceFilesError(
      "WORKSPACE_NOT_FILE",
      "O caminho solicitado não é um arquivo.",
      400,
    );
  }
  const kind = workspaceFileKind(relativeWorkspacePath(root, path));
  if (!kind) {
    throw new WorkspaceFilesError(
      "WORKSPACE_FILE_UNSUPPORTED",
      "Este tipo de arquivo não possui preview de texto.",
      415,
    );
  }
  if (info.size > MAX_TEXT_PREVIEW_BYTES) {
    throw new WorkspaceFilesError(
      "WORKSPACE_FILE_TOO_LARGE",
      "O arquivo excede o limite de preview de texto de 1 MiB.",
      413,
    );
  }
  const bytes = await readFile(path);
  if (bytes.includes(0)) {
    throw new WorkspaceFilesError(
      "WORKSPACE_FILE_BINARY",
      "O arquivo parece binário e não pode ser exibido com segurança.",
      415,
    );
  }
  return {
    content: bytes.toString("utf8"),
    kind,
    path: relativeWorkspacePath(root, path),
    size: bytes.byteLength,
  };
}

export async function readWorkspacePdf(root: string, requestedPath: string) {
  const path = await safeWorkspacePath(root, requestedPath);
  const info = await stat(path).catch(() => null);
  if (!info) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PATH_NOT_FOUND",
      "O arquivo solicitado não existe no workspace.",
      404,
    );
  }
  if (!info.isFile()) {
    throw new WorkspaceFilesError(
      "WORKSPACE_NOT_FILE",
      "O caminho solicitado não é um arquivo.",
      400,
    );
  }
  if (extname(path).toLocaleLowerCase() !== ".pdf") {
    throw new WorkspaceFilesError(
      "WORKSPACE_PDF_INVALID",
      "O arquivo selecionado não é um PDF.",
      415,
    );
  }
  if (info.size > MAX_PDF_PREVIEW_BYTES) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PDF_TOO_LARGE",
      "O PDF excede o limite de preview de 25 MiB.",
      413,
    );
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_PDF_PREVIEW_BYTES) {
    throw new WorkspaceFilesError(
      "WORKSPACE_PDF_TOO_LARGE",
      "O PDF excede o limite de preview de 25 MiB.",
      413,
    );
  }
  return { bytes, path: relativeWorkspacePath(root, path), size: bytes.byteLength };
}
