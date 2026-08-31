// MIT License — Copyright (c) 2026 Mateus Gaio

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type ArtifactOperation = "created" | "modified" | "deleted";

type SessionArtifact = {
  firstSeenAt: number;
  lastSeenAt: number;
  operation: ArtifactOperation;
  path: string;
};

export type ArtifactCounts = {
  created: number;
  deleted: number;
  modified: number;
};

function emptyArtifactCounts(): ArtifactCounts {
  return { created: 0, deleted: 0, modified: 0 };
}

function validRelativePath(path: string) {
  const normalized = path.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes(".."))
    return null;
  return normalized;
}

export function recordSessionArtifacts(
  client: Database.Database,
  input: {
    artifacts: Array<{ operation: ArtifactOperation; path: string }>;
    sessionId?: string | null;
    workspaceId: string;
  },
): ArtifactCounts {
  const counts = emptyArtifactCounts();
  if (!input.sessionId || input.artifacts.length === 0) return counts;
  const session = client
    .prepare("SELECT workspace_id AS workspaceId FROM sessions WHERE id = ?")
    .get(input.sessionId) as { workspaceId: string | null } | undefined;
  if (!session || session.workspaceId !== input.workspaceId) return counts;

  const latest = new Map<string, ArtifactOperation>();
  for (const artifact of input.artifacts) {
    const path = validRelativePath(artifact.path);
    if (path) latest.set(path, artifact.operation);
  }
  if (!latest.size) return counts;
  const now = Date.now();
  const transaction = client.transaction(() => {
    const upsert = client.prepare(`
      INSERT INTO session_artifacts
        (id, session_id, workspace_id, path, operation, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, workspace_id, path) DO UPDATE SET
        operation = excluded.operation,
        last_seen_at = excluded.last_seen_at
    `);
    for (const [path, operation] of latest) {
      upsert.run(randomUUID(), input.sessionId, input.workspaceId, path, operation, now, now);
      counts[operation] += 1;
    }
  });
  transaction();
  return counts;
}

export function listSessionArtifacts(
  client: Database.Database,
  workspaceId: string,
  sessionId: string,
): SessionArtifact[] | null {
  const session = client
    .prepare("SELECT workspace_id AS workspaceId FROM sessions WHERE id = ?")
    .get(sessionId) as { workspaceId: string | null } | undefined;
  if (!session || session.workspaceId !== workspaceId) return null;
  return client
    .prepare(
      `SELECT first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
              operation, path
       FROM session_artifacts
       WHERE workspace_id = ? AND session_id = ?
       ORDER BY last_seen_at DESC, path ASC`,
    )
    .all(workspaceId, sessionId) as SessionArtifact[];
}
