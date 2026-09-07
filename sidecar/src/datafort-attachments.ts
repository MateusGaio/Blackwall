// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type Database from "better-sqlite3";

const MAX_INDEXED_BYTES = 10 * 1024 * 1024;
const INDEXABLE_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".css",
  ".csv",
  ".gif",
  ".go",
  ".h",
  ".html",
  ".java",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".m4a",
  ".md",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".wav",
  ".webm",
  ".yaml",
  ".yml",
]);

type DatafortAttachmentIndexResult = {
  indexedPaths: string[];
  removedPaths: string[];
};

export type DatafortAttachmentSearchResult = {
  attachmentId: string;
  chunkIndex: number;
  contentHash: string;
  excerpt: string;
  filename: string;
  lexicalRank: number;
  path: string;
};

function inside(rootPath: string, candidatePath: string) {
  const path = relative(rootPath, candidatePath);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function mimeType(path: string) {
  const types: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".m4a": "audio/mp4",
    ".md": "text/markdown",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".webm": "video/webm",
  };
  return types[extname(path).toLocaleLowerCase()] ?? "text/plain";
}

function attachmentId(workspaceId: string, path: string) {
  return `datafort_attachment_${createHash("sha256")
    .update(`${workspaceId}\0${path}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export async function syncDatafortAttachmentIndex(
  client: Database.Database,
  input: {
    attachmentDirectory: string;
    paths: string[];
    rootPath: string;
    workspaceId: string;
  },
): Promise<DatafortAttachmentIndexResult> {
  const rootPath = resolve(input.rootPath);
  const attachmentDirectory = input.attachmentDirectory.replaceAll("\\", "/");
  const present: Array<{
    byteSize: number;
    content: string;
    contentHash: string;
    filename: string;
    mimeType: string;
    path: string;
  }> = [];
  const removedPaths: string[] = [];
  const seen = new Set<string>();

  for (const requestedPath of [...new Set(input.paths)]) {
    const candidate = resolve(rootPath, requestedPath);
    if (!inside(rootPath, candidate)) continue;
    const path = relative(rootPath, candidate).split("\\").join("/");
    if (
      path === attachmentDirectory ||
      !path.startsWith(`${attachmentDirectory}/`) ||
      seen.has(path)
    )
      continue;
    seen.add(path);
    const info = await lstat(candidate).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_INDEXED_BYTES) {
      removedPaths.push(path);
      continue;
    }
    const extension = extname(path).toLocaleLowerCase();
    if (!INDEXABLE_EXTENSIONS.has(extension)) continue;
    const bytes = await readFile(candidate).catch(() => null);
    if (!bytes || bytes.byteLength > MAX_INDEXED_BYTES) {
      removedPaths.push(path);
      continue;
    }
    const filename = path.split("/").at(-1) ?? path;
    const content = bytes.includes(0)
      ? `${path}\n${filename}`
      : `${path}\n${bytes.toString("utf8")}`;
    present.push({
      byteSize: bytes.byteLength,
      content,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      filename,
      mimeType: mimeType(path),
      path,
    });
  }

  const transaction = client.transaction(() => {
    const deleteFts = client.prepare(
      "DELETE FROM datafort_attachments_fts WHERE attachment_id = ?",
    );
    const deleteAttachment = client.prepare(
      "DELETE FROM datafort_attachments WHERE workspace_id = ? AND path = ?",
    );
    const selectId = client.prepare(
      "SELECT id FROM datafort_attachments WHERE workspace_id = ? AND path = ?",
    );
    const upsert = client.prepare(`
      INSERT INTO datafort_attachments
        (id, workspace_id, path, filename, mime_type, sha256, byte_size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, path) DO UPDATE SET
        filename = excluded.filename,
        mime_type = excluded.mime_type,
        sha256 = excluded.sha256,
        byte_size = excluded.byte_size,
        updated_at = excluded.updated_at
    `);
    const insertFts = client.prepare(
      "INSERT INTO datafort_attachments_fts (attachment_id, workspace_id, content) VALUES (?, ?, ?)",
    );
    const now = Date.now();
    for (const item of present) {
      const id = attachmentId(input.workspaceId, item.path);
      deleteFts.run(id);
      upsert.run(
        id,
        input.workspaceId,
        item.path,
        item.filename,
        item.mimeType,
        item.contentHash,
        item.byteSize,
        now,
        now,
      );
      insertFts.run(id, input.workspaceId, item.content);
    }
    for (const path of removedPaths) {
      const row = selectId.get(input.workspaceId, path) as { id: string } | undefined;
      if (row) deleteFts.run(row.id);
      deleteAttachment.run(input.workspaceId, path);
    }
  });
  transaction();
  return {
    indexedPaths: present.map((item) => item.path),
    removedPaths,
  };
}

export function searchDatafortAttachmentsDetailed(
  client: Database.Database,
  workspaceId: string,
  query: string,
  limit = 20,
) {
  if (!query.trim()) return [];
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
  const rows = client
    .prepare(
      `SELECT f.attachment_id AS attachmentId, f.content AS excerpt,
              a.filename, a.path, a.sha256 AS contentHash
       FROM datafort_attachments_fts f
       JOIN datafort_attachments a ON a.id = f.attachment_id
       WHERE f.workspace_id = ? AND datafort_attachments_fts MATCH ?
       ORDER BY rank, a.path
       LIMIT ?`,
    )
    .all(workspaceId, ftsQuery, limit) as Array<
    Omit<DatafortAttachmentSearchResult, "chunkIndex" | "lexicalRank">
  >;
  return rows.map((row) => ({ ...row, chunkIndex: 0, lexicalRank: 1 }));
}
