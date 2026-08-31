// MIT License — Copyright (c) 2026 Mateus Gaio

import { randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { MAX_VAULT_FILE_SIZE, scanVault, type VaultFile } from "./vault.js";
import {
  contentHash,
  parseMarkdownObject,
  serializePortentMarkdown,
  type VaultDiagnostic,
} from "./vault-portent.js";

const NOTE_TYPES = ["Project", "Event", "Note", "Topic"] as const;
const NOTE_STATUSES = ["captured", "organized", "archived"] as const;
const MAX_TITLE_LENGTH = 240;
const MAX_BODY_LENGTH = MAX_VAULT_FILE_SIZE;
const MAX_REFERENCE_LENGTH = 128;
const JOURNAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const JOURNAL_TERMINAL_LIMIT = 2_000;

export type VaultNoteType = (typeof NOTE_TYPES)[number];
export type VaultNoteStatus = (typeof NOTE_STATUSES)[number];
type VaultWriteOperation = "create" | "update" | "archive" | "restore" | "delete";
type VaultWriteState = "prepared" | "committed" | "aborted" | "conflict";

type VaultRelationTarget = {
  path: string;
  portentId: string;
  title: string;
};

type VaultNoteSummary = {
  contentHash: string;
  createdAt?: string;
  diagnosticCount: number;
  managed: true;
  path: string;
  portentId: string;
  revisionId?: string;
  source: "blackwall";
  sourceKind?: string;
  status: VaultNoteStatus;
  title: string;
  type: VaultNoteType;
  updatedAt?: string;
};

type VaultNoteDetail = VaultNoteSummary & {
  body: string;
  belongsTo: VaultRelationTarget | null;
  relatedTo: VaultRelationTarget[];
};

type VaultNoteList = {
  notes: VaultNoteSummary[];
  page: number;
  pageSize: number;
  total: number;
};

type VaultDiagnosticPage = {
  diagnostics: VaultDiagnostic[];
  page: number;
  pageSize: number;
  total: number;
};

type VaultNoteCreateInput = {
  belongsTo: string | null;
  body: string;
  relatedTo: string[];
  status: VaultNoteStatus;
  title: string;
  type: VaultNoteType;
};

type VaultNotePatchInput = {
  belongsTo?: string | null;
  body?: string;
  expectedHash: string;
  relatedTo?: string[];
  status?: VaultNoteStatus;
  title?: string;
  type?: VaultNoteType;
};

export class VaultEditorError extends Error {
  constructor(
    readonly code:
      | "vault_workspace_not_found"
      | "vault_note_not_found"
      | "vault_note_missing"
      | "vault_note_managed_invalid"
      | "vault_note_conflict"
      | "vault_relation_not_found"
      | "vault_relation_ambiguous"
      | "vault_invalid_input"
      | "vault_path_outside_workspace"
      | "vault_path_unsafe"
      | "vault_file_too_large"
      | "vault_write_failed",
    message: string,
    readonly details: { currentHash?: string; portentId?: string } = {},
  ) {
    super(message);
    this.name = "VaultEditorError";
  }

  get status() {
    if (this.code === "vault_workspace_not_found" || this.code === "vault_note_not_found")
      return 404;
    if (this.code === "vault_note_conflict" || this.code === "vault_note_missing") return 409;
    if (this.code === "vault_path_outside_workspace") return 403;
    if (this.code === "vault_write_failed") return 500;
    return 400;
  }
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: RecordValue, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new VaultEditorError(
      "vault_invalid_input",
      "O objeto recebido contém campos não permitidos.",
    );
  }
}

function cleanText(value: string, maxLength: number, field: string, allowEmpty = false) {
  const cleaned = Array.from(value.normalize("NFKC"))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(code < 32 && code !== 9 && code !== 10 && code !== 13) && code !== 127;
    })
    .join("")
    .trim();
  if (!allowEmpty && !cleaned)
    throw new VaultEditorError("vault_invalid_input", `${field} não pode ficar vazio.`);
  if (cleaned.length > maxLength)
    throw new VaultEditorError("vault_invalid_input", `${field} excede o limite permitido.`);
  return cleaned;
}

function cleanBody(value: string) {
  const sanitized = value
    .replace(
      /<\/?(?:script|iframe|object|embed|style)(?:\s[^>]*)?>[\s\S]*?<\/?(?:script|iframe|object|embed|style)\s*>/gi,
      "",
    )
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(\]\(\s*)(?:javascript|vbscript|data):[^)]*(\))/gi, "$1#blocked$2");
  return cleanText(sanitized, MAX_BODY_LENGTH, "body", true);
}

function noteType(value: unknown, fallback: VaultNoteType): VaultNoteType {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !NOTE_TYPES.includes(value as VaultNoteType))
    throw new VaultEditorError("vault_invalid_input", "O tipo da nota é inválido.");
  return value as VaultNoteType;
}

function noteStatus(value: unknown, fallback: VaultNoteStatus): VaultNoteStatus {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !NOTE_STATUSES.includes(value as VaultNoteStatus))
    throw new VaultEditorError("vault_invalid_input", "O status da nota é inválido.");
  return value as VaultNoteStatus;
}

function referenceId(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new VaultEditorError("vault_invalid_input", `${field} contém um identificador inválido.`);
  return value;
}

function relationList(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new VaultEditorError(
      "vault_invalid_input",
      `${field} deve ser uma lista de identificadores.`,
    );
  const result = value.map((item) => referenceId(item, field));
  if (new Set(result).size !== result.length)
    throw new VaultEditorError("vault_invalid_input", `${field} não pode conter duplicatas.`);
  return result.sort((left, right) => left.localeCompare(right));
}

export function parseVaultNoteCreateInput(value: unknown): VaultNoteCreateInput {
  if (!isRecord(value))
    throw new VaultEditorError("vault_invalid_input", "O corpo da nota é inválido.");
  assertExactKeys(value, ["belongsTo", "body", "relatedTo", "status", "title", "type"]);
  if (typeof value.title !== "string" || typeof value.body !== "string")
    throw new VaultEditorError("vault_invalid_input", "title e body são obrigatórios.");
  let belongsTo: string | null = null;
  if (value.belongsTo !== undefined && value.belongsTo !== null)
    belongsTo = referenceId(value.belongsTo, "belongsTo");
  const relatedTo = value.relatedTo === undefined ? [] : relationList(value.relatedTo, "relatedTo");
  return {
    belongsTo,
    body: cleanBody(value.body),
    relatedTo,
    status: noteStatus(value.status, "captured"),
    title: cleanText(value.title, MAX_TITLE_LENGTH, "title"),
    type: noteType(value.type, "Note"),
  };
}

export function parseVaultNotePatchInput(value: unknown): VaultNotePatchInput {
  if (!isRecord(value))
    throw new VaultEditorError("vault_invalid_input", "O patch da nota é inválido.");
  assertExactKeys(value, [
    "belongsTo",
    "body",
    "expectedHash",
    "relatedTo",
    "status",
    "title",
    "type",
  ]);
  if (typeof value.expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.expectedHash))
    throw new VaultEditorError("vault_invalid_input", "expectedHash é inválido.");
  const editKeys = ["belongsTo", "body", "relatedTo", "status", "title", "type"];
  if (!editKeys.some((key) => key in value))
    throw new VaultEditorError("vault_invalid_input", "O patch não altera nenhum campo editável.");
  const result: VaultNotePatchInput = { expectedHash: value.expectedHash };
  if ("belongsTo" in value) {
    result.belongsTo = value.belongsTo === null ? null : referenceId(value.belongsTo, "belongsTo");
  }
  if ("body" in value) {
    if (typeof value.body !== "string")
      throw new VaultEditorError("vault_invalid_input", "body é inválido.");
    result.body = cleanBody(value.body);
  }
  if ("relatedTo" in value) result.relatedTo = relationList(value.relatedTo, "relatedTo");
  if ("status" in value) result.status = noteStatus(value.status, "captured");
  if ("title" in value) {
    if (typeof value.title !== "string")
      throw new VaultEditorError("vault_invalid_input", "title é inválido.");
    result.title = cleanText(value.title, MAX_TITLE_LENGTH, "title");
  }
  if ("type" in value) result.type = noteType(value.type, "Note");
  return result;
}

export function parseVaultNoteDeleteInput(value: unknown) {
  if (!isRecord(value))
    throw new VaultEditorError("vault_invalid_input", "O corpo da exclusão é inválido.");
  assertExactKeys(value, ["expectedHash"]);
  if (typeof value.expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.expectedHash))
    throw new VaultEditorError("vault_invalid_input", "expectedHash é inválido.");
  return { expectedHash: value.expectedHash };
}

function pathIsInside(rootPath: string, candidatePath: string) {
  const candidate = relative(rootPath, candidatePath);
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
}

function safeRelativePath(path: string) {
  if (
    !path ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new VaultEditorError(
      "vault_path_outside_workspace",
      "O caminho da nota não é um caminho relativo seguro.",
    );
  }
  return path;
}

async function realVaultRoot(workspaceRoot: string) {
  const root = await realpath(resolve(workspaceRoot)).catch(() => null);
  const info = root ? await stat(root).catch(() => null) : null;
  if (!root || !info?.isDirectory())
    throw new VaultEditorError("vault_path_unsafe", "A pasta do Vault não está disponível.");
  return root;
}

async function safeParent(root: string, relativeDirectory: string, create: boolean) {
  let current = root;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    current = join(current, segment);
    let info = await lstat(current).catch(() => null);
    if (!info && create) {
      await mkdir(current, { mode: 0o700 });
      info = await lstat(current).catch(() => null);
    }
    if (!info || info.isSymbolicLink() || !info.isDirectory())
      throw new VaultEditorError("vault_path_unsafe", "A pasta da nota não é segura.");
    const real = await realpath(current).catch(() => null);
    if (!real || !pathIsInside(root, real))
      throw new VaultEditorError("vault_path_outside_workspace", "A nota sairia do workspace.");
  }
  return current;
}

async function safeTarget(root: string, path: string, createParent: boolean) {
  const relativePath = safeRelativePath(path);
  const parent = await safeParent(
    root,
    dirname(relativePath) === "." ? "" : dirname(relativePath),
    createParent,
  );
  const parentReal = await realpath(parent).catch(() => null);
  if (!parentReal || !pathIsInside(root, parentReal))
    throw new VaultEditorError("vault_path_outside_workspace", "A nota sairia do workspace.");
  const target = join(parentReal, basename(relativePath));
  const info = await lstat(target).catch(() => null);
  if (info?.isSymbolicLink())
    throw new VaultEditorError("vault_path_unsafe", "O arquivo da nota é um link simbólico.");
  if (info && !info.isFile())
    throw new VaultEditorError("vault_path_unsafe", "O alvo da nota não é um arquivo regular.");
  const targetReal = info ? await realpath(target).catch(() => null) : target;
  if (!targetReal || !pathIsInside(root, targetReal))
    throw new VaultEditorError("vault_path_outside_workspace", "A nota sairia do workspace.");
  return { info, parent: parentReal, relativePath, target };
}

async function syncDirectory(directory: string) {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Alguns hosts não permitem fsync de diretórios; o rename continua atômico.
  }
}

function hashesEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function temporaryPath(path: string, operationId: string) {
  const parent = dirname(path) === "." ? "" : `${dirname(path)}/`;
  return `${parent}.blackwall-vault-${operationId}.tmp`;
}

async function atomicWrite(
  root: string,
  path: string,
  operationId: string,
  content: string,
  expectExisting: boolean,
) {
  const target = await safeTarget(root, path, true);
  if (Boolean(target.info) !== expectExisting)
    throw new VaultEditorError(
      "vault_note_conflict",
      "O arquivo da nota mudou durante a gravação.",
    );
  if (Buffer.byteLength(content, "utf8") > MAX_VAULT_FILE_SIZE)
    throw new VaultEditorError("vault_file_too_large", "A nota excede o limite seguro de tamanho.");
  const tempRelative = temporaryPath(path, operationId);
  const temp = await safeTarget(root, tempRelative, true);
  if (temp.info)
    throw new VaultEditorError("vault_write_failed", "O temporário da operação já existe.");
  let renamed = false;
  try {
    const handle = await open(temp.target, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const parentReal = await realpath(dirname(target.target)).catch(() => null);
    if (!parentReal || !pathIsInside(root, parentReal))
      throw new VaultEditorError(
        "vault_path_outside_workspace",
        "A pasta da nota mudou durante a gravação.",
      );
    await rename(temp.target, target.target);
    renamed = true;
    await syncDirectory(parentReal);
    return tempRelative;
  } finally {
    if (!renamed) await unlink(temp.target).catch(() => undefined);
  }
}

function noteDirectory(type: VaultNoteType) {
  return { Event: "Events", Note: "Notes", Project: "Projects", Topic: "Topics" }[type];
}

function notePath(type: VaultNoteType, title: string, shortId: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 96);
  return join("Blackwall Vault", noteDirectory(type), `${slug || "nota"}--${shortId}.md`);
}

function pathForWikiLink(path: string) {
  return path
    .replace(/\.(?:md|markdown)$/i, "")
    .split("\\")
    .join("/");
}

function targetReference(file: VaultFile) {
  return `[[${pathForWikiLink(file.path)}|${file.title}]]`;
}

function relationTarget(files: VaultFile[], portentId: string, sourceId?: string) {
  const matches = files.filter((file) => file.managed && file.object.id === portentId);
  if (sourceId && matches.some((file) => file.object.id === sourceId))
    throw new VaultEditorError(
      "vault_invalid_input",
      "Uma nota não pode se relacionar consigo mesma.",
    );
  if (!matches.length)
    throw new VaultEditorError(
      "vault_relation_not_found",
      "A relação aponta para uma nota inexistente.",
    );
  if (matches.length > 1)
    throw new VaultEditorError(
      "vault_relation_ambiguous",
      "A relação aponta para uma nota ambígua.",
    );
  return matches[0];
}

function safeTargetForDiagnostic(value: string | undefined) {
  if (!value || value.includes("\0") || value.includes("\\") || isAbsolute(value)) return undefined;
  if (value.split("/").some((part) => part === "..")) return undefined;
  return value.slice(0, MAX_REFERENCE_LENGTH);
}

function sanitizedDiagnostic(diagnostic: VaultDiagnostic): VaultDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    path: safeRelativePath(diagnostic.path),
    ...(safeTargetForDiagnostic(diagnostic.target)
      ? { target: safeTargetForDiagnostic(diagnostic.target) }
      : {}),
  };
}

function summaryFor(file: VaultFile, diagnosticCount: number): VaultNoteSummary {
  const object = file.object;
  if (!file.managed || !object.id || object.source !== "blackwall")
    throw new VaultEditorError(
      "vault_note_managed_invalid",
      "A nota não é gerenciada pelo Blackwall.",
    );
  if (
    !NOTE_TYPES.includes(object.type as VaultNoteType) ||
    !NOTE_STATUSES.includes(object.status as VaultNoteStatus)
  )
    throw new VaultEditorError(
      "vault_note_managed_invalid",
      "A nota gerenciada possui campos inválidos.",
    );
  return {
    contentHash: contentHash(file.content),
    createdAt: object.createdAt,
    diagnosticCount,
    managed: true,
    path: safeRelativePath(file.path),
    portentId: object.id,
    revisionId: object.revisionId,
    source: "blackwall",
    sourceKind: object.sourceKind,
    status: object.status as VaultNoteStatus,
    title: file.title,
    type: object.type as VaultNoteType,
    updatedAt: object.updatedAt,
  };
}

function relationTargetForFile(file: VaultFile | undefined): VaultRelationTarget | null {
  if (!file?.managed || !file.object.id) return null;
  return { path: safeRelativePath(file.path), portentId: file.object.id, title: file.title };
}

function detailFor(
  file: VaultFile,
  files: VaultFile[],
  diagnostics: VaultDiagnostic[],
): VaultNoteDetail {
  const summary = summaryFor(
    file,
    diagnostics.filter((diagnostic) => diagnostic.path === file.path).length,
  );
  const graph = file.object.id
    ? (
        resolveRelationsForFile(files, file.path) as Array<{ kind: string; target?: VaultFile }>
      ).filter((relation) => relation.kind === "belongs_to" || relation.kind === "related_to")
    : [];
  const belongsTo = relationTargetForFile(
    graph.find((relation) => relation.kind === "belongs_to")?.target,
  );
  const relatedTo = graph
    .filter((relation) => relation.kind === "related_to")
    .map((relation) => relationTargetForFile(relation.target))
    .filter((target): target is VaultRelationTarget => target !== null)
    .sort((left, right) => left.portentId.localeCompare(right.portentId));
  return { ...summary, body: file.object.body, belongsTo, relatedTo };
}

function resolveRelationsForFile(files: VaultFile[], path: string) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const byId = new Map(
    files.filter((file) => file.object.id).map((file) => [file.object.id, file]),
  );
  const byStem = new Map(files.map((file) => [file.path.replace(/\.(md|markdown)$/i, ""), file]));
  const source = byPath.get(path);
  if (!source) return [];
  const resolveReference = (raw: string) => {
    const normalized = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    const withoutId = normalized.replace(/^id:/, "");
    return (
      byId.get(withoutId) ??
      byPath.get(normalized) ??
      byStem.get(normalized.replace(/\.(md|markdown)$/i, ""))
    );
  };
  const result: Array<{ kind: string; target?: VaultFile }> = [];
  const belongsTo = source.object.id
    ? parseMarkdownObject(source.content, source.path).frontmatter.belongs_to
    : null;
  if (typeof belongsTo === "string")
    result.push({ kind: "belongs_to", target: resolveReference(belongsTo) });
  const relatedTo = source.object.id
    ? parseMarkdownObject(source.content, source.path).frontmatter.related_to
    : null;
  if (Array.isArray(relatedTo)) {
    for (const value of relatedTo)
      if (typeof value === "string")
        result.push({ kind: "related_to", target: resolveReference(value) });
  }
  return result;
}

function workspaceExists(client: Database.Database, workspaceId: string) {
  return client
    .prepare("SELECT root_path AS rootPath FROM workspaces WHERE id = ?")
    .get(workspaceId) as { rootPath: string } | undefined;
}

function journalInsert(
  client: Database.Database,
  row: {
    expectedHash: string | null;
    operation: VaultWriteOperation;
    operationId: string;
    path: string;
    portentId: string | null;
    resultHash: string | null;
    state: VaultWriteState;
    temporaryPath: string | null;
    workspaceId: string;
  },
) {
  const now = Date.now();
  client
    .prepare(
      `INSERT INTO vault_write_operations
         (operation_id, workspace_id, portent_id, path, operation, expected_hash, result_hash,
          temporary_path, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.operationId,
      row.workspaceId,
      row.portentId,
      row.path,
      row.operation,
      row.expectedHash,
      row.resultHash,
      row.temporaryPath,
      row.state,
      now,
      now,
    );
}

function journalState(client: Database.Database, operationId: string, state: VaultWriteState) {
  client
    .prepare("UPDATE vault_write_operations SET state = ?, updated_at = ? WHERE operation_id = ?")
    .run(state, Date.now(), operationId);
}

function pruneJournal(client: Database.Database, workspaceId: string) {
  const cutoff = Date.now() - JOURNAL_RETENTION_MS;
  client
    .prepare(
      `DELETE FROM vault_write_operations
       WHERE workspace_id = ? AND state IN ('committed', 'aborted', 'conflict')
         AND updated_at < ?
         AND operation_id NOT IN (
           SELECT operation_id FROM vault_write_operations
           WHERE workspace_id = ? AND state IN ('committed', 'aborted', 'conflict')
           ORDER BY updated_at DESC LIMIT ?
         )`,
    )
    .run(workspaceId, cutoff, workspaceId, JOURNAL_TERMINAL_LIMIT);
}

async function readTarget(root: string, path: string) {
  const target = await safeTarget(root, path, false);
  if (!target.info) return null;
  try {
    return await readFile(target.target, "utf8");
  } catch {
    throw new VaultEditorError(
      "vault_write_failed",
      "Não foi possível ler a nota no ponto de commit.",
    );
  }
}

type EditorHooks = {
  onIndexed?: (workspaceId: string, path: string) => Promise<void> | void;
  onWrite?: (workspaceId: string, path: string) => void;
};

type ResolvedNote = {
  diagnostics: VaultDiagnostic[];
  file: VaultFile;
  files: VaultFile[];
  root: string;
};

const workspaceLocks = new Map<string, Promise<void>>();

async function withWorkspaceLock<T>(workspaceId: string, task: () => Promise<T>) {
  const previous = workspaceLocks.get(workspaceId) ?? Promise.resolve();
  let resolveTail: () => void = () => undefined;
  const tail = new Promise<void>((resolvePromise) => {
    resolveTail = resolvePromise;
  });
  const queued = previous.catch(() => undefined).then(() => tail);
  workspaceLocks.set(workspaceId, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    resolveTail();
    if (workspaceLocks.get(workspaceId) === queued) workspaceLocks.delete(workspaceId);
  }
}

export async function recoverVaultWriteOperations(
  client: Database.Database,
  workspaceId: string,
  workspaceRoot: string,
) {
  return withWorkspaceLock(workspaceId, async () => {
    const root = await realVaultRoot(workspaceRoot);
    const rows = client
      .prepare(
        `SELECT operation_id AS operationId, path, operation, expected_hash AS expectedHash,
                result_hash AS resultHash, temporary_path AS temporaryPath
         FROM vault_write_operations WHERE workspace_id = ? AND state = 'prepared'
         ORDER BY created_at, operation_id`,
      )
      .all(workspaceId) as Array<{
      expectedHash: string | null;
      operation: VaultWriteOperation;
      operationId: string;
      path: string;
      resultHash: string | null;
      temporaryPath: string | null;
    }>;
    const committedPaths: string[] = [];
    for (const row of rows) {
      try {
        safeRelativePath(row.path);
        const target = await safeTarget(root, row.path, false);
        const current = target.info ? await readFile(target.target, "utf8") : null;
        if (row.operation === "delete" && !target.info) {
          journalState(client, row.operationId, "committed");
          committedPaths.push(row.path);
          continue;
        }
        if (row.resultHash && current && hashesEqual(contentHash(current), row.resultHash)) {
          if (row.temporaryPath) {
            const temporary = await safeTarget(root, row.temporaryPath, false).catch(() => null);
            if (temporary?.info) await unlink(temporary.target).catch(() => undefined);
          }
          journalState(client, row.operationId, "committed");
          committedPaths.push(row.path);
          continue;
        }
        if (row.expectedHash && (!current || hashesEqual(contentHash(current), row.expectedHash))) {
          if (row.temporaryPath) {
            const temporary = await safeTarget(root, row.temporaryPath, false).catch(() => null);
            if (temporary?.info) await unlink(temporary.target).catch(() => undefined);
          }
          journalState(client, row.operationId, "aborted");
          continue;
        }
        if (!row.expectedHash && !current && row.temporaryPath) {
          const temporary = await safeTarget(root, row.temporaryPath, false).catch(() => null);
          if (temporary?.info) await unlink(temporary.target).catch(() => undefined);
          journalState(client, row.operationId, "aborted");
          continue;
        }
        journalState(client, row.operationId, "conflict");
      } catch {
        journalState(client, row.operationId, "conflict");
      }
    }
    pruneJournal(client, workspaceId);
    return committedPaths;
  });
}

export class VaultEditorService {
  constructor(
    private readonly client: Database.Database,
    private readonly hooks: EditorHooks = {},
  ) {}

  private async resolveNote(workspaceId: string, portentId: string): Promise<ResolvedNote> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(portentId))
      throw new VaultEditorError("vault_invalid_input", "O identificador da nota é inválido.");
    const workspace = workspaceExists(this.client, workspaceId);
    if (!workspace)
      throw new VaultEditorError("vault_workspace_not_found", "O workspace não existe.");
    const root = await realVaultRoot(workspace.rootPath);
    const graph = await scanVault(root, { includeArchived: true });
    const matches = graph.files.filter((file) => file.managed && file.object.id === portentId);
    if (matches.length > 1)
      throw new VaultEditorError(
        "vault_note_managed_invalid",
        "O identificador da nota não é único.",
      );
    if (!matches.length) {
      const projected = this.client
        .prepare("SELECT row_id FROM vault_objects WHERE workspace_id = ? AND portent_id = ?")
        .get(workspaceId, portentId);
      throw new VaultEditorError(
        projected ? "vault_note_missing" : "vault_note_not_found",
        "A nota gerenciada não está disponível no disco.",
        { portentId },
      );
    }
    const file = matches[0];
    if (file.object.source !== "blackwall")
      throw new VaultEditorError(
        "vault_note_managed_invalid",
        "A nota não é gerenciada pelo Blackwall.",
      );
    return { diagnostics: graph.diagnostics, file, files: graph.files, root };
  }

  private async workspaceRoot(workspaceId: string) {
    const workspace = workspaceExists(this.client, workspaceId);
    if (!workspace)
      throw new VaultEditorError("vault_workspace_not_found", "O workspace não existe.");
    return { root: await realVaultRoot(workspace.rootPath), workspace };
  }

  async listNotes(
    workspaceId: string,
    options: {
      hasDiagnostic?: boolean;
      page: number;
      pageSize: number;
      status?: VaultNoteStatus;
      type?: VaultNoteType;
    },
  ): Promise<VaultNoteList> {
    const { root } = await this.workspaceRoot(workspaceId);
    const graph = await scanVault(root, { includeArchived: true });
    const diagnosticCounts = new Map<string, number>();
    for (const diagnostic of graph.diagnostics)
      diagnosticCounts.set(diagnostic.path, (diagnosticCounts.get(diagnostic.path) ?? 0) + 1);
    let notes = graph.files
      .filter((file) => file.managed)
      .map((file) => summaryFor(file, diagnosticCounts.get(file.path) ?? 0))
      .filter((note) => (options.status ? note.status === options.status : true))
      .filter((note) => (options.type ? note.type === options.type : true))
      .filter((note) =>
        options.hasDiagnostic === undefined
          ? true
          : note.diagnosticCount > 0 === options.hasDiagnostic,
      )
      .sort((left, right) => left.path.localeCompare(right.path));
    const total = notes.length;
    const start = (options.page - 1) * options.pageSize;
    notes = notes.slice(start, start + options.pageSize);
    return { notes, page: options.page, pageSize: options.pageSize, total };
  }

  async getNote(workspaceId: string, portentId: string) {
    const resolved = await this.resolveNote(workspaceId, portentId);
    return detailFor(resolved.file, resolved.files, resolved.diagnostics);
  }

  async listDiagnostics(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<VaultDiagnosticPage> {
    const { root } = await this.workspaceRoot(workspaceId);
    const graph = await scanVault(root, { includeArchived: true });
    const diagnostics = graph.diagnostics
      .map(sanitizedDiagnostic)
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.code.localeCompare(right.code) ||
          (left.target ?? "").localeCompare(right.target ?? ""),
      );
    const start = (page - 1) * pageSize;
    return {
      diagnostics: diagnostics.slice(start, start + pageSize),
      page,
      pageSize,
      total: diagnostics.length,
    };
  }

  async create(
    workspaceId: string,
    input: VaultNoteCreateInput,
    options: { sourceKind?: "user" | "automatic" } = {},
  ) {
    return withWorkspaceLock(workspaceId, async () => {
      const { root } = await this.workspaceRoot(workspaceId);
      const graph = await scanVault(root, { includeArchived: true });
      const noteId = `note_${randomUUID().replaceAll("-", "")}`;
      const createdAt = new Date().toISOString();
      const revisionId = `rev_${randomUUID().replaceAll("-", "")}`;
      const belongsTo = input.belongsTo
        ? relationTarget(graph.files, input.belongsTo, noteId)
        : null;
      const relatedTo = input.relatedTo.map((id) => relationTarget(graph.files, id, noteId));
      const relations = new Set(relatedTo.map((file) => file.object.id));
      if (belongsTo?.object.id && relations.has(belongsTo.object.id))
        throw new VaultEditorError("vault_invalid_input", "belongsTo não pode repetir relatedTo.");
      const path = notePath(input.type, input.title, noteId.slice(-8));
      const frontmatter: Record<string, unknown> = {
        id: noteId,
        title: input.title,
        type: input.type,
        status: input.status,
        created_at: createdAt,
        updated_at: createdAt,
        source: "blackwall",
        source_kind: options.sourceKind ?? "user",
        revision_id: revisionId,
        ...(belongsTo ? { belongs_to: targetReference(belongsTo) } : {}),
        ...(relatedTo.length ? { related_to: relatedTo.map(targetReference) } : {}),
      };
      const markdown = serializePortentMarkdown(frontmatter, input.body);
      const resultHash = contentHash(markdown);
      const operationId = `op_${randomUUID().replaceAll("-", "")}`;
      const tempRelative = temporaryPath(path, operationId);
      journalInsert(this.client, {
        expectedHash: null,
        operation: "create",
        operationId,
        path,
        portentId: noteId,
        resultHash,
        state: "prepared",
        temporaryPath: tempRelative,
        workspaceId,
      });
      let renamed = false;
      try {
        this.hooks.onWrite?.(workspaceId, path);
        await atomicWrite(root, path, operationId, markdown, false);
        renamed = true;
        await this.hooks.onIndexed?.(workspaceId, path);
        journalState(this.client, operationId, "committed");
        pruneJournal(this.client, workspaceId);
      } catch (error) {
        if (!renamed)
          journalState(
            this.client,
            operationId,
            error instanceof VaultEditorError && error.code === "vault_note_conflict"
              ? "conflict"
              : "aborted",
          );
        throw error instanceof VaultEditorError
          ? error
          : new VaultEditorError("vault_write_failed", "Não foi possível criar a nota.");
      }
      const note = await this.getNote(workspaceId, noteId);
      return { note, operation: "create" as const, revisionId };
    });
  }

  async update(workspaceId: string, portentId: string, input: VaultNotePatchInput) {
    return withWorkspaceLock(workspaceId, async () => {
      const resolved = await this.resolveNote(workspaceId, portentId);
      const currentHash = contentHash(resolved.file.content);
      if (!hashesEqual(currentHash, input.expectedHash)) {
        const operationId = `op_${randomUUID().replaceAll("-", "")}`;
        journalInsert(this.client, {
          expectedHash: input.expectedHash,
          operation: "update",
          operationId,
          path: resolved.file.path,
          portentId,
          resultHash: null,
          state: "conflict",
          temporaryPath: null,
          workspaceId,
        });
        pruneJournal(this.client, workspaceId);
        throw new VaultEditorError(
          "vault_note_conflict",
          "A nota mudou no disco; o rascunho foi preservado.",
          {
            currentHash,
            portentId,
          },
        );
      }
      const parsed = parseMarkdownObject(resolved.file.content, resolved.file.path);
      const nextTitle = input.title ?? resolved.file.title;
      const nextType = input.type ?? (parsed.object.type as VaultNoteType);
      const nextStatus = input.status ?? (parsed.object.status as VaultNoteStatus);
      const nextBody = input.body ?? parsed.body;
      const existingRelations = resolveRelationsForFile(resolved.files, resolved.file.path);
      const existingBelongsTo =
        existingRelations.find((relation) => relation.kind === "belongs_to")?.target?.object.id ??
        null;
      const existingRelatedTo = existingRelations
        .filter((relation) => relation.kind === "related_to")
        .flatMap((relation) => (relation.target?.object.id ? [relation.target.object.id] : []));
      const nextBelongsTo = input.belongsTo === undefined ? existingBelongsTo : input.belongsTo;
      const nextRelatedTo = input.relatedTo === undefined ? existingRelatedTo : input.relatedTo;
      if (nextBelongsTo && nextRelatedTo.includes(nextBelongsTo))
        throw new VaultEditorError("vault_invalid_input", "belongsTo não pode repetir relatedTo.");
      const nextFrontmatter = { ...parsed.frontmatter };
      const nextRevisionId = `rev_${randomUUID().replaceAll("-", "")}`;
      nextFrontmatter.title = nextTitle;
      nextFrontmatter.type = nextType;
      nextFrontmatter.status = nextStatus;
      nextFrontmatter.updated_at = new Date().toISOString();
      nextFrontmatter.revision_id = nextRevisionId;
      if (input.belongsTo !== undefined) {
        if (input.belongsTo === null) delete nextFrontmatter.belongs_to;
        else
          nextFrontmatter.belongs_to = targetReference(
            relationTarget(resolved.files, input.belongsTo, portentId),
          );
      }
      if (input.relatedTo !== undefined) {
        if (!input.relatedTo.length) delete nextFrontmatter.related_to;
        else
          nextFrontmatter.related_to = input.relatedTo
            .map((id) => relationTarget(resolved.files, id, portentId))
            .map(targetReference);
      }
      const markdown = serializePortentMarkdown(nextFrontmatter, nextBody);
      const resultHash = contentHash(markdown);
      const operationId = `op_${randomUUID().replaceAll("-", "")}`;
      const operation: VaultWriteOperation =
        nextStatus === "archived" && parsed.object.status !== "archived"
          ? "archive"
          : parsed.object.status === "archived" && nextStatus !== "archived"
            ? "restore"
            : "update";
      journalInsert(this.client, {
        expectedHash: input.expectedHash,
        operation,
        operationId,
        path: resolved.file.path,
        portentId,
        resultHash,
        state: "prepared",
        temporaryPath: temporaryPath(resolved.file.path, operationId),
        workspaceId,
      });
      let renamed = false;
      try {
        this.hooks.onWrite?.(workspaceId, resolved.file.path);
        const latest = await readTarget(resolved.root, resolved.file.path);
        if (!latest || !hashesEqual(contentHash(latest), input.expectedHash))
          throw new VaultEditorError(
            "vault_note_conflict",
            "A nota mudou no disco; o rascunho foi preservado.",
            {
              currentHash: latest ? contentHash(latest) : undefined,
              portentId,
            },
          );
        await atomicWrite(resolved.root, resolved.file.path, operationId, markdown, true);
        renamed = true;
        await this.hooks.onIndexed?.(workspaceId, resolved.file.path);
        journalState(this.client, operationId, "committed");
        pruneJournal(this.client, workspaceId);
      } catch (error) {
        if (!renamed)
          journalState(
            this.client,
            operationId,
            error instanceof VaultEditorError && error.code === "vault_note_conflict"
              ? "conflict"
              : "aborted",
          );
        throw error instanceof VaultEditorError
          ? error
          : new VaultEditorError("vault_write_failed", "Não foi possível atualizar a nota.");
      }
      const note = await this.getNote(workspaceId, portentId);
      return { note, operation, revisionId: nextRevisionId };
    });
  }

  async delete(workspaceId: string, portentId: string, expectedHash: string) {
    return withWorkspaceLock(workspaceId, async () => {
      const resolved = await this.resolveNote(workspaceId, portentId);
      const currentHash = contentHash(resolved.file.content);
      if (!hashesEqual(currentHash, expectedHash)) {
        const operationId = `op_${randomUUID().replaceAll("-", "")}`;
        journalInsert(this.client, {
          expectedHash,
          operation: "delete",
          operationId,
          path: resolved.file.path,
          portentId,
          resultHash: null,
          state: "conflict",
          temporaryPath: null,
          workspaceId,
        });
        pruneJournal(this.client, workspaceId);
        throw new VaultEditorError(
          "vault_note_conflict",
          "A nota mudou no disco; a exclusão foi bloqueada.",
          {
            currentHash,
            portentId,
          },
        );
      }
      const operationId = `op_${randomUUID().replaceAll("-", "")}`;
      const revisionId = `rev_${randomUUID().replaceAll("-", "")}`;
      journalInsert(this.client, {
        expectedHash,
        operation: "delete",
        operationId,
        path: resolved.file.path,
        portentId,
        resultHash: null,
        state: "prepared",
        temporaryPath: null,
        workspaceId,
      });
      try {
        this.hooks.onWrite?.(workspaceId, resolved.file.path);
        const latest = await readTarget(resolved.root, resolved.file.path);
        if (!latest || !hashesEqual(contentHash(latest), expectedHash))
          throw new VaultEditorError(
            "vault_note_conflict",
            "A nota mudou no disco; a exclusão foi bloqueada.",
            {
              currentHash: latest ? contentHash(latest) : undefined,
              portentId,
            },
          );
        const target = await safeTarget(resolved.root, resolved.file.path, false);
        await unlink(target.target);
        await syncDirectory(target.parent);
        await this.hooks.onIndexed?.(workspaceId, resolved.file.path);
        journalState(this.client, operationId, "committed");
        pruneJournal(this.client, workspaceId);
      } catch (error) {
        journalState(
          this.client,
          operationId,
          error instanceof VaultEditorError && error.code === "vault_note_conflict"
            ? "conflict"
            : "aborted",
        );
        throw error instanceof VaultEditorError
          ? error
          : new VaultEditorError("vault_write_failed", "Não foi possível excluir a nota.");
      }
      return { deleted: true, operation: "delete" as const, revisionId };
    });
  }
}
