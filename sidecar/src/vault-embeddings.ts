// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Connection, Table } from "@lancedb/lancedb";
import * as lancedb from "@lancedb/lancedb";
import type Database from "better-sqlite3";
import { chunkVaultObject } from "./embedding-chunks.js";
import { setEmbeddingSourceState } from "./embedding-state.js";
import {
  createEmbeddingAdapter,
  type EmbeddingAdapter,
  EmbeddingAdapterError,
  type EmbeddingConfig,
  type EmbeddingProviderKind,
  type EmbeddingState,
  type EmbeddingSyncResult,
  type FetchLike,
  sanitizeEmbeddingErrorCode,
  validateEmbeddingConfigInput,
} from "./embeddings.js";
import { decryptSecret, encryptSecret, hasSecret, removeSecret } from "./secrets.js";

const TABLE_PREFIX = "vault_workspace_";
const ATTACHMENT_TABLE_PREFIX = "attachment_workspace_";

export { chunkVaultObject, EMBEDDING_CHUNK_SIZE } from "./embedding-chunks.js";

type StoredConfigRow = {
  createdAt: number;
  dimension: number | null;
  errorCode: string | null;
  model: string;
  providerKind: EmbeddingProviderKind;
  state: EmbeddingState;
  updatedAt: number;
  url: string;
  workspaceId: string;
};

type EmbeddingConfigInput = {
  dimension?: unknown;
  key?: unknown;
  model?: unknown;
  provider?: unknown;
  url?: unknown;
};

type VaultObjectRow = {
  body: string;
  contentHash: string;
  objectId: string;
  path: string;
  title: string;
};

type VectorRow = Record<string, unknown> & {
  chunkIndex: number;
  contentHash: string;
  model: string;
  objectId: string;
  path: string;
  text: string;
  vector: number[];
  workspaceId: string;
};

type ConnectLike = typeof lancedb.connect;

function embeddingSecretName(workspaceId: string) {
  return `embedding:${createHash("sha256")
    .update(`blackwall:embedding-secret:v1:${workspaceId}`)
    .digest("hex")}`;
}

export function vaultEmbeddingTableName(workspaceId: string) {
  return `${TABLE_PREFIX}${createHash("sha256").update(workspaceId).digest("hex").slice(0, 32)}`;
}

export function attachmentEmbeddingTableName(workspaceId: string) {
  return `${ATTACHMENT_TABLE_PREFIX}${createHash("sha256").update(workspaceId).digest("hex").slice(0, 32)}`;
}

function vaultEmbeddingObjectId(workspaceId: string, path: string) {
  return `vault_${createHash("sha256").update(`${workspaceId}\0${path}`).digest("hex").slice(0, 32)}`;
}

function configFromRow(row: StoredConfigRow, hasKey: boolean): EmbeddingConfig {
  return {
    dimension: row.dimension,
    errorCode: row.errorCode,
    hasKey,
    model: row.model,
    provider: row.providerKind,
    state: row.state,
    url: row.url,
    workspaceId: row.workspaceId,
  };
}

function unconfiguredConfig(workspaceId: string): EmbeddingConfig {
  return {
    dimension: null,
    errorCode: null,
    hasKey: false,
    model: "",
    provider: null,
    state: "unconfigured",
    url: "",
    workspaceId,
  };
}

function readConfigRow(client: Database.Database, workspaceId: string) {
  return client
    .prepare(
      `SELECT workspace_id AS workspaceId, provider_kind AS providerKind, url, model,
              dimension, state, error_code AS errorCode,
              created_at AS createdAt, updated_at AS updatedAt
       FROM workspace_embedding_configs WHERE workspace_id = ?`,
    )
    .get(workspaceId) as StoredConfigRow | undefined;
}

async function publicConfig(
  client: Database.Database,
  workspaceId: string,
  storageDirectory: string,
) {
  const row = readConfigRow(client, workspaceId);
  if (!row) return unconfiguredConfig(workspaceId);
  return configFromRow(row, await hasSecret(storageDirectory, embeddingSecretName(workspaceId)));
}

function totalObjects(client: Database.Database, workspaceId: string) {
  return (
    client
      .prepare("SELECT COUNT(*) AS count FROM vault_objects WHERE workspace_id = ?")
      .get(workspaceId) as { count: number }
  ).count;
}

function vaultObjects(client: Database.Database, workspaceId: string, paths?: string[]) {
  const values = paths?.length ? paths : undefined;
  const where = values ? ` AND path IN (${values.map(() => "?").join(",")})` : "";
  return client
    .prepare(
      `SELECT row_id AS objectId, path, title, content_hash AS contentHash, body
       FROM vault_objects WHERE workspace_id = ?${where} ORDER BY path, row_id`,
    )
    .all(workspaceId, ...(values ?? [])) as VaultObjectRow[];
}

function updateState(
  client: Database.Database,
  workspaceId: string,
  state: EmbeddingState,
  errorCode: string | null,
  dimension?: number | null,
) {
  const updates = ["state = ?", "error_code = ?", "updated_at = ?"];
  const values: Array<string | number | null> = [state, errorCode, Date.now()];
  if (dimension !== undefined) {
    updates.push("dimension = ?");
    values.push(dimension);
  }
  values.push(workspaceId);
  client
    .prepare(`UPDATE workspace_embedding_configs SET ${updates.join(", ")} WHERE workspace_id = ?`)
    .run(...values);
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export class EmbeddingServiceError extends Error {
  readonly status: number;

  constructor(
    readonly code: string,
    message: string,
    status = 503,
  ) {
    super(message);
    this.name = "EmbeddingServiceError";
    this.status = status;
  }
}

export class VaultEmbeddingService {
  private readonly connectionFactory: ConnectLike;
  private connectionPromise: Promise<Connection> | undefined;
  private readonly tables = new Map<string, Table>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private closed = false;

  constructor(
    private readonly client: Database.Database,
    private readonly storageDirectory: string,
    private readonly request: FetchLike = fetch,
    connectionFactory: ConnectLike = lancedb.connect,
  ) {
    this.connectionFactory = connectionFactory;
  }

  async getConfig(workspaceId: string) {
    return publicConfig(this.client, workspaceId, this.storageDirectory);
  }

  async updateConfig(workspaceId: string, input: EmbeddingConfigInput) {
    return this.enqueue(workspaceId, async () => {
      if (typeof input.key !== "undefined" && input.key !== null && typeof input.key !== "string") {
        throw new EmbeddingServiceError(
          "embedding_key_invalid",
          "A chave de embeddings é inválida.",
          400,
        );
      }
      if (typeof input.key === "string" && input.key.length > 4_096) {
        throw new EmbeddingServiceError(
          "embedding_key_invalid",
          "A chave de embeddings é inválida.",
          400,
        );
      }
      let validated: ReturnType<typeof validateEmbeddingConfigInput>;
      try {
        validated = validateEmbeddingConfigInput(input);
      } catch (error) {
        throw new EmbeddingServiceError(
          sanitizeEmbeddingErrorCode(error),
          "A configuração do provedor de embeddings é inválida.",
          400,
        );
      }
      const current = readConfigRow(this.client, workspaceId);
      const changed =
        !current ||
        current.providerKind !== validated.provider ||
        current.url !== validated.url ||
        current.model !== validated.model ||
        (input.dimension !== undefined && current.dimension !== validated.dimension);
      if (changed) await this.discardWorkspaceTable(workspaceId);
      if (changed) {
        await this.discardNamedTable(attachmentEmbeddingTableName(workspaceId));
        setEmbeddingSourceState(this.client, workspaceId, "attachment", "stale", null);
      }

      const timestamp = Date.now();
      const nextDimension =
        input.dimension !== undefined
          ? validated.dimension
          : changed
            ? null
            : (current?.dimension ?? null);
      const nextState = changed ? "stale" : (current?.state ?? "stale");
      const nextError = changed ? null : (current?.errorCode ?? null);
      this.client
        .prepare(
          `INSERT INTO workspace_embedding_configs
             (workspace_id, provider_kind, url, model, dimension, state, error_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             provider_kind = excluded.provider_kind, url = excluded.url, model = excluded.model,
             dimension = excluded.dimension, state = excluded.state, error_code = excluded.error_code,
             updated_at = excluded.updated_at`,
        )
        .run(
          workspaceId,
          validated.provider,
          validated.url,
          validated.model,
          nextDimension,
          nextState,
          nextError,
          current?.createdAt ?? timestamp,
          timestamp,
        );

      if (input.key !== undefined) {
        if (input.key === null || !input.key.trim()) {
          await removeSecret(this.storageDirectory, embeddingSecretName(workspaceId));
        } else {
          await encryptSecret(
            this.storageDirectory,
            embeddingSecretName(workspaceId),
            input.key.trim(),
          );
        }
      }
      return publicConfig(this.client, workspaceId, this.storageDirectory);
    });
  }

  async reindex(workspaceId: string): Promise<EmbeddingSyncResult> {
    return this.enqueue(workspaceId, async () => {
      const config = readConfigRow(this.client, workspaceId);
      if (!config) {
        throw new EmbeddingServiceError(
          "embedding_config_required",
          "Configure um provedor e um modelo antes de reindexar os embeddings.",
          400,
        );
      }
      updateState(this.client, workspaceId, "indexing", null);
      await this.discardWorkspaceTable(workspaceId);
      const objects = vaultObjects(this.client, workspaceId);
      if (!objects.length) {
        updateState(this.client, workspaceId, "ready", null);
        return {
          errorCode: null,
          state: "ready",
          totalObjects: 0,
          vectorsDeleted: 0,
          vectorsWritten: 0,
        };
      }

      try {
        const chunks = objects.flatMap((object) => chunkVaultObject(object.title, object.body));
        const adapter = await this.adapter(config);
        const vectors = await adapter.embed(chunks);
        const rows = this.vectorRows(workspaceId, config.model, objects, vectors);
        await this.createTable(workspaceId, rows);
        const dimension = rows[0]?.vector.length ?? config.dimension;
        updateState(this.client, workspaceId, "ready", null, dimension);
        return {
          errorCode: null,
          state: "ready",
          totalObjects: objects.length,
          vectorsDeleted: 0,
          vectorsWritten: rows.length,
        };
      } catch (error) {
        await this.discardWorkspaceTable(workspaceId).catch(() => undefined);
        const code = sanitizeEmbeddingErrorCode(error);
        updateState(this.client, workspaceId, "error", code);
        throw new EmbeddingServiceError(
          code,
          "Não foi possível gravar os embeddings do Vault.",
          error instanceof EmbeddingServiceError
            ? error.status
            : error instanceof EmbeddingAdapterError
              ? (error.status ?? 503)
              : 503,
        );
      }
    });
  }

  async syncPaths(workspaceId: string, paths: string[]): Promise<EmbeddingSyncResult> {
    return this.enqueue(workspaceId, async () => {
      const config = readConfigRow(this.client, workspaceId);
      const normalizedPaths = [...new Set(paths)].sort();
      const table = await this.namedTable(
        vaultEmbeddingTableName(workspaceId),
        config?.state === "ready",
      );
      let vectorsDeleted = 0;
      if (table) {
        for (const path of normalizedPaths) {
          const objectId = vaultEmbeddingObjectId(workspaceId, path);
          vectorsDeleted += await table.countRows(`objectId = ${sqlString(objectId)}`);
          await table.delete(`objectId = ${sqlString(objectId)}`);
        }
      }
      const total = totalObjects(this.client, workspaceId);
      if (config?.state !== "ready" || !normalizedPaths.length) {
        return {
          errorCode: null,
          state: config?.state ?? "unconfigured",
          totalObjects: total,
          vectorsDeleted,
          vectorsWritten: 0,
        };
      }
      const objects = vaultObjects(this.client, workspaceId, normalizedPaths);
      if (!objects.length) {
        return {
          errorCode: null,
          state: "ready",
          totalObjects: total,
          vectorsDeleted,
          vectorsWritten: 0,
        };
      }
      try {
        const adapter = await this.adapter(config);
        const vectors = await adapter.embed(
          objects.flatMap((object) => chunkVaultObject(object.title, object.body)),
        );
        const rows = this.vectorRows(workspaceId, config.model, objects, vectors);
        await this.addRows(workspaceId, rows);
        return {
          errorCode: null,
          state: "ready",
          totalObjects: total,
          vectorsDeleted,
          vectorsWritten: rows.length,
        };
      } catch (error) {
        const code = sanitizeEmbeddingErrorCode(error);
        updateState(this.client, workspaceId, "error", code);
        throw new EmbeddingServiceError(
          code,
          "Não foi possível atualizar os embeddings do Vault.",
          error instanceof EmbeddingServiceError
            ? error.status
            : error instanceof EmbeddingAdapterError
              ? (error.status ?? 503)
              : 503,
        );
      }
    });
  }

  async embedTexts(workspaceId: string, texts: string[], signal?: AbortSignal) {
    const config = readConfigRow(this.client, workspaceId);
    if (!config) {
      throw new EmbeddingServiceError(
        "embedding_config_required",
        "Configure um provedor e um modelo antes de gerar embeddings.",
        400,
      );
    }
    try {
      return await (await this.adapter(config)).embed(texts, signal);
    } catch (error) {
      throw new EmbeddingServiceError(
        sanitizeEmbeddingErrorCode(error),
        "Não foi possível gerar embeddings.",
        error instanceof EmbeddingServiceError
          ? error.status
          : error instanceof EmbeddingAdapterError
            ? (error.status ?? 503)
            : 503,
      );
    }
  }

  async searchNamedTable(tableName: string, vector: number[], limit: number) {
    const table = await this.namedTable(tableName, true);
    if (!table) return [];
    return (await table.vectorSearch(vector).limit(limit).toArray()) as unknown[];
  }

  async countNamedRows(tableName: string) {
    const table = await this.namedTable(tableName, true);
    return table ? table.countRows() : 0;
  }

  async deleteNamedRows(tableName: string, column: string, value: string, openConnection = false) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) return 0;
    const table = await this.namedTable(tableName, openConnection);
    if (!table) return 0;
    const predicate = `${column} = ${sqlString(value)}`;
    const count = await table.countRows(predicate);
    await table.delete(predicate);
    return count;
  }

  async addNamedRows(tableName: string, rows: Record<string, unknown>[]) {
    if (!rows.length) return;
    const table = await this.namedTable(tableName, true);
    if (table) {
      await table.add(rows);
      return;
    }
    await this.createNamedTable(tableName, rows);
  }

  async createNamedTable(tableName: string, rows: Record<string, unknown>[]) {
    if (!rows.length) return;
    await mkdir(join(this.storageDirectory, "lancedb"), { recursive: true });
    const connection = await this.connection();
    const table = await connection.createTable(tableName, rows);
    this.tables.set(tableName, table);
  }

  async replaceNamedTable(tableName: string, rows: Record<string, unknown>[]) {
    await this.discardNamedTable(tableName);
    await this.createNamedTable(tableName, rows);
  }

  async discardNamedTable(tableName: string) {
    const table = this.tables.get(tableName);
    if (table) table.close();
    this.tables.delete(tableName);
    const connection = await this.connection();
    const names = await connection.tableNames();
    if (names.includes(tableName)) await connection.dropTable(tableName);
  }

  enqueueWorkspace<T>(workspaceId: string, task: () => Promise<T>) {
    return this.enqueue(workspaceId, task);
  }

  async discardWorkspaceTable(workspaceId: string) {
    await this.discardNamedTable(vaultEmbeddingTableName(workspaceId));
  }

  async close() {
    this.closed = true;
    for (const table of this.tables.values()) table.close();
    this.tables.clear();
    if (this.connectionPromise) {
      const connection = await this.connectionPromise.catch(() => undefined);
      connection?.close();
    }
    this.connectionPromise = undefined;
    this.queues.clear();
  }

  private async adapter(config: StoredConfigRow): Promise<EmbeddingAdapter> {
    let apiKey = "";
    try {
      apiKey = await decryptSecret(this.storageDirectory, embeddingSecretName(config.workspaceId));
    } catch {
      // Chaves são opcionais para Ollama e para endpoints que não exigem auth.
    }
    return createEmbeddingAdapter(
      {
        dimension: config.dimension,
        model: config.model,
        provider: config.providerKind,
        url: config.url,
      },
      { apiKey, request: this.request },
    );
  }

  private vectorRows(
    workspaceId: string,
    model: string,
    objects: VaultObjectRow[],
    vectors: number[][],
  ) {
    const rows: VectorRow[] = [];
    let vectorIndex = 0;
    for (const object of objects) {
      const chunks = chunkVaultObject(object.title, object.body);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const vector = vectors[vectorIndex];
        if (!vector) {
          throw new EmbeddingServiceError(
            "embedding_count_invalid",
            "Os vetores retornados estão incompletos.",
          );
        }
        rows.push({
          chunkIndex,
          contentHash: object.contentHash,
          model,
          objectId: object.objectId,
          path: object.path,
          text: chunks[chunkIndex],
          vector,
          workspaceId,
        });
        vectorIndex += 1;
      }
    }
    if (vectorIndex !== vectors.length)
      throw new EmbeddingServiceError(
        "embedding_count_invalid",
        "Os vetores retornados estão inválidos.",
      );
    return rows;
  }

  private async addRows(workspaceId: string, rows: VectorRow[]) {
    if (!rows.length) return;
    const table = await this.namedTable(vaultEmbeddingTableName(workspaceId), false);
    if (table) {
      await table.add(rows);
      return;
    }
    await this.createNamedTable(vaultEmbeddingTableName(workspaceId), rows);
  }

  private async createTable(workspaceId: string, rows: VectorRow[]) {
    await this.createNamedTable(vaultEmbeddingTableName(workspaceId), rows);
  }

  private async namedTable(tableName: string, openConnection = false) {
    const cached = this.tables.get(tableName);
    if (cached) return cached;
    const connection = openConnection
      ? await this.connection()
      : await this.connectionIfAvailable();
    if (!connection) return null;
    if (!(await connection.tableNames()).includes(tableName)) return null;
    const table = await connection.openTable(tableName);
    this.tables.set(tableName, table);
    return table;
  }

  private async connectionIfAvailable() {
    if (!this.connectionPromise) return null;
    return this.connectionPromise;
  }

  private async connection() {
    if (this.closed)
      throw new EmbeddingServiceError(
        "embedding_service_closed",
        "O runtime de embeddings foi encerrado.",
      );
    if (!this.connectionPromise) {
      this.connectionPromise = this.connectionFactory(join(this.storageDirectory, "lancedb")).catch(
        (_error) => {
          this.connectionPromise = undefined;
          throw new EmbeddingServiceError(
            "lancedb_connection_failed",
            "Não foi possível abrir o índice local.",
            500,
          );
        },
      );
    }
    return this.connectionPromise;
  }

  private enqueue<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.queues.set(workspaceId, current);
    const clear = () => {
      if (this.queues.get(workspaceId) === current) this.queues.delete(workspaceId);
    };
    void current.then(clear, clear);
    return current;
  }
}
