// MIT License — Copyright (c) 2026 Mateus Gaio

import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { chunkVaultObject } from "./embedding-chunks.js";
import {
  MAX_VAULT_FILE_SIZE,
  markdownHeadings,
  resolveVaultRelations,
  scanVault,
  type VaultFile,
} from "./vault.js";
import { contentHash, parseMarkdownObject, type VaultDiagnostic } from "./vault-portent.js";

type RebuildVaultIndexInput = {
  rootPath: string;
  workspaceId: string;
  includeArchived?: boolean;
};

type VaultIndexFailure = {
  code: "vault_file_read_failed";
  path: string;
};

type VaultIndexSyncResult = {
  diagnostics: VaultDiagnostic[];
  failures: VaultIndexFailure[];
  ignoredPaths: string[];
  indexedFiles: number;
  syncedPaths: string[];
};

class VaultIndexError extends Error {
  constructor(
    readonly code: "vault_root_unavailable" | "vault_index_failed",
    message: string,
  ) {
    super(message);
    this.name = "VaultIndexError";
  }
}

function rowId(workspaceId: string, path: string) {
  return `vault_${contentHash(`${workspaceId}\0${path}`).slice(0, 32)}`;
}

function relationId(workspaceId: string, source: string, kind: string, targetRef: string) {
  return `relation_${contentHash(`${workspaceId}\0${source}\0${kind}\0${targetRef}`).slice(0, 32)}`;
}

function inside(rootPath: string, candidatePath: string) {
  const path = relative(rootPath, candidatePath);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function safeErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").toLowerCase();
    if (/^[a-z0-9_-]+$/.test(code)) return code;
  }
  return "unknown";
}

async function vaultRoot(rootPath: string) {
  const root = await realpath(resolve(rootPath)).catch(() => null);
  if (!root)
    throw new VaultIndexError("vault_root_unavailable", "A pasta do Vault não está disponível.");
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory())
    throw new VaultIndexError("vault_root_unavailable", "A pasta do Vault não é um diretório.");
  return root;
}

function persistedVaultFile(row: {
  body: string;
  managed: number;
  path: string;
  portentId: string | null;
  sourceContent: string;
  status: string | null;
  title: string;
  type: string | null;
}) {
  const parsed = parseMarkdownObject(row.sourceContent, row.path);
  return {
    content: row.sourceContent,
    headings: markdownHeadings(parsed.body),
    managed: Boolean(row.managed),
    object: {
      ...parsed.object,
      body: row.body,
      id: parsed.object.id ?? row.portentId ?? undefined,
      status: parsed.object.status ?? row.status ?? undefined,
      title: parsed.object.title || row.title,
      type: parsed.object.type ?? row.type ?? undefined,
    },
    path: row.path,
    title: row.title,
  } satisfies VaultFile;
}

function rebuildRelations(client: Database.Database, workspaceId: string) {
  const rows = client
    .prepare(
      `SELECT row_id AS rowId, path, title, type, status, portent_id AS portentId,
              managed, body, source_content AS sourceContent
       FROM vault_objects WHERE workspace_id = ? ORDER BY path`,
    )
    .all(workspaceId) as Array<{
    body: string;
    managed: number;
    path: string;
    portentId: string | null;
    rowId: string;
    sourceContent: string;
    status: string | null;
    title: string;
    type: string | null;
  }>;
  const files = rows.map(persistedVaultFile);
  const graph = resolveVaultRelations(files, true);
  const objectIds = new Map(rows.map((row) => [row.path, row.rowId]));
  client.prepare("DELETE FROM vault_relations WHERE workspace_id = ?").run(workspaceId);
  const insertRelation = client.prepare(`
    INSERT INTO vault_relations
      (relation_id, workspace_id, source_object_id, kind, target_ref, target_object_id, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const relation of graph.relations) {
    insertRelation.run(
      relationId(workspaceId, relation.source, relation.kind, relation.targetRef),
      workspaceId,
      objectIds.get(relation.source),
      relation.kind,
      relation.targetRef,
      relation.target ? objectIds.get(relation.target) : null,
      relation.resolution,
    );
  }
  return graph;
}

export async function rebuildVaultIndex(client: Database.Database, input: RebuildVaultIndexInput) {
  const rootPath = await vaultRoot(input.rootPath);
  const graph = await scanVault(rootPath, { includeArchived: input.includeArchived ?? true });
  const now = Date.now();
  const mtimes = new Map<string, number>();
  for (const file of graph.files) {
    const info = await stat(join(rootPath, file.path)).catch(() => null);
    mtimes.set(file.path, info?.mtimeMs ?? now);
  }
  const objectIds = new Map(
    graph.files.map((file) => [file.path, rowId(input.workspaceId, file.path)]),
  );
  const transaction = client.transaction(() => {
    client.prepare("DELETE FROM vault_relations WHERE workspace_id = ?").run(input.workspaceId);
    client.prepare("DELETE FROM vault_objects_fts WHERE workspace_id = ?").run(input.workspaceId);
    client.prepare("DELETE FROM vault_objects WHERE workspace_id = ?").run(input.workspaceId);
    const insertObject = client.prepare(`
      INSERT INTO vault_objects
        (row_id, workspace_id, portent_id, path, title, type, status, content_hash,
         source_mtime, managed, body, source_content, created_at, updated_at)
      VALUES (@rowId, @workspaceId, @portentId, @path, @title, @type, @status, @contentHash,
         @sourceMtime, @managed, @body, @sourceContent, @now, @now)
    `);
    const insertFts = client.prepare(
      "INSERT INTO vault_objects_fts (object_id, workspace_id, title, body) VALUES (?, ?, ?, ?)",
    );
    for (const file of graph.files) {
      const id = objectIds.get(file.path) as string;
      insertObject.run({
        body: file.object.body,
        contentHash: contentHash(file.content),
        managed: file.managed ? 1 : 0,
        now,
        path: file.path,
        portentId: file.object.id ?? null,
        rowId: id,
        sourceMtime: mtimes.get(file.path) ?? now,
        sourceContent: file.content,
        status: file.object.status ?? null,
        title: file.title,
        type: file.object.type ?? null,
        workspaceId: input.workspaceId,
      });
      insertFts.run(id, input.workspaceId, file.title, `${file.path}\n${file.content}`);
    }
    const insertRelation = client.prepare(`
      INSERT INTO vault_relations
        (relation_id, workspace_id, source_object_id, kind, target_ref, target_object_id, resolution)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const relation of graph.relations) {
      insertRelation.run(
        relationId(input.workspaceId, relation.source, relation.kind, relation.targetRef),
        input.workspaceId,
        objectIds.get(relation.source),
        relation.kind,
        relation.targetRef,
        relation.target ? objectIds.get(relation.target) : null,
        relation.resolution,
      );
    }
  });
  transaction();
  return { diagnostics: graph.diagnostics, graph, indexedFiles: graph.files.length };
}

async function changedFile(rootPath: string, path: string) {
  const absolutePath = resolve(rootPath, path);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(absolutePath);
  } catch (error) {
    if (safeErrorCode(error) === "enoent") return { kind: "removed" as const };
    return { code: "vault_file_read_failed" as const, kind: "failed" as const };
  }
  if (info.isSymbolicLink())
    return { ignored: true, kind: "removed" as const, reason: "symlink" as const };
  if (!info.isFile())
    return { ignored: true, kind: "removed" as const, reason: "not_file" as const };
  if (info.size > MAX_VAULT_FILE_SIZE)
    return { ignored: true, kind: "removed" as const, reason: "too_large" as const };
  try {
    const content = await readFile(absolutePath);
    if (content.byteLength > MAX_VAULT_FILE_SIZE)
      return { ignored: true, kind: "removed" as const, reason: "too_large" as const };
    return { content: content.toString("utf8"), kind: "present" as const, mtime: info.mtimeMs };
  } catch (error) {
    if (safeErrorCode(error) === "enoent") return { kind: "removed" as const };
    return { code: "vault_file_read_failed" as const, kind: "failed" as const };
  }
}

export async function syncVaultIndexChanges(
  client: Database.Database,
  input: { paths: string[]; rootPath: string; workspaceId: string },
): Promise<VaultIndexSyncResult> {
  const rootPath = await vaultRoot(input.rootPath);
  const requestedPaths = [...new Set(input.paths)].sort();
  const normalizedPaths: string[] = [];
  const ignoredPaths: string[] = [];
  const failures: VaultIndexFailure[] = [];
  const normalizedSeen = new Set<string>();
  const changes: Array<
    | { kind: "present"; mtime: number; path: string; content: string }
    | { kind: "removed"; path: string }
  > = [];

  for (const requestedPath of requestedPaths) {
    const candidate = resolve(rootPath, requestedPath);
    if (!inside(rootPath, candidate)) {
      ignoredPaths.push(requestedPath);
      continue;
    }
    const path = relative(rootPath, candidate).split("\\").join("/");
    if (!/\.(md|markdown)$/i.test(path)) {
      ignoredPaths.push(path);
      continue;
    }
    if (normalizedSeen.has(path)) continue;
    normalizedSeen.add(path);
    normalizedPaths.push(path);
    const change = await changedFile(rootPath, path);
    if (change.kind === "failed") {
      failures.push({ code: change.code, path });
      continue;
    }
    if (change.ignored) ignoredPaths.push(path);
    changes.push({ ...change, path });
  }

  let relationGraph: ReturnType<typeof rebuildRelations> | undefined;
  const transaction = client.transaction(() => {
    const now = Date.now();
    const insertObject = client.prepare(`
      INSERT INTO vault_objects
        (row_id, workspace_id, portent_id, path, title, type, status, content_hash,
         source_mtime, managed, body, source_content, created_at, updated_at)
      VALUES (@rowId, @workspaceId, @portentId, @path, @title, @type, @status, @contentHash,
         @sourceMtime, @managed, @body, @sourceContent, @now, @now)
      ON CONFLICT(workspace_id, path) DO UPDATE SET
        row_id = excluded.row_id,
        portent_id = excluded.portent_id,
        title = excluded.title,
        type = excluded.type,
        status = excluded.status,
        content_hash = excluded.content_hash,
        source_mtime = excluded.source_mtime,
        managed = excluded.managed,
        body = excluded.body,
        source_content = excluded.source_content,
        updated_at = excluded.updated_at
    `);
    const deleteObject = client.prepare(
      "DELETE FROM vault_objects WHERE workspace_id = ? AND path = ?",
    );
    const deleteFts = client.prepare(
      "DELETE FROM vault_objects_fts WHERE workspace_id = ? AND object_id = ?",
    );
    const insertFts = client.prepare(
      "INSERT INTO vault_objects_fts (object_id, workspace_id, title, body) VALUES (?, ?, ?, ?)",
    );
    for (const change of changes) {
      const id = rowId(input.workspaceId, change.path);
      if (change.kind === "removed") {
        deleteFts.run(input.workspaceId, id);
        deleteObject.run(input.workspaceId, change.path);
        continue;
      }
      const parsed = parseMarkdownObject(change.content, change.path);
      insertObject.run({
        body: parsed.object.body,
        contentHash: contentHash(change.content),
        managed: parsed.managed ? 1 : 0,
        now,
        path: change.path,
        portentId: parsed.object.id ?? null,
        rowId: id,
        sourceContent: change.content,
        sourceMtime: change.mtime,
        status: parsed.object.status ?? null,
        title: parsed.object.title,
        type: parsed.object.type ?? null,
        workspaceId: input.workspaceId,
      });
      deleteFts.run(input.workspaceId, id);
      // O corpo do objeto continua sem frontmatter para renderização, mas o
      // índice lexical inclui metadados (aliases, tags e propriedades) para o
      // Quick Search sem criar um segundo mecanismo de busca.
      insertFts.run(
        id,
        input.workspaceId,
        parsed.object.title,
        `${change.path}\n${change.content}`,
      );
    }
    relationGraph = rebuildRelations(client, input.workspaceId);
  });
  transaction();
  const indexedFiles = (
    client
      .prepare("SELECT COUNT(*) AS count FROM vault_objects WHERE workspace_id = ?")
      .get(input.workspaceId) as { count: number }
  ).count;
  return {
    diagnostics: relationGraph?.diagnostics ?? [],
    failures,
    ignoredPaths,
    indexedFiles,
    syncedPaths: normalizedPaths,
  };
}

export function searchVault(client: Database.Database, workspaceId: string, query: string) {
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
  if (!ftsQuery) return [];
  return client
    .prepare(
      `SELECT object_id AS objectId, title, snippet(vault_objects_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet
       FROM vault_objects_fts
       WHERE workspace_id = ? AND vault_objects_fts MATCH ?
       ORDER BY bm25(vault_objects_fts, 1, 2)`,
    )
    .all(workspaceId, ftsQuery) as Array<{ objectId: string; snippet: string; title: string }>;
}

export type VaultLexicalSearchResult = {
  chunkIndex: number;
  contentHash: string;
  excerpt: string;
  lexicalRank: number;
  objectId: string;
  path: string;
  title: string;
};

function queryTerms(query: string) {
  return query
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean);
}

function matchingChunkIndex(query: string, chunks: string[]) {
  const terms = queryTerms(query);
  const scored = chunks.map((chunk, index) => {
    const normalized = chunk
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
    const score = terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0);
    return { index, score };
  });
  return (
    scored.sort((left, right) => right.score - left.score || left.index - right.index)[0]?.index ??
    0
  );
}

export function searchVaultDetailed(
  client: Database.Database,
  workspaceId: string,
  query: string,
  limit = 20,
  options: { includeLifecycle?: boolean } = {},
): VaultLexicalSearchResult[] {
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
  if (!ftsQuery) return [];
  const lifecycleClause = options.includeLifecycle
    ? ""
    : " AND (o.managed = 0 OR o.status = 'organized')";
  const rows = client
    .prepare(
      `SELECT f.object_id AS objectId, o.path, o.title,
              o.content_hash AS contentHash, o.body, o.source_content AS sourceContent
       FROM vault_objects_fts f
       JOIN vault_objects o ON o.row_id = f.object_id AND o.workspace_id = f.workspace_id
       WHERE f.workspace_id = ? AND vault_objects_fts MATCH ?${lifecycleClause}
       ORDER BY bm25(vault_objects_fts, 1, 2), o.path, o.row_id
       LIMIT ?`,
    )
    .all(workspaceId, ftsQuery, limit) as Array<{
    body: string;
    contentHash: string;
    objectId: string;
    path: string;
    sourceContent: string;
    title: string;
  }>;
  return rows.map((row, index) => {
    const body = row.sourceContent ?? row.body;
    const chunks = chunkVaultObject(row.title, body);
    const chunkIndex = matchingChunkIndex(query, chunks);
    return {
      chunkIndex,
      contentHash: row.contentHash,
      excerpt: chunks[chunkIndex] ?? chunks[0] ?? "",
      lexicalRank: index + 1,
      objectId: row.objectId,
      path: row.path,
      title: row.title,
    };
  });
}
