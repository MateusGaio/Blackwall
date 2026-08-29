// MIT License — Copyright (c) 2026 Mateus Gaio

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { scanVault } from "./vault.js";
import { contentHash } from "./vault-portent.js";

type RebuildVaultIndexInput = {
  rootPath: string;
  workspaceId: string;
  includeArchived?: boolean;
};

function rowId(workspaceId: string, path: string) {
  return `vault_${contentHash(`${workspaceId}\0${path}`).slice(0, 32)}`;
}

function relationId(workspaceId: string, source: string, kind: string, targetRef: string) {
  return `relation_${contentHash(`${workspaceId}\0${source}\0${kind}\0${targetRef}`).slice(0, 32)}`;
}

export async function rebuildVaultIndex(client: Database.Database, input: RebuildVaultIndexInput) {
  const rootPath = resolve(input.rootPath);
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
         source_mtime, managed, body, created_at, updated_at)
      VALUES (@rowId, @workspaceId, @portentId, @path, @title, @type, @status, @contentHash,
         @sourceMtime, @managed, @body, @now, @now)
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
        status: file.object.status ?? null,
        title: file.title,
        type: file.object.type ?? null,
        workspaceId: input.workspaceId,
      });
      insertFts.run(id, input.workspaceId, file.title, file.object.body);
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
