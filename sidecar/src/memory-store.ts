// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isMemorySourceEligible, redactMemoryInput } from "./memory-intent.js";
import {
  canAutoOrganizeProfile,
  type ExtractedMemoryCandidate,
  MEMORY_DISCLOSURE_VERSION,
  MEMORY_PIPELINE_VERSION,
  type MemoryScope,
  memoryIdempotencyKey,
  normalizedMemoryKey,
  profileSlotKey,
  sanitizeExtractedCandidate,
  sourceRevisionHash,
} from "./memory-policy.js";

type MemorySettings = {
  automaticEnabled: boolean;
  candidateRetentionDays: number;
  disclosureAcceptedAt: number | null;
  disclosureVersion: string | null;
  extractorMode: string;
  maxDailyJobs: number;
  pausedReason: string | null;
  profileId: string;
  revisionRetentionDays: number;
};

type AutomaticCaptureInput = {
  modelId: string;
  profileId: string;
  requestId: string;
  sessionId?: string | null;
  sourceContent: string;
  sourceProviderId: string;
  turnMessageId: string;
  workspaceId?: string | null;
};

export class MemoryProfileNotFoundError extends Error {
  constructor() {
    super("O perfil selecionado não existe.");
    this.name = "MemoryProfileNotFoundError";
  }
}

function safeErrorCode(value: unknown) {
  const code =
    typeof value === "string" ? value.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 64) : "memory_error";
  return code || "memory_error";
}

function hashMemory(input: {
  kind: string;
  statement: string;
  value: string;
  slotKey: string;
  status: string;
  pinned: boolean;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: input.kind,
        pinned: input.pinned,
        slotKey: input.slotKey,
        statement: input.statement,
        status: input.status,
        value: input.value,
      }),
    )
    .digest("hex");
}

function settingsFromRow(row: Record<string, unknown>): MemorySettings {
  return {
    automaticEnabled: Boolean(row.automatic_enabled),
    candidateRetentionDays: Number(row.candidate_retention_days ?? 30),
    disclosureAcceptedAt: (row.disclosure_accepted_at as number | null) ?? null,
    disclosureVersion: (row.disclosure_version as string | null) ?? null,
    extractorMode: String(row.extractor_mode ?? "same_session_model"),
    maxDailyJobs: Math.max(1, Math.min(100, Number(row.max_daily_jobs ?? 100))),
    pausedReason: (row.paused_reason as string | null) ?? null,
    profileId: String(row.profile_id),
    revisionRetentionDays: Number(row.revision_retention_days ?? 90),
  };
}

export function ensureMemorySettings(client: Database.Database, profileId: string) {
  const profile = client.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId);
  if (!profile) throw new MemoryProfileNotFoundError();
  const now = Date.now();
  client
    .prepare(
      `INSERT OR IGNORE INTO profile_memory_settings
        (profile_id, automatic_enabled, extractor_mode, max_daily_jobs,
         candidate_retention_days, revision_retention_days, created_at, updated_at)
       VALUES (?, 0, 'same_session_model', 100, 30, 90, ?, ?)`,
    )
    .run(profileId, now, now);
  return settingsFromRow(
    client
      .prepare("SELECT * FROM profile_memory_settings WHERE profile_id = ?")
      .get(profileId) as Record<string, unknown>,
  );
}

export function updateMemorySettings(
  client: Database.Database,
  profileId: string,
  input: {
    acceptDisclosure?: boolean;
    automaticEnabled: boolean;
    disclosureVersion?: string;
    maxDailyJobs?: number;
  },
) {
  const now = Date.now();
  const result = client.transaction(() => {
    const current = ensureMemorySettings(client, profileId);
    const maxDailyJobs = input.maxDailyJobs ?? current.maxDailyJobs;
    if (!Number.isInteger(maxDailyJobs) || maxDailyJobs < 1 || maxDailyJobs > 100)
      throw new Error("O limite diário deve estar entre 1 e 100.");
    const version = input.disclosureVersion ?? current.disclosureVersion;
    const accepted = input.acceptDisclosure === true && version === MEMORY_DISCLOSURE_VERSION;
    if (
      input.automaticEnabled &&
      !(accepted || (current.automaticEnabled && version === current.disclosureVersion))
    ) {
      const error = new Error(
        "Confirme o disclosure atual antes de ativar o aprendizado automático.",
      ) as Error & { code?: string };
      error.code = "DISCLOSURE_REQUIRED";
      throw error;
    }
    client
      .prepare(
        `UPDATE profile_memory_settings
            SET automatic_enabled = ?, max_daily_jobs = ?,
                disclosure_version = ?, disclosure_accepted_at = ?, paused_reason = ?, updated_at = ?
          WHERE profile_id = ?`,
      )
      .run(
        input.automaticEnabled ? 1 : 0,
        maxDailyJobs,
        accepted ? MEMORY_DISCLOSURE_VERSION : current.disclosureVersion,
        accepted ? now : current.disclosureAcceptedAt,
        input.automaticEnabled ? null : "user_disabled",
        now,
        profileId,
      );
    if (!input.automaticEnabled) {
      client
        .prepare(
          `UPDATE memory_capture_jobs
              SET status = 'cancelled', cancel_reason = 'automatic_disabled',
                  input_json = '{}', finished_at = ?, scrubbed_at = ?, updated_at = ?
            WHERE profile_id = ? AND trigger = 'automatic' AND pipeline_version = 'v2'
              AND status IN ('pending', 'running')`,
        )
        .run(now, now, now, profileId);
    }
    return ensureMemorySettings(client, profileId);
  })();
  return result;
}

function dailyJobCount(client: Database.Database, profileId: string, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Number(
    (
      client
        .prepare(
          `SELECT COUNT(*) AS count FROM memory_capture_jobs
          WHERE profile_id = ? AND trigger = 'automatic' AND pipeline_version = 'v2'
            AND created_at >= ?`,
        )
        .get(profileId, start.getTime()) as { count: number }
    ).count,
  );
}

export function enqueueAutomaticMemoryCaptureInTransaction(
  client: Database.Database,
  input: AutomaticCaptureInput,
) {
  if (!isMemorySourceEligible(input.sourceContent))
    return { inserted: false, reason: "ineligible" as const };
  if (!redactMemoryInput(input.sourceContent))
    return { inserted: false, reason: "redacted_empty" as const };
  const now = Date.now();
  const settings = ensureMemorySettings(client, input.profileId);
  if (!settings.automaticEnabled || settings.disclosureVersion !== MEMORY_DISCLOSURE_VERSION)
    return { inserted: false, reason: "disabled" as const };
  if (dailyJobCount(client, input.profileId, now) >= settings.maxDailyJobs)
    return { inserted: false, reason: "daily_limit" as const };
  const sourceHash = sourceRevisionHash(input.turnMessageId, input.sourceContent);
  const key = memoryIdempotencyKey({ ...input, sourceRevisionHash: sourceHash });
  const id = randomUUID();
  const inserted = client
    .prepare(
      `INSERT INTO memory_capture_jobs
        (id, idempotency_key, profile_id, workspace_id, session_id, request_id, turn_message_id,
         source_revision_hash, trigger, priority, input_json, status, attempts, available_at,
         source_provider_id, source_model_id, pipeline_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'automatic', 10, '{}', 'pending', 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .run(
      id,
      key,
      input.profileId,
      input.workspaceId ?? null,
      input.sessionId ?? null,
      input.requestId,
      input.turnMessageId,
      sourceHash,
      now,
      input.sourceProviderId,
      input.modelId,
      MEMORY_PIPELINE_VERSION,
      now,
      now,
    );
  const row = client
    .prepare("SELECT id, status FROM memory_capture_jobs WHERE idempotency_key = ?")
    .get(key) as { id: string; status: string };
  return { id: row.id, inserted: inserted.changes === 1, reason: "queued" as const };
}

export function enqueueAutomaticMemoryCapture(
  client: Database.Database,
  input: AutomaticCaptureInput,
) {
  return client.transaction(() => enqueueAutomaticMemoryCaptureInTransaction(client, input))();
}

export function listMemorySettings(client: Database.Database, profileId: string) {
  return ensureMemorySettings(client, profileId);
}

export function listProfileMemories(
  client: Database.Database,
  profileId: string,
  input: { limit?: number; offset?: number; status?: string } = {},
) {
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const status =
    input.status && ["organized", "captured", "archived"].includes(input.status)
      ? input.status
      : undefined;
  const rows = client
    .prepare(
      `SELECT id, profile_id AS profileId, kind, slot_key AS slotKey, value, normalized_key AS normalizedKey,
              statement, status, confidence, evidence_count AS evidenceCount, pinned,
              first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt,
              superseded_by AS supersededBy, reason_code AS reasonCode, revision_hash AS revisionHash,
              created_at AS createdAt, updated_at AS updatedAt
         FROM profile_memories WHERE profile_id = ? ${status ? "AND status = ?" : ""}
        ORDER BY pinned DESC, updated_at DESC, id LIMIT ? OFFSET ?`,
    )
    .all(...(status ? [profileId, status, limit, offset] : [profileId, limit, offset]));
  const total = Number(
    (
      client
        .prepare(
          `SELECT COUNT(*) AS count FROM profile_memories WHERE profile_id = ? ${status ? "AND status = ?" : ""}`,
        )
        .get(...(status ? [profileId, status] : [profileId])) as { count: number }
    ).count,
  );
  return { items: rows, limit, offset, total };
}

export function listMemoryActivity(
  client: Database.Database,
  profileId: string,
  input: { limit?: number; offset?: number; status?: string } = {},
) {
  ensureMemorySettings(client, profileId);
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const status = input.status;
  const jobs = client
    .prepare(
      `SELECT id, workspace_id AS workspaceId, session_id AS sessionId, status, attempts,
              error_code AS errorCode, cancel_reason AS cancelReason, trigger, priority,
              source_provider_id AS sourceProviderId, source_model_id AS sourceModelId,
              created_at AS createdAt, updated_at AS updatedAt, finished_at AS finishedAt
         FROM memory_capture_jobs WHERE profile_id = ? ${status ? "AND status = ?" : ""}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...(status ? [profileId, status, limit, offset] : [profileId, limit, offset]));
  const candidates = client
    .prepare(
      `SELECT c.id, c.job_id AS jobId, c.scope, c.kind, c.proposed_type AS proposedType,
              c.title, c.body, c.confidence, c.reason_code AS reasonCode,
              c.occurrence_count AS occurrenceCount, c.disposition, c.expires_at AS expiresAt,
              c.created_at AS createdAt, c.updated_at AS updatedAt
         FROM memory_candidates c JOIN memory_capture_jobs j ON j.id = c.job_id
        WHERE j.profile_id = ? ${status ? "AND c.disposition = ?" : ""}
        ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...(status ? [profileId, status, limit, offset] : [profileId, limit, offset]));
  return { candidates, jobs, limit, offset };
}

function commitExtractedCandidatesInTransaction(
  client: Database.Database,
  job: {
    id: string;
    profileId: string;
    workspaceId?: string | null;
    sessionId?: string | null;
    turnMessageId: string;
    requestId: string;
    sourceRevisionHash: string;
  },
  extracted: ExtractedMemoryCandidate[],
) {
  const now = Date.now();
  return client.transaction(() => {
    const committed: string[] = [];
    const review: string[] = [];
    for (const raw of extracted) {
      const candidate = sanitizeExtractedCandidate(raw, job.workspaceId);
      if (!candidate) continue;
      const normalizedKey = normalizedMemoryKey(candidate);
      const candidateId = randomUUID();
      const isProfile = candidate.scope === "profile";
      const slotKey = isProfile ? profileSlotKey(candidate) : null;
      const existing = slotKey
        ? (client
            .prepare(
              "SELECT * FROM profile_memories WHERE profile_id = ? AND slot_key = ? AND status != 'archived' LIMIT 1",
            )
            .get(job.profileId, slotKey) as Record<string, unknown> | undefined)
        : undefined;
      const reviewCandidate = isProfile
        ? (client
            .prepare(
              "SELECT c.id FROM memory_candidates c JOIN memory_capture_jobs j ON j.id = c.job_id WHERE j.profile_id = ? AND c.scope = 'profile' AND c.normalized_key = ? AND c.disposition = 'needs_review' ORDER BY c.created_at LIMIT 1",
            )
            .get(job.profileId, normalizedKey) as { id: string } | undefined)
        : undefined;
      const priorEvidence = reviewCandidate
        ? Number(
            (
              client
                .prepare("SELECT COUNT(*) AS count FROM memory_evidence WHERE candidate_id = ?")
                .get(reviewCandidate.id) as { count: number }
            ).count,
          )
        : 0;
      let disposition = "needs_review";
      let memoryId: string | null = null;
      if (isProfile && existing && existing.normalized_key === normalizedKey) {
        memoryId = String(existing.id);
        client
          .prepare(
            "INSERT OR IGNORE INTO memory_evidence (id, profile_memory_id, session_id, message_id, request_id, source_role, content_hash, source_revision_hash, origin, observed_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 'automatic', ?)",
          )
          .run(
            randomUUID(),
            memoryId,
            job.sessionId ?? null,
            job.turnMessageId,
            job.requestId,
            normalizedKey,
            job.sourceRevisionHash,
            now,
          );
        const count = Number(
          (
            client
              .prepare("SELECT COUNT(*) AS count FROM memory_evidence WHERE profile_memory_id = ?")
              .get(memoryId) as { count: number }
          ).count,
        );
        client
          .prepare(
            "UPDATE profile_memories SET evidence_count = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(count, now, now, memoryId);
        disposition = "committed";
      } else if (
        isProfile &&
        existing &&
        canAutoOrganizeProfile(candidate, 1) &&
        candidate.reasonCode === "correction"
      ) {
        memoryId = randomUUID();
        client
          .prepare(
            "UPDATE profile_memories SET status = 'archived', superseded_by = ?, updated_at = ? WHERE id = ?",
          )
          .run(memoryId, now, existing.id);
        const status = "organized";
        const revisionHash = hashMemory({
          kind: candidate.kind,
          statement: candidate.statement,
          value: candidate.value,
          slotKey: slotKey ?? "",
          status,
          pinned: false,
        });
        client
          .prepare(
            "INSERT INTO profile_memories (id, profile_id, kind, slot_key, value, normalized_key, statement, status, confidence, evidence_count, pinned, first_seen_at, last_seen_at, reason_code, revision_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            memoryId,
            job.profileId,
            candidate.kind,
            slotKey,
            candidate.value,
            normalizedKey,
            candidate.statement,
            status,
            candidate.confidence,
            now,
            now,
            candidate.reasonCode,
            revisionHash,
            now,
            now,
          );
        client
          .prepare(
            "INSERT INTO memory_evidence (id, profile_memory_id, session_id, message_id, request_id, source_role, content_hash, source_revision_hash, origin, observed_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 'automatic', ?)",
          )
          .run(
            randomUUID(),
            memoryId,
            job.sessionId ?? null,
            job.turnMessageId,
            job.requestId,
            normalizedKey,
            job.sourceRevisionHash,
            now,
          );
        disposition = "committed";
      } else if (
        isProfile &&
        !existing &&
        (canAutoOrganizeProfile(candidate, 1) || priorEvidence + 1 >= 3)
      ) {
        memoryId = randomUUID();
        const status = "organized";
        const revisionHash = hashMemory({
          kind: candidate.kind,
          statement: candidate.statement,
          value: candidate.value,
          slotKey: slotKey ?? "",
          status,
          pinned: false,
        });
        client
          .prepare(
            "INSERT INTO profile_memories (id, profile_id, kind, slot_key, value, normalized_key, statement, status, confidence, evidence_count, pinned, first_seen_at, last_seen_at, reason_code, revision_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            memoryId,
            job.profileId,
            candidate.kind,
            slotKey,
            candidate.value,
            normalizedKey,
            candidate.statement,
            status,
            candidate.confidence,
            priorEvidence + 1,
            now,
            now,
            candidate.reasonCode,
            revisionHash,
            now,
            now,
          );
        client
          .prepare(
            "INSERT INTO memory_evidence (id, profile_memory_id, session_id, message_id, request_id, source_role, content_hash, source_revision_hash, origin, observed_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 'automatic', ?)",
          )
          .run(
            randomUUID(),
            memoryId,
            job.sessionId ?? null,
            job.turnMessageId,
            job.requestId,
            normalizedKey,
            job.sourceRevisionHash,
            now,
          );
        if (reviewCandidate)
          client
            .prepare(
              "UPDATE memory_candidates SET disposition = 'committed', body = '', updated_at = ? WHERE id = ?",
            )
            .run(now, reviewCandidate.id);
        disposition = "committed";
      }
      const persistedCandidateId = reviewCandidate ? reviewCandidate.id : candidateId;
      if (!reviewCandidate) {
        client
          .prepare(
            "INSERT INTO memory_candidates (id, job_id, scope, kind, proposed_type, title, body, normalized_key, confidence, reason_code, disposition, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            candidateId,
            job.id,
            candidate.scope,
            candidate.kind,
            candidate.proposedType ?? null,
            candidate.subject,
            disposition === "committed" ? "" : candidate.statement,
            normalizedKey,
            candidate.confidence,
            candidate.reasonCode,
            disposition,
            candidate.scope === "unassigned"
              ? now + 24 * 60 * 60 * 1000
              : now + 30 * 24 * 60 * 60 * 1000,
            now,
            now,
          );
      } else if (disposition !== "committed") {
        client
          .prepare(
            "UPDATE memory_candidates SET occurrence_count = occurrence_count + 1, updated_at = ? WHERE id = ?",
          )
          .run(now, reviewCandidate.id);
      }
      if (disposition === "committed") committed.push(persistedCandidateId);
      else {
        review.push(persistedCandidateId);
        if (isProfile)
          client
            .prepare(
              "INSERT OR IGNORE INTO memory_evidence (id, candidate_id, session_id, message_id, request_id, source_role, content_hash, source_revision_hash, origin, observed_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 'automatic', ?)",
            )
            .run(
              randomUUID(),
              persistedCandidateId,
              job.sessionId ?? null,
              job.turnMessageId,
              job.requestId,
              normalizedKey,
              job.sourceRevisionHash,
              now,
            );
      }
    }
    return { committed, review };
  })();
}

export function commitExtractedCandidates(
  client: Database.Database,
  job: {
    id: string;
    profileId: string;
    workspaceId?: string | null;
    sessionId?: string | null;
    turnMessageId: string;
    requestId: string;
    sourceRevisionHash: string;
  },
  extracted: ExtractedMemoryCandidate[],
) {
  return client.transaction(() => commitExtractedCandidatesInTransaction(client, job, extracted))();
}

export function finishMemoryJob(
  client: Database.Database,
  jobId: string,
  leaseToken: string,
  status: "succeeded" | "failed" | "cancelled",
  errorCode?: string,
) {
  const now = Date.now();
  const result = client
    .prepare(
      "UPDATE memory_capture_jobs SET status = ?, error_code = ?, input_json = '{}', finished_at = ?, scrubbed_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_token = ?",
    )
    .run(status, errorCode ? safeErrorCode(errorCode) : null, now, now, now, jobId, leaseToken);
  return result.changes === 1;
}

export function retryMemoryJob(
  client: Database.Database,
  jobId: string,
  leaseToken: string,
  errorCode: string,
  retryAt: number,
) {
  const result = client
    .prepare(
      "UPDATE memory_capture_jobs SET status = 'pending', error_code = ?, available_at = ?, locked_at = NULL, lease_token = NULL, input_json = '{}', updated_at = ? WHERE id = ? AND status = 'running' AND lease_token = ?",
    )
    .run(safeErrorCode(errorCode), retryAt, Date.now(), jobId, leaseToken);
  return result.changes === 1;
}

export function releaseMemoryJob(client: Database.Database, jobId: string, leaseToken: string) {
  const result = client
    .prepare(
      "UPDATE memory_capture_jobs SET status = 'pending', error_code = 'worker_stopped', available_at = ?, locked_at = NULL, lease_token = NULL, updated_at = ? WHERE id = ? AND status = 'running' AND lease_token = ?",
    )
    .run(Date.now(), Date.now(), jobId, leaseToken);
  return result.changes === 1;
}

export function renewMemoryJob(client: Database.Database, jobId: string, leaseToken: string) {
  const now = Date.now();
  const result = client
    .prepare(
      "UPDATE memory_capture_jobs SET locked_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_token = ?",
    )
    .run(now, now, jobId, leaseToken);
  return result.changes === 1;
}

export function invalidateMemorySource(
  client: Database.Database,
  messageId: string,
  oldHash: string,
) {
  const now = Date.now();
  return client.transaction(() => {
    client
      .prepare(
        "UPDATE memory_capture_jobs SET status = 'cancelled', cancel_reason = 'source_edited', input_json = '{}', finished_at = ?, scrubbed_at = ?, updated_at = ? WHERE turn_message_id = ? AND source_revision_hash = ? AND status IN ('pending', 'running')",
      )
      .run(now, now, now, messageId, oldHash);
    client
      .prepare(
        "UPDATE memory_candidates SET disposition = 'discard', body = '', updated_at = ? WHERE id IN (SELECT id FROM memory_candidates WHERE disposition IN ('pending', 'needs_review') AND job_id IN (SELECT id FROM memory_capture_jobs WHERE turn_message_id = ? AND source_revision_hash = ?))",
      )
      .run(now, messageId, oldHash);
    const memories = client
      .prepare(
        "SELECT DISTINCT profile_memory_id AS id FROM memory_evidence WHERE message_id = ? AND source_revision_hash = ? AND profile_memory_id IS NOT NULL",
      )
      .all(messageId, oldHash) as Array<{ id: string }>;
    client
      .prepare("DELETE FROM memory_evidence WHERE message_id = ? AND source_revision_hash = ?")
      .run(messageId, oldHash);
    for (const memory of memories) {
      const count = Number(
        (
          client
            .prepare("SELECT COUNT(*) AS count FROM memory_evidence WHERE profile_memory_id = ?")
            .get(memory.id) as { count: number }
        ).count,
      );
      if (count === 0)
        client
          .prepare("UPDATE profile_memories SET status = 'archived', updated_at = ? WHERE id = ?")
          .run(now, memory.id);
      else
        client
          .prepare("UPDATE profile_memories SET evidence_count = ?, updated_at = ? WHERE id = ?")
          .run(count, now, memory.id);
    }
  })();
}

export class MemoryConflictError extends Error {
  constructor(readonly currentHash: string) {
    super("A memória foi alterada em outro lugar; recarregue antes de salvar.");
    this.name = "MemoryConflictError";
  }
}

export function updateProfileMemory(
  client: Database.Database,
  profileId: string,
  memoryId: string,
  input: {
    expectedHash: string;
    pinned?: boolean;
    statement?: string;
    status?: "organized" | "archived" | "captured";
  },
) {
  const now = Date.now();
  return client.transaction(() => {
    const current = client
      .prepare("SELECT * FROM profile_memories WHERE id = ? AND profile_id = ?")
      .get(memoryId, profileId) as Record<string, unknown> | undefined;
    if (!current) throw new Error("A memória selecionada não existe.");
    if (String(current.revision_hash) !== input.expectedHash)
      throw new MemoryConflictError(String(current.revision_hash));
    const statement =
      input.statement === undefined
        ? String(current.statement)
        : redactMemoryInput(input.statement).slice(0, 1000).trim();
    if (!statement || !isMemorySourceEligible(statement))
      throw new Error("A memória não pode ficar vazia.");
    const status =
      input.status ?? (String(current.status) as "organized" | "archived" | "captured");
    const pinned = input.pinned ?? Boolean(current.pinned);
    const changed =
      statement !== String(current.statement) ||
      status !== String(current.status) ||
      pinned !== Boolean(current.pinned);
    if (!changed) return current;
    const semanticChange = statement !== String(current.statement);
    const nextId = semanticChange ? randomUUID() : memoryId;
    const nextHash = hashMemory({
      kind: String(current.kind),
      statement,
      value: String(current.value),
      slotKey: String(current.slot_key),
      status,
      pinned,
    });
    if (semanticChange) {
      client
        .prepare(
          "UPDATE profile_memories SET status = 'archived', superseded_by = ?, updated_at = ? WHERE id = ?",
        )
        .run(nextId, now, memoryId);
      client
        .prepare(
          "INSERT INTO profile_memories (id, profile_id, kind, slot_key, value, normalized_key, statement, status, confidence, evidence_count, pinned, first_seen_at, last_seen_at, expires_at, superseded_by, reason_code, revision_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?, ?, ?)",
        )
        .run(
          nextId,
          profileId,
          current.kind,
          current.slot_key,
          current.value,
          current.normalized_key,
          statement,
          status,
          current.confidence,
          current.evidence_count,
          pinned ? 1 : 0,
          current.first_seen_at,
          now,
          current.reason_code,
          nextHash,
          now,
          now,
        );
    } else {
      client
        .prepare(
          "UPDATE profile_memories SET status = ?, pinned = ?, revision_hash = ?, updated_at = ? WHERE id = ?",
        )
        .run(status, pinned ? 1 : 0, nextHash, now, memoryId);
    }
    client
      .prepare(
        "INSERT INTO memory_revisions (id, profile_id, target_kind, profile_memory_id, operation, before_hash, after_hash, before_blob, after_blob, expected_hash, actor, state, created_at, updated_at) VALUES (?, ?, 'profile_memory', ?, ?, ?, ?, ?, ?, ?, 'user', 'committed', ?, ?)",
      )
      .run(
        randomUUID(),
        profileId,
        semanticChange ? nextId : memoryId,
        semanticChange ? "supersede" : "update",
        current.revision_hash,
        nextHash,
        JSON.stringify({
          statement: current.statement,
          status: current.status,
          pinned: Boolean(current.pinned),
        }),
        JSON.stringify({ statement, status, pinned }),
        input.expectedHash,
        now,
        now,
      );
    return client
      .prepare(
        "SELECT id, profile_id AS profileId, kind, slot_key AS slotKey, value, normalized_key AS normalizedKey, statement, status, confidence, evidence_count AS evidenceCount, pinned, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, reason_code AS reasonCode, revision_hash AS revisionHash, created_at AS createdAt, updated_at AS updatedAt FROM profile_memories WHERE id = ?",
      )
      .get(nextId);
  })();
}

export function deleteProfileMemory(
  client: Database.Database,
  profileId: string,
  memoryId: string,
  expectedHash: string,
) {
  const current = client
    .prepare(
      "SELECT revision_hash AS revisionHash FROM profile_memories WHERE id = ? AND profile_id = ?",
    )
    .get(memoryId, profileId) as { revisionHash: string } | undefined;
  if (!current) throw new Error("A memória selecionada não existe.");
  if (current.revisionHash !== expectedHash) throw new MemoryConflictError(current.revisionHash);
  client
    .prepare("DELETE FROM profile_memories WHERE id = ? AND profile_id = ?")
    .run(memoryId, profileId);
  return { id: memoryId, deleted: true };
}

export function discardMemoryCandidate(
  client: Database.Database,
  profileId: string,
  candidateId: string,
) {
  const result = client
    .prepare(
      "UPDATE memory_candidates SET disposition = 'discard', body = '', updated_at = ? WHERE id = ? AND job_id IN (SELECT id FROM memory_capture_jobs WHERE profile_id = ?)",
    )
    .run(Date.now(), candidateId, profileId);
  if (result.changes !== 1) throw new Error("O candidato selecionado não existe.");
  return { id: candidateId, disposition: "discard" };
}

export function approveMemoryCandidate(
  client: Database.Database,
  profileId: string,
  candidateId: string,
) {
  const candidate = client
    .prepare(
      "SELECT c.*, j.id AS jobId, j.workspace_id AS workspaceId, j.session_id AS sessionId, j.turn_message_id AS turnMessageId, j.request_id AS requestId, j.source_revision_hash AS sourceRevisionHash FROM memory_candidates c JOIN memory_capture_jobs j ON j.id = c.job_id WHERE c.id = ? AND j.profile_id = ?",
    )
    .get(candidateId, profileId) as Record<string, unknown> | undefined;
  if (!candidate) throw new Error("O candidato selecionado não existe.");
  if (!String(candidate.body).trim()) throw new Error("Este candidato não tem conteúdo revisável.");
  const result = client.transaction(() => {
    if (candidate.scope === "profile") {
      commitExtractedCandidatesInTransaction(
        client,
        {
          id: String(candidate.jobId),
          profileId,
          requestId: String(candidate.requestId),
          sessionId: (candidate.sessionId as string | null) ?? null,
          sourceRevisionHash: String(candidate.sourceRevisionHash),
          turnMessageId: String(candidate.turnMessageId),
          workspaceId: (candidate.workspaceId as string | null) ?? null,
        },
        [
          {
            confidence: 1,
            kind: candidate.kind as ExtractedMemoryCandidate["kind"],
            reasonCode: candidate.kind === "constraint" ? "constraint" : "user_preference",
            scope: "profile",
            statement: String(candidate.body),
            subject: String(candidate.title),
            value: String(candidate.body),
          },
        ],
      );
    }
    client
      .prepare(
        "UPDATE memory_candidates SET disposition = 'approved', body = '', updated_at = ? WHERE id = ?",
      )
      .run(Date.now(), candidateId);
    return { id: candidateId, disposition: "approved" };
  })();
  return result;
}

export function retryFailedMemoryJob(client: Database.Database, profileId: string, jobId: string) {
  const settings = ensureMemorySettings(client, profileId);
  if (!settings.automaticEnabled || settings.disclosureVersion !== MEMORY_DISCLOSURE_VERSION)
    throw new Error("Ative o aprendizado automático antes de tentar novamente.");
  const result = client
    .prepare(
      "UPDATE memory_capture_jobs SET status = 'pending', attempts = 0, error_code = NULL, cancel_reason = NULL, available_at = ?, finished_at = NULL, scrubbed_at = NULL, updated_at = ? WHERE id = ? AND profile_id = ? AND trigger = 'automatic' AND pipeline_version = 'v2' AND status = 'failed'",
    )
    .run(Date.now(), Date.now(), jobId, profileId);
  if (result.changes !== 1) throw new Error("Este job não pode ser tentado novamente.");
  return { id: jobId, status: "pending" };
}

export function listWorkspaceCandidates(client: Database.Database, candidateIds: string[]) {
  if (!candidateIds.length) return [];
  const placeholders = candidateIds.map(() => "?").join(",");
  return client
    .prepare(
      `SELECT id, scope, kind, proposed_type AS proposedType, title, body, confidence FROM memory_candidates WHERE id IN (${placeholders}) AND disposition = 'needs_review'`,
    )
    .all(...candidateIds) as Array<{
    body: string;
    confidence: number;
    id: string;
    kind: string;
    proposedType: string | null;
    scope: MemoryScope;
    title: string;
  }>;
}

export function markWorkspaceCandidateCaptured(client: Database.Database, candidateId: string) {
  client
    .prepare(
      "UPDATE memory_candidates SET disposition = 'captured', body = '', updated_at = ? WHERE id = ? AND scope = 'workspace' AND disposition = 'needs_review'",
    )
    .run(Date.now(), candidateId);
}

export function pruneMemory(client: Database.Database, now = Date.now()) {
  const candidateCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const revisionCutoff = now - 90 * 24 * 60 * 60 * 1000;
  client
    .prepare(
      "UPDATE memory_capture_jobs SET input_json = '{}', scrubbed_at = COALESCE(scrubbed_at, ?), updated_at = ? WHERE status IN ('succeeded', 'failed', 'cancelled') AND input_json != '{}' AND updated_at < ?",
    )
    .run(now, now, candidateCutoff);
  client
    .prepare(
      "DELETE FROM memory_capture_jobs WHERE status IN ('succeeded', 'failed', 'cancelled') AND updated_at < ?",
    )
    .run(candidateCutoff);
  client
    .prepare(
      "DELETE FROM memory_candidates WHERE disposition IN ('committed', 'approved', 'discard') AND updated_at < ?",
    )
    .run(candidateCutoff);
  client
    .prepare(
      "DELETE FROM memory_candidates WHERE scope = 'unassigned' AND expires_at IS NOT NULL AND expires_at < ?",
    )
    .run(now);
  client.prepare("DELETE FROM memory_revisions WHERE created_at < ?").run(revisionCutoff);
}

export function cancelLegacyMemoryJobs(client: Database.Database, now = Date.now()) {
  client
    .prepare(
      "UPDATE memory_capture_jobs SET status = CASE WHEN status IN ('pending', 'running') THEN 'cancelled' ELSE status END, cancel_reason = CASE WHEN status IN ('pending', 'running') THEN 'legacy_unimplemented' ELSE cancel_reason END, input_json = '{}', finished_at = COALESCE(finished_at, ?), scrubbed_at = COALESCE(scrubbed_at, ?), updated_at = ? WHERE pipeline_version = 'v1'",
    )
    .run(now, now, now);
}
