// MIT License — Copyright (c) 2026 Mateus Gaio

import type Database from "better-sqlite3";
import { getEmbeddingSourceState, setEmbeddingSourceState } from "./embedding-state.js";
import { sanitizeEmbeddingErrorCode } from "./embeddings.js";
import {
  attachmentEmbeddingTableName,
  EmbeddingServiceError,
  type VaultEmbeddingService,
} from "./vault-embeddings.js";

type AttachmentChunkRow = {
  attachmentId: string;
  chunkIndex: number;
  contentHash: string;
  filename: string;
  text: string;
};

type AttachmentVectorRow = AttachmentChunkRow & {
  model: string;
  vector: number[];
  workspaceId: string;
};

type AttachmentEmbeddingSyncResult = {
  errorCode: string | null;
  state: ReturnType<typeof getEmbeddingSourceState>["state"];
  totalAttachments: number;
  vectorsDeleted: number;
  vectorsWritten: number;
};

function attachmentChunks(client: Database.Database, workspaceId: string, attachmentId?: string) {
  const filter = attachmentId ? " AND f.attachment_id = ?" : "";
  return client
    .prepare(
      `SELECT f.attachment_id AS attachmentId, f.chunk_index AS chunkIndex,
              a.filename, a.sha256 AS contentHash, f.content AS text
       FROM attachments_fts f
       JOIN attachments a ON a.id = f.attachment_id
       WHERE a.workspace_id = ?${filter}
       ORDER BY f.attachment_id, f.chunk_index`,
    )
    .all(workspaceId, ...(attachmentId ? [attachmentId] : [])) as AttachmentChunkRow[];
}

function totalAttachments(client: Database.Database, workspaceId: string) {
  return (
    client
      .prepare("SELECT COUNT(*) AS count FROM attachments WHERE workspace_id = ?")
      .get(workspaceId) as { count: number }
  ).count;
}

function vectorRows(
  workspaceId: string,
  model: string,
  chunks: AttachmentChunkRow[],
  vectors: number[][],
) {
  if (chunks.length !== vectors.length) {
    throw new EmbeddingServiceError(
      "embedding_count_invalid",
      "Os vetores retornados estão incompletos.",
    );
  }
  return chunks.map((chunk, index) => ({
    ...chunk,
    model,
    vector: vectors[index] as number[],
    workspaceId,
  })) satisfies AttachmentVectorRow[];
}

function failure(error: unknown, message: string) {
  return new EmbeddingServiceError(
    sanitizeEmbeddingErrorCode(error),
    message,
    error instanceof EmbeddingServiceError ? error.status : 503,
  );
}

export class AttachmentEmbeddingService {
  constructor(
    private readonly client: Database.Database,
    private readonly embeddings: VaultEmbeddingService,
  ) {}

  getState(workspaceId: string) {
    return getEmbeddingSourceState(this.client, workspaceId, "attachment");
  }

  async reindex(workspaceId: string): Promise<AttachmentEmbeddingSyncResult> {
    const tableName = attachmentEmbeddingTableName(workspaceId);
    return this.embeddings.enqueueWorkspace(workspaceId, async () => {
      const config = await this.embeddings.getConfig(workspaceId);
      if (!config.provider) {
        throw new EmbeddingServiceError(
          "embedding_config_required",
          "Configure um provedor e um modelo antes de reindexar os embeddings.",
          400,
        );
      }
      setEmbeddingSourceState(this.client, workspaceId, "attachment", "indexing", null);
      let vectorsDeleted = 0;
      try {
        vectorsDeleted = await this.embeddings.countNamedRows(tableName);
        await this.embeddings.discardNamedTable(tableName);
        const chunks = attachmentChunks(this.client, workspaceId);
        if (!chunks.length) {
          setEmbeddingSourceState(this.client, workspaceId, "attachment", "ready", null);
          return {
            errorCode: null,
            state: "ready",
            totalAttachments: totalAttachments(this.client, workspaceId),
            vectorsDeleted,
            vectorsWritten: 0,
          };
        }
        const vectors = await this.embeddings.embedTexts(
          workspaceId,
          chunks.map((chunk) => chunk.text),
        );
        const rows = vectorRows(workspaceId, config.model, chunks, vectors);
        await this.embeddings.createNamedTable(
          tableName,
          rows as unknown as Record<string, unknown>[],
        );
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "ready", null);
        return {
          errorCode: null,
          state: "ready",
          totalAttachments: totalAttachments(this.client, workspaceId),
          vectorsDeleted,
          vectorsWritten: rows.length,
        };
      } catch (error) {
        await this.embeddings.discardNamedTable(tableName).catch(() => undefined);
        const safe = failure(error, "Não foi possível gravar os embeddings dos anexos.");
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "error", safe.code);
        throw safe;
      }
    });
  }

  async syncAttachment(workspaceId: string, attachmentId: string) {
    const tableName = attachmentEmbeddingTableName(workspaceId);
    return this.embeddings.enqueueWorkspace(workspaceId, async () => {
      const config = await this.embeddings.getConfig(workspaceId);
      const vectorsDeleted = await this.embeddings.deleteNamedRows(
        tableName,
        "attachmentId",
        attachmentId,
        Boolean(config.provider),
      );
      const chunks = attachmentChunks(this.client, workspaceId, attachmentId);
      if (!config.provider) {
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "unconfigured", null);
        return {
          errorCode: null,
          state: "unconfigured",
          totalAttachments: totalAttachments(this.client, workspaceId),
          vectorsDeleted,
          vectorsWritten: 0,
        } satisfies AttachmentEmbeddingSyncResult;
      }
      if (!chunks.length) {
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "ready", null);
        return {
          errorCode: null,
          state: "ready",
          totalAttachments: totalAttachments(this.client, workspaceId),
          vectorsDeleted,
          vectorsWritten: 0,
        } satisfies AttachmentEmbeddingSyncResult;
      }
      setEmbeddingSourceState(this.client, workspaceId, "attachment", "indexing", null);
      try {
        const vectors = await this.embeddings.embedTexts(
          workspaceId,
          chunks.map((chunk) => chunk.text),
        );
        const rows = vectorRows(workspaceId, config.model, chunks, vectors);
        await this.embeddings.addNamedRows(tableName, rows as unknown as Record<string, unknown>[]);
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "ready", null);
        return {
          errorCode: null,
          state: "ready",
          totalAttachments: totalAttachments(this.client, workspaceId),
          vectorsDeleted,
          vectorsWritten: rows.length,
        } satisfies AttachmentEmbeddingSyncResult;
      } catch (error) {
        const safe = failure(error, "Não foi possível atualizar os embeddings dos anexos.");
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "error", safe.code);
        throw safe;
      }
    });
  }
}
