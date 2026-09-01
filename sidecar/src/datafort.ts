// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { MAX_VAULT_FILE_SIZE } from "./vault.js";
import { contentHash, parseMarkdownObject, serializePortentMarkdown } from "./vault-portent.js";

const MAX_ENTRIES = 5_000;
const IGNORED_DIRECTORIES = new Set([
  ".blackwall",
  ".cache",
  ".git",
  ".obsidian",
  ".trash",
  ".venv",
  "__pycache__",
  "build",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "tmp",
]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

type DatafortExplorerScope = "knowledge" | "all";
type DatafortFileKind = "markdown" | "text" | "attachment" | "unknown";

const MAX_DATAFORT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_DATAFORT_ATTACHMENT_PREVIEW_BYTES = 25 * 1024 * 1024;
const DATAFORT_ATTACHMENT_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".svg",
  ".wav",
  ".webm",
  ".c",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".md",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

type DatafortSettings = {
  autoUpdateLinks: boolean;
  attachmentDirectory: string;
  dailyDirectory: string;
  dailyTemplatePath: string | null;
  explorerScope: DatafortExplorerScope;
  externalMarkdownWriteEnabled: boolean;
  layout: Record<string, unknown>;
  newNoteDirectory: string;
  templateDirectory: string;
};

type DatafortTreeEntry = {
  fileId?: string;
  kind: "directory" | "file" | "attachment";
  managed: boolean;
  name: string;
  path: string;
  size?: number;
  writable: boolean;
};

type DatafortDocument = {
  content: string;
  contentHash: string;
  fileId: string;
  managed: boolean;
  mtime: number;
  path: string;
  portentId?: string;
  writable: boolean;
};

type DatafortTrashEntry = {
  contentHash: string;
  deletedAt: number;
  entryId: string;
  fileId: string;
  managed: boolean;
  originalPath: string;
  portentId?: string;
};

type WorkspaceRow = { id: string; permissionMode: string; rootPath: string };

export class DatafortError extends Error {
  constructor(
    readonly code:
      | "datafort_workspace_not_found"
      | "datafort_path_invalid"
      | "datafort_path_outside_workspace"
      | "datafort_path_unsafe"
      | "datafort_not_found"
      | "datafort_not_writable"
      | "datafort_conflict"
      | "datafort_file_too_large"
      | "datafort_unsupported"
      | "datafort_already_exists"
      | "datafort_invalid_input"
      | "datafort_attachment_invalid"
      | "datafort_attachment_too_large",
    message: string,
    readonly details: { currentHash?: string } = {},
  ) {
    super(message);
    this.name = "DatafortError";
  }

  get status() {
    if (this.code === "datafort_workspace_not_found" || this.code === "datafort_not_found")
      return 404;
    if (this.code === "datafort_path_outside_workspace" || this.code === "datafort_path_unsafe")
      return 403;
    if (this.code === "datafort_conflict") return 409;
    if (this.code === "datafort_file_too_large") return 413;
    if (this.code === "datafort_attachment_too_large") return 413;
    if (this.code === "datafort_unsupported") return 415;
    if (this.code === "datafort_not_writable") return 403;
    if (this.code === "datafort_already_exists") return 409;
    return 400;
  }
}

function isMarkdown(path: string) {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLocaleLowerCase());
}

function fileKind(path: string): DatafortFileKind {
  const extension = extname(path).toLocaleLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (
    [
      ".c",
      ".cpp",
      ".css",
      ".csv",
      ".go",
      ".html",
      ".js",
      ".json",
      ".py",
      ".rb",
      ".rs",
      ".ts",
      ".tsx",
      ".txt",
      ".yaml",
      ".yml",
    ].includes(extension)
  )
    return "text";
  if (
    [
      ".gif",
      ".jpeg",
      ".jpg",
      ".m4a",
      ".mp3",
      ".mp4",
      ".pdf",
      ".png",
      ".svg",
      ".wav",
      ".webm",
    ].includes(extension)
  )
    return "attachment";
  return "unknown";
}

function attachmentMimeType(path: string) {
  const extension = extname(path).toLocaleLowerCase();
  const mimeTypes: Record<string, string> = {
    ".css": "text/css",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".m4a": "audio/mp4",
    ".md": "text/markdown",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
  };
  return mimeTypes[extension] ?? "application/octet-stream";
}

function pathFor(root: string, candidate: string) {
  return relative(root, candidate).split("\\").join("/") || ".";
}

function normalizeRelativePath(value: unknown, allowRoot = false, allowIgnored = false) {
  if (typeof value !== "string")
    throw new DatafortError("datafort_path_invalid", "O caminho informado é inválido.");
  const normalized = value.trim().replaceAll("\\", "/");
  if (allowRoot && (!normalized || normalized === ".")) return ".";
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new DatafortError(
      normalized.includes("..") ? "datafort_path_outside_workspace" : "datafort_path_invalid",
      "O caminho deve ser relativo ao workspace e não pode conter traversal.",
    );
  }
  if (
    !allowIgnored &&
    normalized.split("/").some((segment) => IGNORED_DIRECTORIES.has(segment.toLocaleLowerCase()))
  )
    throw new DatafortError("datafort_path_unsafe", "O caminho aponta para um diretório interno.");
  return normalized;
}

function assertContent(content: unknown) {
  if (typeof content !== "string")
    throw new DatafortError("datafort_invalid_input", "O conteúdo deve ser texto.");
  if (content.includes("\0"))
    throw new DatafortError("datafort_invalid_input", "O conteúdo contém um byte inválido.");
  if (Buffer.byteLength(content, "utf8") > MAX_VAULT_FILE_SIZE)
    throw new DatafortError("datafort_file_too_large", "O documento excede o limite de 2 MiB.");
  return content;
}

function assertHash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value))
    throw new DatafortError("datafort_invalid_input", "expectedHash deve ser um SHA-256.");
  return value.toLocaleLowerCase();
}

async function safeRoot(rootPath: string) {
  const root = await realpath(resolve(rootPath)).catch(() => null);
  const info = root ? await stat(root).catch(() => null) : null;
  if (!root || !info?.isDirectory())
    throw new DatafortError(
      "datafort_workspace_not_found",
      "A pasta do workspace não está disponível.",
    );
  return root;
}

async function safePath(
  root: string,
  requested: string,
  allowMissing = false,
  allowIgnored = false,
) {
  const normalized = normalizeRelativePath(requested, true, allowIgnored);
  if (normalized === ".") return root;
  const candidate = resolve(root, normalized);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath))
    throw new DatafortError("datafort_path_outside_workspace", "O caminho sai do workspace.");
  let current = root;
  const segments = normalized.split("/");
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      if (allowMissing && index === segments.length - 1) return candidate;
      throw new DatafortError("datafort_not_found", "O caminho solicitado não existe.");
    }
    if (info.isSymbolicLink())
      throw new DatafortError(
        "datafort_path_unsafe",
        "Links simbólicos não são aceitos no Datafort.",
      );
  }
  return candidate;
}

async function atomicWrite(root: string, path: string, content: string) {
  const target = await safePath(root, path, true);
  const parent = dirname(target);
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink())
    throw new DatafortError("datafort_path_unsafe", "A pasta de destino não é segura.");
  const temporary = join(parent, `.blackwall-datafort-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  });
}

async function atomicWriteBytes(root: string, path: string, bytes: Uint8Array) {
  const target = await safePath(root, path, true);
  const parent = dirname(target);
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink())
    throw new DatafortError("datafort_path_unsafe", "A pasta de destino não é segura.");
  const temporary = join(parent, `.blackwall-datafort-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  });
}

function attachmentInput(input: Record<string, unknown>) {
  const rawFilename = typeof input.filename === "string" ? input.filename.trim() : "";
  const filename = rawFilename ? basename(rawFilename) : "";
  const contentBase64 = typeof input.contentBase64 === "string" ? input.contentBase64 : "";
  if (
    !rawFilename ||
    rawFilename !== filename ||
    rawFilename.includes("/") ||
    rawFilename.includes("\\") ||
    !filename ||
    filename === "." ||
    filename === ".." ||
    !contentBase64 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64) ||
    contentBase64.length % 4 !== 0
  )
    throw new DatafortError("datafort_attachment_invalid", "O anexo informado é inválido.");
  const extension = extname(filename).toLocaleLowerCase();
  if (!DATAFORT_ATTACHMENT_EXTENSIONS.has(extension))
    throw new DatafortError(
      "datafort_unsupported",
      "Este tipo de arquivo não pode ser anexado ao workspace.",
    );
  const bytes = Buffer.from(contentBase64, "base64");
  if (!bytes.byteLength)
    throw new DatafortError("datafort_attachment_invalid", "O anexo está vazio.");
  if (bytes.byteLength > MAX_DATAFORT_ATTACHMENT_BYTES)
    throw new DatafortError("datafort_attachment_too_large", "O anexo excede o limite de 10 MiB.");
  return { bytes, filename };
}

async function ensureDirectory(root: string, path: string, allowIgnored = false) {
  const normalized = normalizeRelativePath(path, true, allowIgnored);
  if (normalized === ".") return root;
  const target = await safePath(root, normalized, true, allowIgnored).catch((error) => {
    if (!(error instanceof DatafortError) || error.code !== "datafort_not_found") throw error;
    return resolve(root, normalized);
  });
  let current = root;
  for (const segment of normalized.split("/")) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      await mkdir(current, { mode: 0o700 });
      continue;
    }
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new DatafortError("datafort_path_unsafe", "A pasta de destino não é segura.");
  }
  return target;
}

async function directoryHash(root: string, path: string) {
  const target = await safePath(root, path);
  const info = await stat(target);
  if (info.isFile())
    return createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
  if (!info.isDirectory())
    throw new DatafortError("datafort_unsupported", "O item não é um arquivo ou pasta.");
  const entries = await readdir(target, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) continue;
    const child = join(target, entry.name);
    const childInfo = await stat(child).catch(() => null);
    if (childInfo)
      parts.push(
        `${entry.name}\0${childInfo.isDirectory() ? "d" : "f"}\0${childInfo.size}\0${childInfo.mtimeMs}`,
      );
  }
  return contentHash(parts.join("\n"));
}

function settingsFromRow(row: Record<string, unknown>): DatafortSettings {
  let layout: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.layoutJson ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) layout = parsed;
  } catch {
    layout = {};
  }
  return {
    autoUpdateLinks: Boolean(row.autoUpdateLinks),
    attachmentDirectory: String(row.attachmentDirectory),
    dailyDirectory: String(row.dailyDirectory),
    dailyTemplatePath: row.dailyTemplatePath ? String(row.dailyTemplatePath) : null,
    explorerScope: row.explorerScope === "all" ? "all" : "knowledge",
    externalMarkdownWriteEnabled: Boolean(row.externalMarkdownWriteEnabled),
    layout,
    newNoteDirectory: String(row.newNoteDirectory),
    templateDirectory: String(row.templateDirectory),
  };
}

function journal(
  client: Database.Database,
  input: {
    expectedHash?: string | null;
    operation: string;
    sourcePath?: string | null;
    targetPath?: string | null;
    workspaceId: string;
  },
) {
  const now = Date.now();
  const operationId = randomUUID();
  client
    .prepare(
      `INSERT INTO datafort_write_journal
       (operation_id, workspace_id, operation, source_path, target_path, expected_hash, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
    )
    .run(
      operationId,
      input.workspaceId,
      input.operation,
      input.sourcePath ?? null,
      input.targetPath ?? null,
      input.expectedHash ?? null,
      now,
      now,
    );
  return operationId;
}

function journalState(
  client: Database.Database,
  operationId: string,
  state: "committed" | "aborted" | "conflict",
) {
  client
    .prepare("UPDATE datafort_write_journal SET state = ?, updated_at = ? WHERE operation_id = ?")
    .run(state, Date.now(), operationId);
}

function rewriteLinks(content: string, oldPath: string, nextPath: string) {
  const oldStem = oldPath.replace(/\.(md|markdown)$/i, "");
  const nextStem = nextPath.replace(/\.(md|markdown)$/i, "");
  const oldBasename = basename(oldStem);
  const nextBasename = basename(nextStem);
  let replacements = 0;
  const replaceTarget = (target: string) => {
    const clean = target.replaceAll("%20", " ");
    const isBasenameReference = clean === oldBasename;
    if (!isBasenameReference && clean !== oldPath && clean !== oldStem) return target;
    const replacement = isBasenameReference
      ? nextBasename
      : target.toLocaleLowerCase().endsWith(".md") ||
          target.toLocaleLowerCase().endsWith(".markdown")
        ? nextPath
        : nextStem;
    if (replacement !== target) replacements += 1;
    return replacement;
  };
  const lines = content.split(/(\r?\n)/);
  let fenced = false;
  const rewritten = lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced || /^\s*%%/.test(line)) return line;
      const placeholders: string[] = [];
      let next = line.replace(/%%[\s\S]*?%%/g, (comment) => {
        const marker = `__BW_COMMENT_${placeholders.length}__`;
        placeholders.push(comment);
        return marker;
      });
      next = next.replace(
        /(!?\[\[)([^\]|]+)(\|[^\]]+)?(\]\])/g,
        (_match, open, target, label, close) =>
          `${open}${replaceTarget(target)}${label ?? ""}${close}`,
      );
      next = next.replace(
        /(\]\()([^)#]+)(\))/g,
        (_match, open, target, close) => `${open}${replaceTarget(target)}${close}`,
      );
      return next.replace(
        /__BW_COMMENT_(\d+)__/g,
        (_match, index) => placeholders[Number(index)] ?? "",
      );
    })
    .join("");
  return { content: rewritten, replacements };
}

export class DatafortService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly client: Database.Database) {}

  private async workspace(workspaceId: string) {
    const row = this.client
      .prepare(
        "SELECT id, permission_mode AS permissionMode, root_path AS rootPath FROM workspaces WHERE id = ?",
      )
      .get(workspaceId) as WorkspaceRow | undefined;
    if (!row) throw new DatafortError("datafort_workspace_not_found", "O workspace não existe.");
    return { ...row, root: await safeRoot(row.rootPath) };
  }

  private async mutate<T>(workspaceId: string, task: () => Promise<T>) {
    const previous = this.locks.get(workspaceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.locks.set(workspaceId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(workspaceId) === current) this.locks.delete(workspaceId);
    }
  }

  private settingsRow(workspaceId: string) {
    const now = Date.now();
    this.client
      .prepare(
        "INSERT OR IGNORE INTO datafort_settings (workspace_id, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run(workspaceId, now, now);
    return this.client
      .prepare(
        `SELECT external_markdown_write_enabled AS externalMarkdownWriteEnabled,
          new_note_directory AS newNoteDirectory, attachment_directory AS attachmentDirectory,
          template_directory AS templateDirectory, daily_directory AS dailyDirectory,
          daily_template_path AS dailyTemplatePath, auto_update_links AS autoUpdateLinks,
          explorer_scope AS explorerScope, layout_json AS layoutJson
         FROM datafort_settings WHERE workspace_id = ?`,
      )
      .get(workspaceId) as Record<string, unknown>;
  }

  async getSettings(workspaceId: string) {
    await this.workspace(workspaceId);
    return settingsFromRow(this.settingsRow(workspaceId));
  }

  async patchSettings(workspaceId: string, input: Record<string, unknown>) {
    await this.workspace(workspaceId);
    const allowed = new Set([
      "autoUpdateLinks",
      "attachmentDirectory",
      "dailyDirectory",
      "dailyTemplatePath",
      "explorerScope",
      "externalMarkdownWriteEnabled",
      "layout",
      "newNoteDirectory",
      "templateDirectory",
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key)))
      throw new DatafortError(
        "datafort_invalid_input",
        "A configuração contém campos não permitidos.",
      );
    const current = this.settingsRow(workspaceId);
    const next = { ...settingsFromRow(current) };
    const stringFields = [
      "newNoteDirectory",
      "attachmentDirectory",
      "templateDirectory",
      "dailyDirectory",
    ] as const;
    for (const field of stringFields) {
      if (field in input) next[field] = normalizeRelativePath(input[field]);
    }
    if ("dailyTemplatePath" in input)
      next.dailyTemplatePath =
        input.dailyTemplatePath === null ? null : normalizeRelativePath(input.dailyTemplatePath);
    for (const field of ["externalMarkdownWriteEnabled", "autoUpdateLinks"] as const) {
      if (field in input && typeof input[field] !== "boolean")
        throw new DatafortError("datafort_invalid_input", `${field} deve ser booleano.`);
      if (field in input) next[field] = input[field] as boolean;
    }
    if (
      "explorerScope" in input &&
      input.explorerScope !== "knowledge" &&
      input.explorerScope !== "all"
    )
      throw new DatafortError("datafort_invalid_input", "explorerScope inválido.");
    if ("explorerScope" in input) next.explorerScope = input.explorerScope as DatafortExplorerScope;
    if ("layout" in input) {
      if (!input.layout || typeof input.layout !== "object" || Array.isArray(input.layout))
        throw new DatafortError("datafort_invalid_input", "layout deve ser um objeto.");
      next.layout = input.layout as Record<string, unknown>;
    }
    const now = Date.now();
    this.client
      .prepare(
        `UPDATE datafort_settings SET external_markdown_write_enabled = ?, new_note_directory = ?,
          attachment_directory = ?, template_directory = ?, daily_directory = ?, daily_template_path = ?,
          auto_update_links = ?, explorer_scope = ?, layout_json = ?, updated_at = ? WHERE workspace_id = ?`,
      )
      .run(
        next.externalMarkdownWriteEnabled ? 1 : 0,
        next.newNoteDirectory,
        next.attachmentDirectory,
        next.templateDirectory,
        next.dailyDirectory,
        next.dailyTemplatePath,
        next.autoUpdateLinks ? 1 : 0,
        next.explorerScope,
        JSON.stringify(next.layout),
        now,
        workspaceId,
      );
    return next;
  }

  private async identity(workspaceId: string, path: string, managed: boolean, portentId?: string) {
    const existing = this.client
      .prepare(
        "SELECT file_id AS fileId FROM datafort_file_identities WHERE workspace_id = ? AND path = ?",
      )
      .get(workspaceId, path) as { fileId: string } | undefined;
    const byPortent = portentId
      ? (this.client
          .prepare(
            "SELECT file_id AS fileId FROM datafort_file_identities WHERE workspace_id = ? AND portent_id = ?",
          )
          .get(workspaceId, portentId) as { fileId: string } | undefined)
      : undefined;
    const fileId = existing?.fileId ?? byPortent?.fileId ?? randomUUID();
    const now = Date.now();
    this.client
      .prepare(
        `INSERT INTO datafort_file_identities (file_id, workspace_id, path, managed, portent_id, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_id) DO UPDATE SET path = excluded.path, managed = excluded.managed,
           portent_id = excluded.portent_id, last_seen_at = excluded.last_seen_at`,
      )
      .run(fileId, workspaceId, path, managed ? 1 : 0, portentId ?? null, now);
    return fileId;
  }

  private async documentAt(
    workspaceId: string,
    root: string,
    path: string,
    settings: DatafortSettings,
  ): Promise<DatafortDocument> {
    const target = await safePath(root, path);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw new DatafortError("datafort_not_found", "O documento não existe.");
    if (!isMarkdown(path))
      throw new DatafortError(
        "datafort_unsupported",
        "Somente Markdown pode ser aberto no editor.",
      );
    if (info.size > MAX_VAULT_FILE_SIZE)
      throw new DatafortError("datafort_file_too_large", "O documento excede o limite de 2 MiB.");
    const content = (await readFile(target)).toString("utf8");
    if (content.includes("\0"))
      throw new DatafortError("datafort_unsupported", "O documento parece binário.");
    const parsed = parseMarkdownObject(content, path);
    return {
      content,
      contentHash: contentHash(content),
      fileId: await this.identity(workspaceId, path, parsed.managed, parsed.object.id),
      managed: parsed.managed,
      mtime: info.mtimeMs,
      path,
      ...(parsed.object.id ? { portentId: parsed.object.id } : {}),
      writable: parsed.managed || settings.externalMarkdownWriteEnabled,
    };
  }

  async tree(workspaceId: string) {
    const { root } = await this.workspace(workspaceId);
    const settings = settingsFromRow(this.settingsRow(workspaceId));
    const entries: DatafortTreeEntry[] = [];
    let visited = 0;
    let limited = false;
    const walk = async (directory: string) => {
      if (limited) return;
      const children = await readdir(directory, { withFileTypes: true });
      for (const entry of children.sort(
        (left, right) =>
          Number(right.isDirectory()) - Number(left.isDirectory()) ||
          left.name.localeCompare(right.name),
      )) {
        if (limited || entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase()))
          continue;
        visited += 1;
        if (visited > MAX_ENTRIES) {
          limited = true;
          break;
        }
        const absolute = join(directory, entry.name);
        const path = pathFor(root, absolute);
        if (entry.isDirectory()) {
          entries.push({
            kind: "directory",
            managed: false,
            name: entry.name,
            path,
            writable: false,
          });
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const kind = fileKind(path);
        const inAttachmentDirectory =
          path === settings.attachmentDirectory ||
          path.startsWith(`${settings.attachmentDirectory}/`);
        if (settings.explorerScope === "knowledge" && kind !== "markdown" && !inAttachmentDirectory)
          continue;
        if (kind === "unknown" && settings.explorerScope !== "all") continue;
        let managed = false;
        let portentId: string | undefined;
        if (kind === "markdown") {
          const preview = await readFile(absolute)
            .then((bytes) =>
              bytes.byteLength <= MAX_VAULT_FILE_SIZE
                ? parseMarkdownObject(bytes.toString("utf8"), path)
                : null,
            )
            .catch(() => null);
          managed = Boolean(preview?.managed);
          portentId = preview?.object.id;
        }
        const fileId = await this.identity(workspaceId, path, managed, portentId);
        entries.push({
          fileId,
          kind: kind === "attachment" || inAttachmentDirectory ? "attachment" : "file",
          managed,
          name: entry.name,
          path,
          size: (await stat(absolute)).size,
          writable: kind === "markdown" && (managed || settings.externalMarkdownWriteEnabled),
        });
      }
    };
    await walk(root);
    return { entries, limited, settings };
  }

  async documents(workspaceId: string, requestedPath?: string) {
    const { root } = await this.workspace(workspaceId);
    const settings = settingsFromRow(this.settingsRow(workspaceId));
    const path = requestedPath ? normalizeRelativePath(requestedPath, true) : ".";
    const target = await safePath(root, path);
    const info = await stat(target);
    const paths: string[] = [];
    if (info.isFile()) paths.push(path);
    else {
      const tree = await this.tree(workspaceId);
      paths.push(
        ...tree.entries
          .filter(
            (entry) =>
              entry.kind === "file" &&
              isMarkdown(entry.path) &&
              (path === "." || entry.path === path || entry.path.startsWith(`${path}/`)),
          )
          .map((entry) => entry.path),
      );
    }
    const documents: DatafortDocument[] = [];
    for (const documentPath of paths)
      documents.push(await this.documentAt(workspaceId, root, documentPath, settings));
    return { documents };
  }

  async attachFile(workspaceId: string, input: Record<string, unknown>) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const settings = settingsFromRow(this.settingsRow(workspaceId));
      const { bytes, filename } = attachmentInput(input);
      await ensureDirectory(workspace.root, settings.attachmentDirectory);
      const extension = extname(filename);
      const stem = filename.slice(0, filename.length - extension.length);
      let path = `${settings.attachmentDirectory}/${filename}`;
      let suffix = 1;
      while (await lstat(await safePath(workspace.root, path, true)).catch(() => null)) {
        path = `${settings.attachmentDirectory}/${stem} (${suffix})${extension}`;
        suffix += 1;
        if (suffix > 10_000)
          throw new DatafortError(
            "datafort_already_exists",
            "Não foi possível encontrar um nome livre para o anexo.",
          );
      }
      const operationId = journal(this.client, {
        operation: "attach",
        targetPath: path,
        workspaceId,
      });
      try {
        await atomicWriteBytes(workspace.root, path, bytes);
        journalState(this.client, operationId, "committed");
      } catch (error) {
        journalState(this.client, operationId, "aborted");
        throw error;
      }
      const fileId = await this.identity(workspaceId, path, false);
      const contentHashValue = createHash("sha256").update(bytes).digest("hex");
      return {
        attachment: {
          byteSize: bytes.byteLength,
          contentHash: contentHashValue,
          fileId,
          filename: basename(path),
          kind: "attachment" as const,
          mimeType: attachmentMimeType(path),
          path,
        },
      };
    });
  }

  async readAttachment(workspaceId: string, requestedPath: string) {
    const workspace = await this.workspace(workspaceId);
    const settings = settingsFromRow(this.settingsRow(workspaceId));
    const path = normalizeRelativePath(requestedPath);
    if (
      path !== settings.attachmentDirectory &&
      !path.startsWith(`${settings.attachmentDirectory}/`)
    )
      throw new DatafortError(
        "datafort_path_unsafe",
        "O preview só pode acessar arquivos da pasta de anexos.",
      );
    const target = await safePath(workspace.root, path);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw new DatafortError("datafort_not_found", "O anexo não existe.");
    if (info.size > MAX_DATAFORT_ATTACHMENT_PREVIEW_BYTES)
      throw new DatafortError(
        "datafort_attachment_too_large",
        "O anexo excede o limite de preview.",
      );
    const bytes = await readFile(target);
    return {
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      contentType: attachmentMimeType(path),
      path,
      size: bytes.byteLength,
    };
  }

  async createDocument(workspaceId: string, input: Record<string, unknown>) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const settings = settingsFromRow(this.settingsRow(workspaceId));
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title || title.length > 240)
        throw new DatafortError(
          "datafort_invalid_input",
          "O título é obrigatório e deve ser curto.",
        );
      const directory = normalizeRelativePath(input.directory ?? settings.newNoteDirectory);
      const safeName = title
        .replace(/[\\/:*?"<>|\0]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      const requested =
        input.path === undefined
          ? `${directory}/${safeName}.md`
          : normalizeRelativePath(input.path);
      if (!isMarkdown(requested))
        throw new DatafortError("datafort_unsupported", "Novos documentos usam Markdown.");
      await ensureDirectory(workspace.root, dirname(requested) === "." ? "." : dirname(requested));
      const target = await safePath(workspace.root, requested, true);
      if (await lstat(target).catch(() => null))
        throw new DatafortError("datafort_already_exists", "Já existe um documento nesse caminho.");
      const portentId = `portent_${randomUUID().replaceAll("-", "")}`;
      const now = new Date().toISOString();
      const body =
        typeof input.content === "string" ? assertContent(input.content) : `# ${title}\n\n`;
      const content = serializePortentMarkdown(
        {
          created_at: now,
          id: portentId,
          source: "blackwall",
          source_kind: "user",
          status: "captured",
          title,
          type: "Note",
          updated_at: now,
        },
        body,
      );
      const operationId = journal(this.client, {
        operation: "create",
        sourcePath: requested,
        workspaceId,
      });
      try {
        await atomicWrite(workspace.root, requested, content);
        journalState(this.client, operationId, "committed");
      } catch (error) {
        journalState(this.client, operationId, "aborted");
        throw error;
      }
      await this.identity(workspaceId, requested, true, portentId);
      return this.documentAt(workspaceId, workspace.root, requested, settings);
    });
  }

  async updateDocument(workspaceId: string, input: Record<string, unknown>) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const settings = settingsFromRow(this.settingsRow(workspaceId));
      const expectedHash = assertHash(input.expectedHash);
      const identityRow =
        typeof input.fileId === "string"
          ? (this.client
              .prepare(
                "SELECT path FROM datafort_file_identities WHERE workspace_id = ? AND file_id = ?",
              )
              .get(workspaceId, input.fileId) as { path: string } | undefined)
          : undefined;
      const path = normalizeRelativePath(identityRow?.path ?? input.path);
      const current = await this.documentAt(workspaceId, workspace.root, path, settings);
      if (!current.writable)
        throw new DatafortError(
          "datafort_not_writable",
          "Markdown externo está somente leitura neste workspace.",
        );
      if (current.contentHash !== expectedHash)
        throw new DatafortError(
          "datafort_conflict",
          "O arquivo mudou no disco; o rascunho foi preservado.",
          { currentHash: current.contentHash },
        );
      const content = assertContent(input.content);
      const operationId = journal(this.client, {
        expectedHash,
        operation: "update",
        sourcePath: path,
        workspaceId,
      });
      try {
        await atomicWrite(workspace.root, path, content);
        journalState(this.client, operationId, "committed");
      } catch (error) {
        journalState(this.client, operationId, "aborted");
        throw error;
      }
      const parsed = parseMarkdownObject(content, path);
      await this.identity(workspaceId, path, parsed.managed, parsed.object.id);
      return this.documentAt(workspaceId, workspace.root, path, settings);
    });
  }

  async moveEntry(workspaceId: string, input: Record<string, unknown>) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const sourcePath = normalizeRelativePath(input.sourcePath);
      const targetPath = normalizeRelativePath(input.targetPath);
      const expectedHash = assertHash(input.expectedHash);
      const source = await safePath(workspace.root, sourcePath);
      const actualHash = await directoryHash(workspace.root, sourcePath);
      if (actualHash !== expectedHash)
        throw new DatafortError(
          "datafort_conflict",
          "A origem mudou no disco; a movimentação foi cancelada.",
          { currentHash: actualHash },
        );
      await ensureDirectory(
        workspace.root,
        dirname(targetPath) === "." ? "." : dirname(targetPath),
      );
      const target = await safePath(workspace.root, targetPath, true);
      if (await lstat(target).catch(() => null))
        throw new DatafortError("datafort_already_exists", "Já existe um item no destino.");
      const operationId = journal(this.client, {
        expectedHash,
        operation: "move",
        sourcePath,
        targetPath,
        workspaceId,
      });
      const settings = settingsFromRow(this.settingsRow(workspaceId));
      const rewrites = new Map<string, { before: string; after: string; links: number }>();
      const oldPrefix = sourcePath;
      const newPrefix = targetPath;
      const identityRows = this.client
        .prepare(
          "SELECT file_id AS fileId, path FROM datafort_file_identities WHERE workspace_id = ? AND (path = ? OR path LIKE ?)",
        )
        .all(workspaceId, sourcePath, `${sourcePath}/%`) as Array<{ fileId: string; path: string }>;
      try {
        await rename(source, target);
        for (const row of identityRows)
          this.client
            .prepare(
              "UPDATE datafort_file_identities SET path = ?, last_seen_at = ? WHERE file_id = ?",
            )
            .run(
              row.path === sourcePath
                ? targetPath
                : `${targetPath}/${row.path.slice(sourcePath.length + 1)}`,
              Date.now(),
              row.fileId,
            );
        if (settings.autoUpdateLinks) {
          const tree = await this.tree(workspaceId);
          for (const entry of tree.entries.filter(
            (candidate) => candidate.kind === "file" && isMarkdown(candidate.path),
          )) {
            const filePath = entry.path;
            const absolute = await safePath(workspace.root, filePath);
            const before = (await readFile(absolute)).toString("utf8");
            const rewritten = rewriteLinks(before, oldPrefix, newPrefix);
            const after = rewritten.content;
            if (before !== after) {
              rewrites.set(filePath, {
                after,
                before,
                links: rewritten.replacements,
              });
              await atomicWrite(workspace.root, filePath, after);
            }
          }
        }
        journalState(this.client, operationId, "committed");
      } catch (error) {
        for (const [filePath, rewrite] of rewrites)
          await atomicWrite(workspace.root, filePath, rewrite.before).catch(() => undefined);
        await rename(target, source).catch(() => undefined);
        for (const row of identityRows)
          this.client
            .prepare(
              "UPDATE datafort_file_identities SET path = ?, last_seen_at = ? WHERE file_id = ?",
            )
            .run(row.path, Date.now(), row.fileId);
        journalState(this.client, operationId, "aborted");
        throw error;
      }
      return {
        linksUpdated: [...rewrites.values()].reduce(
          (total, item) => total + Math.max(0, item.links),
          0,
        ),
        sourcePath,
        targetPath,
        filesUpdated: rewrites.size,
      };
    });
  }

  async deleteEntry(workspaceId: string, input: Record<string, unknown>) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const path = normalizeRelativePath(input.path);
      const expectedHash = assertHash(input.expectedHash);
      const target = await safePath(workspace.root, path);
      const actualHash = await directoryHash(workspace.root, path);
      if (actualHash !== expectedHash)
        throw new DatafortError(
          "datafort_conflict",
          "O item mudou no disco; a exclusão foi cancelada.",
          { currentHash: actualHash },
        );
      const identity = this.client
        .prepare(
          "SELECT file_id AS fileId, managed, portent_id AS portentId FROM datafort_file_identities WHERE workspace_id = ? AND path = ?",
        )
        .get(workspaceId, path) as
        | { fileId: string; managed: number; portentId: string | null }
        | undefined;
      const fileId = identity?.fileId ?? (await this.identity(workspaceId, path, false));
      const entryId = randomUUID();
      const trashPath = `.trash/${entryId}/${basename(path)}`;
      await ensureDirectory(workspace.root, `.trash/${entryId}`, true);
      const operationId = journal(this.client, {
        expectedHash,
        operation: "trash",
        sourcePath: path,
        targetPath: trashPath,
        workspaceId,
      });
      try {
        await rename(target, await safePath(workspace.root, trashPath, true, true));
        const now = Date.now();
        const transaction = this.client.transaction(() => {
          this.client
            .prepare(
              "UPDATE datafort_file_identities SET path = ?, last_seen_at = ? WHERE file_id = ?",
            )
            .run(trashPath, now, fileId);
          this.client
            .prepare(
              "INSERT INTO datafort_trash_entries (entry_id, workspace_id, file_id, original_path, trash_path, content_hash, managed, portent_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              entryId,
              workspaceId,
              fileId,
              path,
              trashPath,
              actualHash,
              identity?.managed ?? 0,
              identity?.portentId ?? null,
              now,
            );
        });
        transaction();
        journalState(this.client, operationId, "committed");
      } catch (error) {
        journalState(this.client, operationId, "aborted");
        throw error;
      }
      return { entryId, path };
    });
  }

  async listTrash(workspaceId: string) {
    await this.workspace(workspaceId);
    const rows = this.client
      .prepare(
        "SELECT content_hash AS contentHash, deleted_at AS deletedAt, entry_id AS entryId, file_id AS fileId, managed, original_path AS originalPath, portent_id AS portentId FROM datafort_trash_entries WHERE workspace_id = ? ORDER BY deleted_at DESC",
      )
      .all(workspaceId) as Array<
      Omit<DatafortTrashEntry, "managed" | "portentId"> & {
        managed: number;
        portentId: string | null;
      }
    >;
    return {
      entries: rows.map((item) => ({
        ...item,
        managed: Boolean(item.managed),
        ...(item.portentId ? { portentId: item.portentId } : {}),
      })),
    };
  }

  async restoreTrash(workspaceId: string, entryId: string, input: Record<string, unknown> = {}) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const entry = this.client
        .prepare(
          "SELECT entry_id AS entryId, file_id AS fileId, original_path AS originalPath, trash_path AS trashPath FROM datafort_trash_entries WHERE workspace_id = ? AND entry_id = ?",
        )
        .get(workspaceId, entryId) as
        | { entryId: string; fileId: string; originalPath: string; trashPath: string }
        | undefined;
      if (!entry) throw new DatafortError("datafort_not_found", "O item da lixeira não existe.");
      const destination = normalizeRelativePath(input.path ?? entry.originalPath);
      await ensureDirectory(
        workspace.root,
        dirname(destination) === "." ? "." : dirname(destination),
      );
      const target = await safePath(workspace.root, destination, true);
      if (await lstat(target).catch(() => null))
        throw new DatafortError(
          "datafort_already_exists",
          "O destino já existe; escolha outro local.",
        );
      await rename(await safePath(workspace.root, entry.trashPath, false, true), target);
      const transaction = this.client.transaction(() => {
        this.client
          .prepare(
            "UPDATE datafort_file_identities SET path = ?, last_seen_at = ? WHERE file_id = ?",
          )
          .run(destination, Date.now(), entry.fileId);
        this.client
          .prepare("DELETE FROM datafort_trash_entries WHERE entry_id = ?")
          .run(entry.entryId);
      });
      transaction();
      return { path: destination, restored: true };
    });
  }

  async permanentlyDeleteTrash(workspaceId: string, entryId: string) {
    return this.mutate(workspaceId, async () => {
      const workspace = await this.workspace(workspaceId);
      if (workspace.permissionMode === "read-only")
        throw new DatafortError(
          "datafort_not_writable",
          "O workspace está em modo somente leitura.",
        );
      const entry = this.client
        .prepare(
          "SELECT trash_path AS trashPath FROM datafort_trash_entries WHERE workspace_id = ? AND entry_id = ?",
        )
        .get(workspaceId, entryId) as { trashPath: string } | undefined;
      if (!entry) throw new DatafortError("datafort_not_found", "O item da lixeira não existe.");
      await rm(await safePath(workspace.root, entry.trashPath, false, true), {
        force: true,
        recursive: true,
      });
      this.client
        .prepare("DELETE FROM datafort_trash_entries WHERE workspace_id = ? AND entry_id = ?")
        .run(workspaceId, entryId);
      return { deleted: true };
    });
  }

  async saveDraft(workspaceId: string, input: Record<string, unknown>) {
    const workspace = await this.workspace(workspaceId);
    const fileId = typeof input.fileId === "string" ? input.fileId : "";
    const path = normalizeRelativePath(input.path);
    const content = assertContent(input.content);
    if (!fileId) throw new DatafortError("datafort_invalid_input", "fileId é obrigatório.");
    await safePath(workspace.root, path);
    const now = Date.now();
    this.client
      .prepare(
        "INSERT INTO datafort_drafts (file_id, workspace_id, path, content, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET path = excluded.path, content = excluded.content, content_hash = excluded.content_hash, updated_at = excluded.updated_at",
      )
      .run(fileId, workspaceId, path, content, contentHash(content), now);
    return { contentHash: contentHash(content), fileId, path, updatedAt: now };
  }

  async getDraft(workspaceId: string, fileId: string) {
    await this.workspace(workspaceId);
    return (
      this.client
        .prepare(
          "SELECT content, content_hash AS contentHash, file_id AS fileId, path, updated_at AS updatedAt FROM datafort_drafts WHERE workspace_id = ? AND file_id = ?",
        )
        .get(workspaceId, fileId) ?? null
    );
  }

  async deleteDraft(workspaceId: string, fileId: string) {
    await this.workspace(workspaceId);
    this.client
      .prepare("DELETE FROM datafort_drafts WHERE workspace_id = ? AND file_id = ?")
      .run(workspaceId, fileId);
    return { deleted: true };
  }

  async metadata(workspaceId: string) {
    await this.workspace(workspaceId);
    const settings = settingsFromRow(this.settingsRow(workspaceId));
    const counts = this.client
      .prepare(
        "SELECT COUNT(*) AS total FROM datafort_file_identities WHERE workspace_id = ? AND path NOT LIKE '.trash/%'",
      )
      .get(workspaceId) as { total: number };
    const trash = this.client
      .prepare("SELECT COUNT(*) AS total FROM datafort_trash_entries WHERE workspace_id = ?")
      .get(workspaceId) as { total: number };
    return { documents: counts.total, settings, trash: trash.total };
  }

  async changeEvents(workspaceId: string, paths: string[], origin: "filesystem" | "datafort") {
    await this.workspace(workspaceId);
    const revision = String(Date.now());
    return paths.map((path) => {
      const row = this.client
        .prepare(
          "SELECT file_id AS fileId FROM datafort_file_identities WHERE workspace_id = ? AND path = ?",
        )
        .get(workspaceId, path) as { fileId: string } | undefined;
      return {
        fileId: row?.fileId ?? contentHash(`${workspaceId}\0${path}`).slice(0, 32),
        origin,
        revision,
        type: "datafort.document.changed" as const,
        workspaceId,
      };
    });
  }
}
