// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { scanVault } from "./vault.js";
import { contentHash, serializePortentMarkdown } from "./vault-portent.js";

type VaultNoteType = "Project" | "Event" | "Note" | "Topic";

type VaultNoteResult = {
  created: boolean;
  hash: string;
  noteId: string;
  path: string;
  revisionId: string;
  title: string;
  type: VaultNoteType;
};

class VaultCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VaultCaptureError";
  }

  get status() {
    if (this.code === "vault_revision_not_found") return 404;
    if (this.code === "vault_note_conflict" || this.code === "vault_revision_conflict") return 409;
    if (this.code === "vault_path_outside_workspace") return 403;
    return 400;
  }
}

type CaptureInput = {
  belongsTo: string | null;
  body: string;
  client: Database.Database;
  relatedTo: string[];
  title: string;
  type: VaultNoteType;
  workspaceId: string;
  workspaceRoot: string;
};

type VaultReference = { object: { id?: string }; path: string };

function cleanText(value: string, maxLength: number, field: string) {
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(code < 32 && code !== 9 && code !== 10 && code !== 13) && code !== 127;
    })
    .join("")
    .trim();
  if (!cleaned) throw new VaultCaptureError("invalid_vault_note", `${field} não pode ser vazio.`);
  if (cleaned.length > maxLength)
    throw new VaultCaptureError("invalid_vault_note", `${field} excede o limite permitido.`);
  return cleaned;
}

function sanitizeMarkdown(value: string) {
  return value
    .replace(
      /<\/?(?:script|iframe|object|embed|style)(?:\s[^>]*)?>[\s\S]*?<\/?(?:script|iframe|object|embed|style)\s*>/gi,
      "",
    )
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(\]\(\s*)(?:javascript|vbscript|data):[^)]*(\))/gi, "$1#blocked$2");
}

function safeReference(value: string, field: string) {
  return cleanText(value, 512, field).replace(/\r?\n/g, " ");
}

function referenceKey(reference: VaultReference) {
  return reference.object.id
    ? `id:${reference.object.id}`
    : reference.path.replace(/\.(?:md|markdown)$/i, "");
}

function resolveReference(
  files: Array<{ object: { id?: string }; path: string }>,
  rawReference: string,
  field: string,
) {
  const reference = safeReference(rawReference, field);
  const normalized = reference
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/^id:/, "")
    .replace(/^\.\//, "")
    .replaceAll("\\", "/");
  const candidates = files.filter((file) => {
    const path = file.path.replace(/\.(?:md|markdown)$/i, "");
    const fileId = file.object.id;
    const fileName = basename(file.path, extname(file.path));
    return fileId === normalized || path === normalized || fileName === normalized;
  });
  if (candidates.length === 0)
    throw new VaultCaptureError(
      "vault_relation_not_found",
      `A referência ${reference} não foi encontrada.`,
    );
  if (candidates.length > 1)
    throw new VaultCaptureError("vault_relation_ambiguous", `A referência ${reference} é ambígua.`);
  return candidates[0];
}

function notePath(type: VaultNoteType, title: string, shortId: string) {
  const directory = {
    Event: "Events",
    Note: "Notes",
    Project: "Projects",
    Topic: "Topics",
  }[type];
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 96);
  return join("Blackwall Vault", directory, `${slug || "nota"}--${shortId}.md`);
}

function inside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function atomicCreate(root: string, requestedPath: string, content: string) {
  const candidate = resolve(root, requestedPath);
  if (!inside(root, candidate))
    throw new VaultCaptureError("vault_path_outside_workspace", "A nota sairia do workspace.");
  const parent = dirname(candidate);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent).catch(() => null);
  const realRoot = await realpath(root).catch(() => null);
  if (!realParent || !realRoot || !inside(realRoot, realParent))
    throw new VaultCaptureError("vault_path_outside_workspace", "A pasta do Vault não é segura.");
  const target = join(realParent, basename(candidate));
  if (await stat(target).catch(() => null))
    throw new VaultCaptureError(
      "vault_note_conflict",
      "Já existe uma nota com esse identificador.",
    );
  const temporary = join(
    realParent,
    `.blackwall-note-${createHash("sha256").update(`${target}\0${Date.now()}\0${Math.random()}`).digest("hex")}.tmp`,
  );
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    // link() falha se o destino apareceu entre a checagem e o commit; não há
    // rename destrutivo que possa sobrescrever uma nota criada por outro ator.
    await link(temporary, target);
  } catch (error) {
    throw new VaultCaptureError(
      "vault_note_conflict",
      error instanceof Error ? error.message : "Não foi possível reservar o caminho da nota.",
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return relative(realRoot, target).split("\\").join("/");
}

export async function createVaultNote(input: CaptureInput): Promise<VaultNoteResult> {
  const title = cleanText(input.title, 240, "title");
  const body = sanitizeMarkdown(cleanText(input.body, 500_000, "body"));
  if (!body.trim()) throw new VaultCaptureError("invalid_vault_note", "body não pode ficar vazio.");
  const files = (await scanVault(input.workspaceRoot, { includeArchived: true })).files;
  const belongsTo = input.belongsTo ? resolveReference(files, input.belongsTo, "belongsTo") : null;
  const relatedTo = input.relatedTo.map((reference, index) =>
    resolveReference(files, reference, `relatedTo[${index}]`),
  );
  const relations = {
    belongsTo: belongsTo ? referenceKey(belongsTo) : null,
    relatedTo: relatedTo.map(referenceKey),
  };
  const seed = createHash("sha256")
    .update(JSON.stringify({ body, relations, title, type: input.type }))
    .digest("hex");
  const noteId = `note_${seed.slice(0, 24)}`;
  const revisionId = `rev_${seed.slice(0, 24)}`;
  const path = notePath(input.type, title, seed.slice(0, 8));
  const now = new Date().toISOString();
  const markdown = serializePortentMarkdown(
    {
      id: noteId,
      title,
      type: input.type,
      status: "captured",
      created_at: now,
      updated_at: now,
      source: "blackwall",
      source_kind: "explicit",
      belongs_to: relations.belongsTo,
      related_to: relations.relatedTo,
      revision_id: revisionId,
    },
    body,
  );
  const hash = contentHash(markdown);
  const existing = input.client
    .prepare(
      "SELECT revision_id AS revisionId, note_id AS noteId, path, title, type, content_hash AS hash, state FROM vault_revisions WHERE revision_id = ? AND workspace_id = ?",
    )
    .get(revisionId, input.workspaceId) as
    | (VaultNoteResult & { state: "prepared" | "committed" | "undone" })
    | undefined;
  if (existing?.state === "committed" || existing?.state === "undone") {
    return { ...existing, created: false };
  }
  const existingPath = resolve(input.workspaceRoot, existing?.path ?? path);
  const existingContent = await readFile(existingPath, "utf8").catch(() => null);
  if (
    existing?.state === "prepared" &&
    existingContent &&
    contentHash(existingContent) === existing.hash
  ) {
    input.client
      .prepare(
        "UPDATE vault_revisions SET state = 'committed', updated_at = ? WHERE revision_id = ?",
      )
      .run(Date.now(), revisionId);
    return { ...existing, created: false, hash: existing.hash };
  }
  const timestamp = Date.now();
  input.client
    .prepare(
      `INSERT INTO vault_revisions
        (revision_id, workspace_id, note_id, path, title, type, content_hash, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?) 
       ON CONFLICT(revision_id) DO UPDATE SET content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
    )
    .run(
      revisionId,
      input.workspaceId,
      noteId,
      path,
      title,
      input.type,
      hash,
      timestamp,
      timestamp,
    );
  try {
    const writtenPath = existing?.path ?? (await atomicCreate(input.workspaceRoot, path, markdown));
    input.client
      .prepare(
        "UPDATE vault_revisions SET state = 'committed', updated_at = ? WHERE revision_id = ?",
      )
      .run(Date.now(), revisionId);
    return { created: true, hash, noteId, path: writtenPath, revisionId, title, type: input.type };
  } catch (error) {
    input.client
      .prepare("DELETE FROM vault_revisions WHERE revision_id = ? AND state = 'prepared'")
      .run(revisionId);
    throw error;
  }
}

export async function undoVaultRevision(
  client: Database.Database,
  workspaceId: string,
  workspaceRoot: string,
  revisionId: string,
) {
  const row = client
    .prepare(
      "SELECT revision_id AS revisionId, path, content_hash AS hash, state FROM vault_revisions WHERE revision_id = ? AND workspace_id = ?",
    )
    .get(revisionId, workspaceId) as
    | { revisionId: string; path: string; hash: string; state: "prepared" | "committed" | "undone" }
    | undefined;
  if (!row)
    throw new VaultCaptureError(
      "vault_revision_not_found",
      "A revisão do Vault não foi encontrada.",
    );
  if (row.state === "undone") return { revisionId, undone: false };
  const root = await realpath(workspaceRoot).catch(() => null);
  const target = root ? resolve(root, row.path) : resolve(workspaceRoot, row.path);
  if (!root || !inside(root, target))
    throw new VaultCaptureError(
      "vault_path_outside_workspace",
      "A revisão aponta para fora do workspace.",
    );
  const realParent = await realpath(dirname(target)).catch(() => null);
  if (!realParent || !inside(root, realParent))
    throw new VaultCaptureError("vault_path_outside_workspace", "A pasta da revisão não é segura.");
  const safeTarget = join(realParent, basename(target));
  const targetInfo = await lstat(safeTarget).catch(() => null);
  if (targetInfo?.isSymbolicLink())
    throw new VaultCaptureError(
      "vault_path_outside_workspace",
      "A revisão aponta para um link simbólico.",
    );
  const current = targetInfo?.isFile() ? await readFile(safeTarget, "utf8") : null;
  if (current && contentHash(current) !== row.hash)
    throw new VaultCaptureError(
      "vault_revision_conflict",
      "A nota mudou desde a captura; o undo foi bloqueado.",
    );
  if (current) await unlink(safeTarget);
  client
    .prepare(
      "UPDATE vault_revisions SET state = 'undone', undone_at = ?, updated_at = ? WHERE revision_id = ? AND workspace_id = ?",
    )
    .run(Date.now(), Date.now(), revisionId, workspaceId);
  return { revisionId, undone: true };
}
