// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { redactMemoryInput } from "./memory-intent.js";

type ExplicitCaptureInput = {
  content: string;
  profileId: string;
  requestId: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  sourceRevisionHash: string;
  turnMessageId: string;
};

function memoryIdempotencyKey(input: ExplicitCaptureInput) {
  return createHash("sha256")
    .update(
      [
        input.profileId,
        input.workspaceId ?? "unassigned",
        input.sessionId ?? "",
        input.turnMessageId,
        input.sourceRevisionHash,
        "explicit",
        "v1",
      ].join("\0"),
    )
    .digest("hex");
}

export function enqueueExplicitCapture(client: Database.Database, input: ExplicitCaptureInput) {
  const idempotencyKey = memoryIdempotencyKey(input);
  const id = randomUUID();
  const now = Date.now();
  client
    .prepare(`
      INSERT INTO memory_capture_jobs
        (id, idempotency_key, profile_id, workspace_id, session_id, request_id, turn_message_id,
         source_revision_hash, trigger, priority, input_json, status, attempts, available_at,
         pipeline_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'explicit', 100, ?, 'pending', 0, ?, 'v1', ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `)
    .run(
      id,
      idempotencyKey,
      input.profileId,
      input.workspaceId ?? null,
      input.sessionId ?? null,
      input.requestId,
      input.turnMessageId,
      input.sourceRevisionHash,
      JSON.stringify({ content: redactMemoryInput(input.content) }),
      now,
      now,
      now,
    );
  const row = client
    .prepare("SELECT id, status FROM memory_capture_jobs WHERE idempotency_key = ?")
    .get(idempotencyKey) as { id: string; status: string };
  return { ...row, idempotencyKey, inserted: row.id === id };
}
