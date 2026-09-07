// MIT License — Copyright (c) 2026 Mateus Gaio

import type Database from "better-sqlite3";
import type { EmbeddingState } from "./embeddings.js";

type EmbeddingSource = "attachment" | "vault";

type EmbeddingSourceState = {
  errorCode: string | null;
  source: EmbeddingSource;
  state: EmbeddingState;
  updatedAt: number | null;
  workspaceId: string;
};

export function getEmbeddingSourceState(
  client: Database.Database,
  workspaceId: string,
  source: EmbeddingSource,
): EmbeddingSourceState {
  const row = client
    .prepare(
      `SELECT workspace_id AS workspaceId, source, state,
              error_code AS errorCode, updated_at AS updatedAt
       FROM workspace_embedding_states
       WHERE workspace_id = ? AND source = ?`,
    )
    .get(workspaceId, source) as EmbeddingSourceState | undefined;
  return (
    row ?? {
      errorCode: null,
      source,
      state: "unconfigured",
      updatedAt: null,
      workspaceId,
    }
  );
}

export function setEmbeddingSourceState(
  client: Database.Database,
  workspaceId: string,
  source: EmbeddingSource,
  state: EmbeddingState,
  errorCode: string | null,
) {
  client
    .prepare(
      `INSERT INTO workspace_embedding_states
         (workspace_id, source, state, error_code, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, source) DO UPDATE SET
         state = excluded.state,
         error_code = excluded.error_code,
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId, source, state, errorCode, Date.now());
}
