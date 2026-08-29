// MIT License — Copyright (c) 2026 Mateus Gaio

import type Database from "better-sqlite3";
import {
  createSessionRun,
  finishSessionRun,
  type RequestTerminal,
  type SessionRunSnapshot,
  type SessionRunState,
  transitionSessionRun,
} from "./session-processor.js";

type RunRow = {
  request_id: string;
  state: SessionRunState;
  terminal: RequestTerminal | null;
};

export function createRunStore(client: Database.Database) {
  const snapshots = new Map<string, SessionRunSnapshot>();

  function start(input: {
    requestId: string;
    sessionId?: string | null;
    workspaceId?: string | null;
    profileId?: string | null;
  }) {
    const existing = client
      .prepare("SELECT terminal FROM chat_runs WHERE request_id = ?")
      .get(input.requestId) as { terminal: RequestTerminal | null } | undefined;
    if (existing) {
      const error = new Error(
        existing.terminal
          ? "requestId já possui uma run terminal."
          : "requestId já possui uma run em andamento.",
      ) as Error & { code?: string };
      error.code = existing.terminal ? "RUN_TERMINAL" : "RUN_ACTIVE";
      throw error;
    }
    const snapshot = createSessionRun(input.requestId);
    client
      .prepare(
        `INSERT INTO chat_runs
          (request_id, session_id, workspace_id, profile_id, state, terminal, started_at, updated_at)
         VALUES (@requestId, @sessionId, @workspaceId, @profileId, 'busy', NULL, @now, @now)
         ON CONFLICT(request_id) DO NOTHING`,
      )
      .run({
        now: Date.now(),
        profileId: input.profileId ?? null,
        requestId: input.requestId,
        sessionId: input.sessionId ?? null,
        workspaceId: input.workspaceId ?? null,
      });
    snapshots.set(input.requestId, snapshot);
    return snapshot;
  }

  function transition(requestId: string, state: SessionRunState) {
    const current = snapshots.get(requestId) ?? read(requestId);
    if (!current) return null;
    const next = transitionSessionRun(current, state);
    snapshots.set(requestId, next);
    client
      .prepare(
        "UPDATE chat_runs SET state = ?, updated_at = ? WHERE request_id = ? AND terminal IS NULL",
      )
      .run(state, Date.now(), requestId);
    return next;
  }

  /** Persiste o terminal antes de o chamador publicar a projeção no socket. */
  function finish(requestId: string, terminal: RequestTerminal, payload: unknown) {
    const current = snapshots.get(requestId) ?? read(requestId);
    if (!current) return false;
    const result = finishSessionRun(current, terminal);
    if (!result.accepted) return false;
    const now = Date.now();
    const transaction = client.transaction(() => {
      const event = client
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
             FROM chat_run_events WHERE request_id = ?`,
        )
        .get(requestId) as { sequence: number };
      const updated = client
        .prepare(
          `UPDATE chat_runs
             SET state = ?, terminal = ?, terminal_event_sequence = ?, updated_at = ?
           WHERE request_id = ? AND terminal IS NULL`,
        )
        .run(result.snapshot.state, terminal, event.sequence, now, requestId);
      if (updated.changes !== 1) return false;
      client
        .prepare(
          `INSERT INTO chat_run_events
            (request_id, sequence, type, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(requestId, event.sequence, `chat.${terminal}`, JSON.stringify(payload), now);
      return true;
    });
    if (!transaction()) return false;
    snapshots.set(requestId, result.snapshot);
    return true;
  }

  function read(requestId: string): SessionRunSnapshot | null {
    const row = client
      .prepare("SELECT request_id, state, terminal FROM chat_runs WHERE request_id = ?")
      .get(requestId) as RunRow | undefined;
    if (!row) return null;
    const snapshot = {
      requestId: row.request_id,
      state: row.state,
      terminal: row.terminal,
    } satisfies SessionRunSnapshot;
    snapshots.set(requestId, snapshot);
    return snapshot;
  }

  function recoverInterruptedRuns() {
    const result = client
      .prepare(
        `UPDATE chat_runs
            SET state = 'idle', terminal = 'cancelled', updated_at = ?
          WHERE terminal IS NULL AND state IN ('busy', 'retrying', 'waiting_permission', 'compacting', 'stopping')`,
      )
      .run(Date.now());
    client
      .prepare(
        "UPDATE approvals SET status = 'cancelled', resolved_at = ? WHERE status = 'pending'",
      )
      .run(Date.now());
    return result.changes;
  }

  return { finish, read, recoverInterruptedRuns, start, transition };
}
