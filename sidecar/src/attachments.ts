// MIT License — Copyright (c) 2026 Mateus Gaio
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { PDFParse } from "pdf-parse";
import { dataDirectory, openSharedDatabase } from "./db/database.js";
import { attachments, sessions } from "./db/schema.js";
import { chunkText } from "./embedding-chunks.js";

const maxAttachmentBytes = 10 * 1024 * 1024;
const maxAttachmentTextPreviewBytes = 1 * 1024 * 1024;
const maxAttachmentPdfPreviewBytes = 25 * 1024 * 1024;
const allowedExtensions = new Set([
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
  ".jsx",
  ".md",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
  ".pdf",
]);

export type AttachmentInput = {
  contentBase64: string;
  filename: string;
  mimeType?: string;
  sessionId?: string | null;
  workspaceId: string;
};

type AttachmentSearchResult = {
  attachmentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
};

export type AttachmentLexicalSearchResult = {
  attachmentId: string;
  chunkIndex: number;
  contentHash: string;
  excerpt: string;
  filename: string;
  lexicalRank: number;
};

type AttachmentLifecycleHooks = {
  onCommitted?: (event: { attachmentId: string; workspaceId: string }) => void | Promise<void>;
  onRemoved?: (event: { attachmentId: string; workspaceId: string }) => void | Promise<void>;
};

export class AttachmentPreviewError extends Error {
  constructor(
    readonly code:
      | "ATTACHMENT_NOT_FOUND"
      | "ATTACHMENT_UNAVAILABLE"
      | "ATTACHMENT_FILE_UNSUPPORTED"
      | "ATTACHMENT_FILE_TOO_LARGE"
      | "ATTACHMENT_FILE_BINARY",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AttachmentPreviewError";
  }
}

async function extractText(filename: string, mimeType: string, buffer: Buffer) {
  if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  return buffer.toString("utf8");
}

export async function saveAttachment(
  input: AttachmentInput,
  storageDirectory = dataDirectory(),
  hooks: AttachmentLifecycleHooks = {},
) {
  const filename = basename(input.filename);
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!filename || !allowedExtensions.has(extension)) {
    throw new Error("Este tipo de arquivo não pode ser indexado localmente.");
  }
  const buffer = Buffer.from(input.contentBase64, "base64");
  if (buffer.byteLength > maxAttachmentBytes) {
    throw new Error("O anexo excede o limite local de 10 MB.");
  }
  const database = openSharedDatabase(storageDirectory);
  const workspace = database.client
    .prepare("SELECT id FROM workspaces WHERE id = ?")
    .get(input.workspaceId);
  if (!workspace) {
    database.close();
    throw new Error("O workspace do anexo não existe.");
  }
  if (input.sessionId) {
    const session = database.db
      .select({ workspaceId: sessions.workspaceId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .get();
    if (!session || session.workspaceId !== input.workspaceId) {
      database.close();
      throw new Error("A sessão do anexo não pertence ao workspace informado.");
    }
  }
  const id = randomUUID();
  const storedDirectory = join(storageDirectory, "attachments", input.workspaceId, id);
  const storedPath = join(storedDirectory, filename);
  const timestamp = Date.now();
  try {
    await mkdir(storedDirectory, { recursive: true, mode: 0o700 });
    await writeFile(storedPath, buffer, { mode: 0o600 });
    const content = await extractText(filename, input.mimeType ?? "text/plain", buffer);
    database.db
      .insert(attachments)
      .values({
        byteSize: buffer.byteLength,
        createdAt: timestamp,
        filename,
        id,
        mimeType: input.mimeType ?? "text/plain",
        sessionId: input.sessionId ?? null,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        status: "indexed",
        storedPath,
        updatedAt: timestamp,
        workspaceId: input.workspaceId,
      })
      .run();
    const insertChunk = database.client.prepare(
      "INSERT INTO attachments_fts (attachment_id, chunk_index, content) VALUES (?, ?, ?)",
    );
    const addChunks = database.client.transaction(() => {
      chunkText(content).forEach((chunk, chunkIndex) => {
        insertChunk.run(id, chunkIndex, chunk);
      });
    });
    addChunks();
    await Promise.resolve(
      hooks.onCommitted?.({ attachmentId: id, workspaceId: input.workspaceId }),
    ).catch(() => undefined);
    return { byteSize: buffer.byteLength, filename, id, status: "indexed" };
  } catch (error) {
    await unlink(storedPath).catch(() => undefined);
    throw error;
  } finally {
    database.close();
  }
}

export async function searchAttachments(
  workspaceId: string,
  query: string,
  storageDirectory = dataDirectory(),
): Promise<AttachmentSearchResult[]> {
  if (!query.trim()) return [];
  const database = openSharedDatabase(storageDirectory);
  try {
    return database.client
      .prepare(
        "SELECT f.attachment_id AS attachmentId, f.chunk_index AS chunkIndex, f.content, a.filename FROM attachments_fts f JOIN attachments a ON a.id = f.attachment_id WHERE a.workspace_id = ? AND attachments_fts MATCH ? ORDER BY rank LIMIT 20",
      )
      .all(workspaceId, `"${query.replaceAll('"', '""')}"*`) as AttachmentSearchResult[];
  } finally {
    database.close();
  }
}

export function searchAttachmentsDetailed(
  client: Database.Database,
  workspaceId: string,
  query: string,
  limit = 20,
): AttachmentLexicalSearchResult[] {
  if (!query.trim()) return [];
  const rows = client
    .prepare(
      `SELECT f.attachment_id AS attachmentId, f.chunk_index AS chunkIndex,
              f.content AS excerpt, a.filename, a.sha256 AS contentHash
       FROM attachments_fts f
       JOIN attachments a ON a.id = f.attachment_id
       WHERE a.workspace_id = ? AND attachments_fts MATCH ?
       ORDER BY rank, f.attachment_id, f.chunk_index
       LIMIT ?`,
    )
    .all(workspaceId, `"${query.replaceAll('"', '""')}"*`, limit) as Array<
    Omit<AttachmentLexicalSearchResult, "lexicalRank">
  >;
  return rows.map((row, index) => ({ ...row, lexicalRank: index + 1 }));
}

export async function listAttachments(
  workspaceId: string,
  sessionId?: string | null,
  storageDirectory = dataDirectory(),
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const rows = database.client
      .prepare(
        "SELECT id, filename, mime_type AS mimeType, byte_size AS byteSize, status, created_at AS createdAt FROM attachments WHERE workspace_id = ? AND (? IS NULL OR session_id = ? OR session_id IS NULL) ORDER BY created_at DESC",
      )
      .all(workspaceId, sessionId ?? null, sessionId ?? null) as Array<{
      byteSize: number;
      createdAt: number;
      filename: string;
      id: string;
      mimeType: string;
      status: string;
    }>;
    return rows;
  } finally {
    database.close();
  }
}

export async function removeAttachment(
  id: string,
  storageDirectory = dataDirectory(),
  hooks: AttachmentLifecycleHooks = {},
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const attachment = database.db.select().from(attachments).where(eq(attachments.id, id)).get();
    if (!attachment) throw new Error("O anexo selecionado não existe.");
    database.client.prepare("DELETE FROM attachments_fts WHERE attachment_id = ?").run(id);
    database.db.delete(attachments).where(eq(attachments.id, id)).run();
    await unlink(attachment.storedPath).catch(() => undefined);
    await Promise.resolve(
      hooks.onRemoved?.({ attachmentId: id, workspaceId: attachment.workspaceId }),
    ).catch(() => undefined);
    return { id };
  } finally {
    database.close();
  }
}

export async function readAttachmentContent(
  workspaceId: string,
  attachmentId: string,
  storageDirectory = dataDirectory(),
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const attachment = database.client
      .prepare(
        `SELECT filename, mime_type AS mimeType, stored_path AS storedPath
         FROM attachments WHERE id = ? AND workspace_id = ?`,
      )
      .get(attachmentId, workspaceId) as
      | { filename: string; mimeType: string; storedPath: string }
      | undefined;
    if (!attachment) {
      throw new AttachmentPreviewError(
        "ATTACHMENT_NOT_FOUND",
        "O anexo solicitado não existe neste workspace.",
        404,
      );
    }
    const isPdf =
      attachment.mimeType === "application/pdf" ||
      attachment.filename.toLowerCase().endsWith(".pdf");
    const info = await lstat(attachment.storedPath).catch(() => null);
    if (!info?.isFile()) {
      throw new AttachmentPreviewError(
        "ATTACHMENT_UNAVAILABLE",
        "O conteúdo do anexo não está disponível para preview.",
        404,
      );
    }
    const maxBytes = isPdf ? maxAttachmentPdfPreviewBytes : maxAttachmentTextPreviewBytes;
    if (info.size > maxBytes) {
      throw new AttachmentPreviewError(
        "ATTACHMENT_FILE_TOO_LARGE",
        isPdf
          ? "O PDF do anexo excede o limite de preview de 25 MiB."
          : "O anexo excede o limite de preview de texto de 1 MiB.",
        413,
      );
    }
    const bytes = await readFile(attachment.storedPath).catch(() => null);
    if (!bytes) {
      throw new AttachmentPreviewError(
        "ATTACHMENT_UNAVAILABLE",
        "O conteúdo do anexo não está disponível para preview.",
        404,
      );
    }
    if (bytes.byteLength > maxBytes) {
      throw new AttachmentPreviewError(
        "ATTACHMENT_FILE_TOO_LARGE",
        isPdf
          ? "O PDF do anexo excede o limite de preview de 25 MiB."
          : "O anexo excede o limite de preview de texto de 1 MiB.",
        413,
      );
    }
    if (!isPdf && bytes.includes(0)) {
      throw new AttachmentPreviewError(
        "ATTACHMENT_FILE_BINARY",
        "O anexo parece binário e não pode ser exibido com segurança.",
        415,
      );
    }
    return {
      bytes,
      filename: attachment.filename,
      isPdf,
      mimeType: isPdf ? "application/pdf" : "text/plain; charset=utf-8",
    };
  } finally {
    database.close();
  }
}
